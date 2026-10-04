import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import {
  multilineTextToRichText,
  richTextToPlainText,
} from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanImportAmbiguity,
  ServicePlanContentResource,
} from "../../types/servicePlan";
import { getServicePlanElementAssignees, getServicePlanElementScriptureRefs, getServicePlanElementType } from "../../types/servicePlan";
import generateRandomId from "../../utils/generateRandomId";
import {
  areServicePlanTextResourceBodiesEqual,
  getImportedTextResourceTitle,
  isLegacyImportedDescriptionResource,
  getServicePlanResourceText,
  createServicePlanLinkResource,
  createServicePlanTextResource,
} from "./servicePlanResources";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import {
  claimServicePlanAssigneeSlot,
  hasServicePlanAssigneeEquipment,
  stripServicePlanAssigneeIdentityPreservingEquipment,
} from "./servicePlanAssigneeUtils";

type Part = ServicePlanImportAmbiguity["parts"][number];

const urlKey = (value: string) => {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLocaleLowerCase();
    return url.toString();
  } catch {
    return value;
  }
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

export const servicePlanResourceFingerprint = (resource: ServicePlanContentResource): string =>
  stableStringify(resource);

/** Upgrade the old placeholder only when saved source provenance identifies the exact resource. */
export const upgradeLegacyImportedDescriptionTitles = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
): ServicePlanElement => {
  if (!current.sourcePlanningManaged || current.importAmbiguity?.source !== "servicePlanning") return current;
  const resources = [...(current.resources || [])];
  let parts = current.importAmbiguity.parts;
  let changed = false;

  parts = parts.map((part) => {
    if (part.kind !== "description" || part.destination !== "content" || part.managed?.kind !== "resource") return part;
    const incomingMatches = imported.importAmbiguity?.parts.filter((candidate) =>
      candidate.kind === "description" && candidate.destination === "content" &&
      candidate.value === part.value && (candidate.sourceField || "title") === (part.sourceField || "title"),
    ) || [];
    if (incomingMatches.length !== 1) return part;
    const index = resources.findIndex((resource) => resource.id === part.managed!.id);
    if (index < 0) return part;
    const resource = resources[index];
    if (!isLegacyImportedDescriptionResource(resource) ||
      servicePlanResourceFingerprint(resource) !== part.managed.fingerprint ||
      !areServicePlanTextResourceBodiesEqual(resource, part.value)) return part;

    const title = getImportedTextResourceTitle(part.value);
    resources[index] = { ...resource, title };
    changed = true;
    return {
      ...part,
      managed: { kind: "resource", id: resource.id, fingerprint: servicePlanResourceFingerprint(resources[index]) },
    };
  });

  if (!changed) return current;
  return {
    ...current,
    resources,
    importAmbiguity: { ...current.importAmbiguity, parts },
  };
};

export const servicePlanNoteFingerprint = (block: { id?: string; [key: string]: unknown }): string =>
  stableStringify(block);

const scriptureFingerprint = (reference: { label: string; book: string; chapter: string; verseRange: string; version: string }) =>
  JSON.stringify({ label: reference.label, book: reference.book, chapter: reference.chapter, verseRange: reference.verseRange, version: reference.version });

const scriptureKey = (reference: { book: string; chapter: string; verseRange: string; version: string }) =>
  JSON.stringify({ book: reference.book, chapter: reference.chapter, verseRange: reference.verseRange, version: reference.version });

/**
 * Reconciles only representations with exact persisted provenance. Legacy
 * plans without markers are deduplicated on add, but never deleted by text.
 */
export const applyReviewedServicePlanParts = (
  element: ServicePlanElement,
  parts: Part[],
): { element: ServicePlanElement; parts: Part[] } => {
  let assignees = getServicePlanElementAssignees(element);
  let scriptures = getServicePlanElementScriptureRefs(element);
  let resources = [...(element.resources || [])];
  let notes = { blocks: [...(element.notes?.blocks || [])] };
  const nextParts = parts.map((part) => ({ ...part }));

  const removeManaged = (part: Part) => {
    const managed = part.managed;
    if (!managed) return;
    if (managed.kind === "assignee") {
      assignees = assignees.flatMap((person) => {
        if (person.id !== managed.id || JSON.stringify({ name: person.name }) !== managed.fingerprint) return [person];
        const equipmentSlot = stripServicePlanAssigneeIdentityPreservingEquipment(person);
        return equipmentSlot ? [equipmentSlot] : [];
      });
    } else if (managed.kind === "scripture") {
      scriptures = scriptures.filter((reference) =>
        reference.id !== managed.id || scriptureFingerprint(reference) !== managed.fingerprint,
      );
    } else if (managed.kind === "resource") {
      resources = resources.filter((resource) =>
        resource.id !== managed.id || servicePlanResourceFingerprint(resource) !== managed.fingerprint,
      );
    } else if (managed.kind === "note") {
      notes.blocks = notes.blocks.filter((block) =>
        block.id !== managed.id || servicePlanNoteFingerprint(block) !== managed.fingerprint,
      );
    }
  };

  nextParts.forEach((part) => {
    const exactPart = part.managed
      ? element.importAmbiguity?.parts.find((candidate) =>
          candidate.managed?.kind === part.managed?.kind && candidate.managed?.id === part.managed?.id,
        )
      : undefined;
    const matchingParts = element.importAmbiguity?.parts.filter((candidate) =>
      candidate.kind === part.kind && candidate.value === part.value &&
      (candidate.sourceField || "title") === (part.sourceField || "title"),
    ) || [];
    const oldPart = exactPart || (matchingParts.length === 1 ? matchingParts[0] : undefined);
    const sameDestination = oldPart?.destination === part.destination;
    if (oldPart?.managed && !sameDestination) removeManaged(oldPart);
    if (sameDestination && oldPart?.managed) part.managed = oldPart.managed;
    else delete part.managed;
  });

  nextParts.forEach((part) => {
    if (part.destination === "assignee") {
      const managed = part.managed?.kind === "assignee"
        ? assignees.find((person) => person.id === part.managed!.id && JSON.stringify({ name: person.name }) === part.managed!.fingerprint)
        : undefined;
      if (managed) {
        if (!hasServicePlanAssigneeEquipment(managed)) {
          const repaired = claimServicePlanAssigneeSlot(
            assignees,
            { id: generateRandomId(), name: part.value },
            { replaceAssigneeId: managed.id, reuseSameName: false },
          );
          if (repaired.claimedSlot) {
            assignees = repaired.assignees;
            part.managed = { kind: "assignee", id: repaired.assignee.id, fingerprint: JSON.stringify({ name: repaired.assignee.name }) };
            return;
          }
        }
        const updated = { ...managed, name: part.value };
        assignees = assignees.map((person) => person.id === managed.id ? updated : person);
        part.managed = { kind: "assignee", id: updated.id, fingerprint: JSON.stringify({ name: updated.name }) };
        return;
      }
      const existing = assignees.find((person) => person.name?.trim().toLocaleLowerCase() === part.value.trim().toLocaleLowerCase());
      if (existing) {
        delete part.managed;
        return; // Matching operator-owned assignee is reused, never claimed.
      }
      const placed = claimServicePlanAssigneeSlot(assignees, { id: generateRandomId(), name: part.value });
      assignees = placed.assignees;
      part.managed = { kind: "assignee", id: placed.assignee.id, fingerprint: JSON.stringify({ name: placed.assignee.name }) };
      return;
    }

    if (part.destination === "scripture") {
      const parsed = parseBibleReference(part.value);
      if (!parsed) return;
      const key = scriptureKey(parsed);
      const existing = scriptures.find((reference) => scriptureKey(reference) === key);
      if (existing) {
        if (part.managed?.kind === "scripture" && part.managed.id === existing.id) return;
        delete part.managed;
        return;
      }
      const created = {
        id: generateRandomId(),
        label: getBibleImportDisplayName(parsed, parsed.version),
        book: parsed.book,
        chapter: parsed.chapter,
        verseRange: parsed.verseRange,
        version: parsed.version,
      };
      scriptures = [...scriptures, created];
      part.managed = { kind: "scripture", id: created.id!, fingerprint: scriptureFingerprint(created) };
      return;
    }

    if (part.destination === "resource" || part.destination === "content") {
      const isLink = part.destination === "resource";
      const created = isLink
        ? createServicePlanLinkResource({ title: part.value, url: part.value })
        : createServicePlanTextResource({ title: getImportedTextResourceTitle(part.value), text: multilineTextToRichText(part.value) });
      const existing = resources.find((resource) => isLink
        ? Boolean(resource.url && urlKey(resource.url) === urlKey(part.value))
        : part.managed?.kind === "resource" && resource.id === part.managed.id &&
          servicePlanResourceFingerprint(resource) === part.managed.fingerprint &&
          areServicePlanTextResourceBodiesEqual(resource, part.value),
      );
      if (existing) {
        if (part.managed?.kind === "resource" && part.managed.id === existing.id && servicePlanResourceFingerprint(existing) === part.managed.fingerprint) return;
        delete part.managed;
        return;
      }
      resources = [...resources, created];
      part.managed = { kind: "resource", id: created.id, fingerprint: servicePlanResourceFingerprint(created) };
      return;
    }

    if (part.destination === "notes") {
      const managed = part.managed?.kind === "note" ? part.managed : undefined;
      if (managed && notes.blocks.some((block) => block.id === managed.id && stableStringify(block) === managed.fingerprint)) return;
      if (notes.blocks.some((block) => richTextToPlainText({ blocks: [block] }) === part.value)) {
        delete part.managed;
        return;
      }
      const id = generateRandomId();
      notes.blocks = [...notes.blocks, { type: "paragraph", id, spans: [{ text: part.value }] }];
      part.managed = { kind: "note", id, fingerprint: stableStringify(notes.blocks.at(-1)) };
    }
  });

  const next: ServicePlanElement = { ...element, assignees, scriptureRefs: scriptures, resources, notes };
  delete next.assignedMemberId;
  delete next.assignedName;
  delete next.scriptureRef;
  if (!assignees.length) delete next.assignees;
  if (!scriptures.length) delete next.scriptureRefs;
  if (!resources.length) delete next.resources;
  if (!notes.blocks.length) delete next.notes;
  next.type = getServicePlanElementType(next);
  return { element: next, parts: nextParts };
};

/** Reconcile accepted source parts against their exact managed occurrences.
 * Parts are paired only when source field and kind identify a single old and
 * incoming occurrence; ambiguous multiplicity is left for operator review. */
export const reconcileReviewedServicePlanParts = (
  current: ServicePlanElement,
  incoming: ServicePlanElement,
  acceptedFields: ReadonlySet<"title" | "note" | "ledBy">,
): { element: ServicePlanElement; ambiguity?: ServicePlanImportAmbiguity } => {
  const oldAmbiguity = current.importAmbiguity;
  const nextAmbiguity = incoming.importAmbiguity;
  if (!oldAmbiguity && !nextAmbiguity) return { element: current };

  let next = { ...current };
  let conflict = false;
  const oldParts = oldAmbiguity?.parts || [];
  const incomingParts = (nextAmbiguity?.parts || []).map((part) => ({ ...part }));
  const processedOld = new Set<number>();
  const processedIncoming = new Set<number>();
  const blockedSourceFields = new Set<string>();

  const removeExact = (part: Part) => {
    const managed = part.managed;
    if (!managed) return false;
    if (managed.kind === "scripture") {
      const refs = getServicePlanElementScriptureRefs(next);
      const match = refs.find((ref) => ref.id === managed.id);
      if (!match || scriptureFingerprint(match) !== managed.fingerprint) return false;
      const remaining = refs.filter((ref) => ref !== match);
      next.scriptureRefs = remaining;
      delete next.scriptureRef;
      return true;
    }
    if (managed.kind === "resource") {
      const resources = next.resources || [];
      const match = resources.find((resource) => resource.id === managed.id);
      if (!match || servicePlanResourceFingerprint(match) !== managed.fingerprint) return false;
      next.resources = resources.filter((resource) => resource !== match);
      return true;
    }
    if (managed.kind === "note") {
      const blocks = next.notes?.blocks || [];
      const match = blocks.find((block) => block.id === managed.id);
      if (!match || servicePlanNoteFingerprint(match) !== managed.fingerprint) return false;
      next.notes = { blocks: blocks.filter((block) => block !== match) };
      return true;
    }
    if (managed.kind === "assignee") {
      const assignees = getServicePlanElementAssignees(next);
      const match = assignees.find((person) => person.id === managed.id);
      if (!match || JSON.stringify({ name: match.name }) !== managed.fingerprint) return false;
      next.assignees = assignees.flatMap((person) => {
        if (person !== match) return [person];
        const equipmentSlot = stripServicePlanAssigneeIdentityPreservingEquipment(person);
        return equipmentSlot ? [equipmentSlot] : [];
      });
      return true;
    }
    return false;
  };

  const installIncoming = (part: Part) => {
    if (part.destination === "notes") {
      const existing = part.managed?.kind === "note"
        ? next.notes?.blocks.find((block) => block.id === part.managed!.id)
        : undefined;
      const id = existing?.id || generateRandomId();
      const block = { type: "paragraph" as const, id, spans: [{ text: part.value }] };
      const blocks = next.notes?.blocks || [];
      next.notes = { blocks: existing ? blocks.map((item) => item === existing ? block : item) : [...blocks, block] };
      return { ...part, managed: { kind: "note" as const, id, fingerprint: stableStringify(block) } };
    }
    if (part.destination !== "scripture" && part.destination !== "resource" && part.destination !== "content" && part.destination !== "assignee") return part;
    if (part.kind === "scripture" && part.destination === "scripture") {
      const parsed = parseBibleReference(part.value);
      if (!parsed) return part;
      const id = part.managed?.kind === "scripture" ? part.managed.id : generateRandomId();
      const reference = {
        id,
        label: getBibleImportDisplayName(parsed, parsed.version),
        book: parsed.book,
        chapter: parsed.chapter,
        verseRange: parsed.verseRange,
        version: parsed.version,
      };
      const refs = getServicePlanElementScriptureRefs(next);
      const index = part.managed?.kind === "scripture" ? refs.findIndex((ref) => ref.id === id) : -1;
      if (index >= 0) refs[index] = reference;
      else refs.push(reference);
      next.scriptureRefs = refs;
      delete next.scriptureRef;
      return { ...part, managed: { kind: "scripture" as const, id, fingerprint: scriptureFingerprint(reference) } };
    }
    // A free-text title may be promoted to an assignee only after the
    // operator explicitly chooses that destination during ambiguity review.
    if ((part.kind === "person" || part.kind === "description") && part.destination === "assignee") {
      const existing = part.managed?.kind === "assignee"
        ? getServicePlanElementAssignees(next).find((person) => person.id === part.managed!.id)
        : undefined;
      const assignees = getServicePlanElementAssignees(next);
      if (existing) {
        if (!hasServicePlanAssigneeEquipment(existing)) {
          const repaired = claimServicePlanAssigneeSlot(
            assignees,
            { id: generateRandomId(), name: part.value },
            { replaceAssigneeId: existing.id, reuseSameName: false },
          );
          if (repaired.claimedSlot) {
            next.assignees = repaired.assignees;
            return { ...part, managed: { kind: "assignee" as const, id: repaired.assignee.id, fingerprint: JSON.stringify({ name: repaired.assignee.name }) } };
          }
        }
        const person = { ...existing, name: part.value };
        next.assignees = assignees.map((item) => item === existing ? person : item);
        return { ...part, managed: { kind: "assignee" as const, id: person.id, fingerprint: JSON.stringify({ name: person.name }) } };
      }
      const sameName = assignees.find((person) => person.name?.trim().toLocaleLowerCase() === part.value.trim().toLocaleLowerCase());
      if (sameName) return { ...part, managed: undefined };

      // A verified managed row without equipment plus a remaining blank slot
      // is the unambiguous shape produced by the former append-only importer.
      const priorManaged = part.managed?.kind === "assignee"
        ? getServicePlanElementAssignees(next).find((person) => person.id === part.managed!.id)
        : undefined;
      const replaceAssigneeId = priorManaged && !hasServicePlanAssigneeEquipment(priorManaged)
        ? priorManaged.id
        : undefined;
      const placed = claimServicePlanAssigneeSlot(
        assignees,
        { id: generateRandomId(), name: part.value },
        { ...(replaceAssigneeId ? { replaceAssigneeId } : {}) },
      );
      next.assignees = placed.assignees;
      return { ...part, managed: { kind: "assignee" as const, id: placed.assignee.id, fingerprint: JSON.stringify({ name: placed.assignee.name }) } };
    }
    if ((part.kind === "description" || part.kind === "url") && (part.destination === "resource" || part.destination === "content")) {
      const incomingResource = (incoming.resources || []).find((resource) =>
        resource.url === part.value || areServicePlanTextResourceBodiesEqual(resource, part.value),
      ) || (part.kind === "url" && part.destination === "resource"
        ? createServicePlanLinkResource({ title: part.value, url: part.value })
        : undefined);
      if (!incomingResource) return part;
      const id = part.managed?.kind === "resource" ? part.managed.id : incomingResource.id;
      const resource = { ...incomingResource, id };
      const resources = next.resources || [];
      const index = part.managed?.kind === "resource" ? resources.findIndex((item) => item.id === id) : -1;
      if (index >= 0) resources[index] = resource;
      else resources.push(resource);
      next.resources = resources;
      return { ...part, managed: { kind: "resource" as const, id, fingerprint: servicePlanResourceFingerprint(resource) } };
    }
    return part;
  };

  const pairs = new Map<number, number>();
  const groups = new Set(oldParts.map((part) => `${part.sourceField || "title"}:${part.kind}`));
  groups.forEach((key) => {
    const [field, kind] = key.split(":") as ["title" | "note" | "ledBy", Part["kind"]];
    if (!acceptedFields.has(field)) return;
    const old = oldParts.flatMap((part, index) => (part.sourceField || "title") === field && part.kind === kind ? [index] : []);
    const fresh = incomingParts.flatMap((part, index) => (part.sourceField || "title") === field && part.kind === kind ? [index] : []);
    if (old.length === 1 && fresh.length === 1) pairs.set(old[0], fresh[0]);
  });

  pairs.forEach((incomingIndex, oldIndex) => {
    const oldPart = oldParts[oldIndex];
    const freshPart = incomingParts[incomingIndex];
    processedOld.add(oldIndex);
    processedIncoming.add(incomingIndex);
    const managed = oldPart.managed;
    if (!managed) {
      if (oldPart.value !== freshPart.value || oldPart.destination !== freshPart.destination) {
        conflict = true;
        blockedSourceFields.add(oldPart.sourceField || "title");
      }
      return;
    }
    const valid = managed.kind === "scripture"
      ? getServicePlanElementScriptureRefs(next).some((ref) => ref.id === managed.id && scriptureFingerprint(ref) === managed.fingerprint)
      : managed.kind === "resource"
        ? (next.resources || []).some((resource) => resource.id === managed.id && servicePlanResourceFingerprint(resource) === managed.fingerprint)
        : managed.kind === "note"
          ? (next.notes?.blocks || []).some((block) => block.id === managed.id && servicePlanNoteFingerprint(block) === managed.fingerprint)
          : managed.kind === "assignee"
            ? getServicePlanElementAssignees(next).some((person) => person.id === managed.id && JSON.stringify({ name: person.name }) === managed.fingerprint)
            : false;
    if (!valid) {
      conflict = true;
      blockedSourceFields.add(oldPart.sourceField || "title");
      return;
    }
    if (oldPart.value !== freshPart.value || oldPart.destination !== freshPart.destination) {
      if (oldPart.destination !== freshPart.destination) removeExact(oldPart);
      const installed = installIncoming({ ...freshPart, managed: oldPart.destination === freshPart.destination ? managed : undefined });
      incomingParts[incomingIndex] = installed;
    } else {
      const unchanged = { ...freshPart, destination: oldPart.destination, managed };
      // Re-run source-managed assignee placement on refresh so old append-only
      // rows can be safely folded back into a matching equipment slot.
      incomingParts[incomingIndex] = managed.kind === "assignee"
        ? installIncoming(unchanged)
        : unchanged;
    }
  });

  oldParts.forEach((part, index) => {
    if (processedOld.has(index) || !acceptedFields.has(part.sourceField || "title")) return;
    const sameGroupIncoming = incomingParts.some((candidate) => candidate.kind === part.kind && (candidate.sourceField || "title") === (part.sourceField || "title"));
    if (sameGroupIncoming) {
      conflict = true;
      blockedSourceFields.add(part.sourceField || "title");
      return;
    }
    if (!part.managed || !removeExact(part)) {
      conflict = true;
      blockedSourceFields.add(part.sourceField || "title");
    }
  });

  const preexistingScriptureKeys = new Set(getServicePlanElementScriptureRefs(next).map(scriptureKey));
  const preexistingResourceUrls = new Set((next.resources || []).flatMap((resource) => resource.url ? [urlKey(resource.url)] : []));
  const preexistingTextResources = new Set((next.resources || []).flatMap((resource) =>
    resource.type === "text" ? [richTextToPlainText(getServicePlanResourceText(resource)).replace(/\r\n?/g, "\n").trim()] : [],
  ));
  const mergedParts = incomingParts.map((part, index) => {
    if (processedIncoming.has(index)) return part;
    const field = part.sourceField || "title";
    if (acceptedFields.has(field)) {
      if (blockedSourceFields.has(field)) {
        conflict = true;
        return part;
      }
      const hasExistingGroup = oldParts.some((candidate) =>
        (candidate.sourceField || "title") === field && candidate.kind === part.kind,
      );
      if (hasExistingGroup) {
        conflict = true;
        return part;
      }
      const parsedScripture = part.destination === "scripture" ? parseBibleReference(part.value) : undefined;
      if (parsedScripture && preexistingScriptureKeys.has(scriptureKey(parsedScripture))) return part;
      if (part.destination === "resource" && preexistingResourceUrls.has(urlKey(part.value))) return part;
      if (part.destination === "content" && preexistingTextResources.has(part.value.replace(/\r\n?/g, "\n").trim())) return part;
      const installed = installIncoming(part);
      if ((part.destination === "scripture" || part.destination === "resource" ||
        part.destination === "content" || part.destination === "notes" || part.destination === "assignee") &&
        !installed.managed) {
        const alreadyPresent = part.destination === "scripture"
          ? getServicePlanElementScriptureRefs(next).some((reference) => {
              const parsed = parseBibleReference(part.value);
              return parsed && scriptureKey(reference) === scriptureKey(parsed);
            })
          : part.destination === "assignee"
            ? getServicePlanElementAssignees(next).some((person) => person.name?.trim().toLocaleLowerCase() === part.value.trim().toLocaleLowerCase())
            : part.destination === "resource" || part.destination === "content"
              ? (next.resources || []).some((resource) => part.destination === "resource"
                  ? Boolean(resource.url && urlKey(resource.url) === urlKey(part.value))
                  : areServicePlanTextResourceBodiesEqual(resource, part.value))
              : (next.notes?.blocks || []).some((block) => richTextToPlainText({ blocks: [block] }) === part.value);
        if (!alreadyPresent) conflict = true;
      }
      return installed;
    }
    const old = oldParts.find((candidate) => (candidate.sourceField || "title") === field && candidate.kind === part.kind && candidate.value === part.value);
    return old ? { ...part, destination: old.destination, managed: old.managed } : part;
  });
  next.scriptureRefs = getServicePlanElementScriptureRefs(next);
  if (!next.scriptureRefs.length) delete next.scriptureRefs;
  if (!(next.resources || []).length) delete next.resources;
  if (!next.notes?.blocks.length) delete next.notes;
  if (!next.assignees?.length) delete next.assignees;
  next.type = getServicePlanElementType(next);
  const ambiguity = nextAmbiguity
    ? {
        ...nextAmbiguity,
        parts: mergedParts,
        ...(conflict ? { status: "unresolved" as const, reasons: [...nextAmbiguity.reasons, "A source-managed attachment was edited locally and needs review."] } : {}),
      }
    : oldAmbiguity;
  return { element: next, ambiguity };
};
