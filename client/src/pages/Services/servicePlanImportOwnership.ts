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
import { getServicePlanResourceText, createServicePlanLinkResource, createServicePlanTextResource } from "./servicePlanResources";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";

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
        return person.microphoneIds?.length ? [{ id: person.id, microphoneIds: person.microphoneIds }] : [];
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
        block.id !== managed.id || stableStringify(block) !== managed.fingerprint,
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
      const existing = assignees.find((person) => person.name?.trim().toLocaleLowerCase() === part.value.trim().toLocaleLowerCase());
      if (existing) {
        if (part.managed?.kind === "assignee" && part.managed.id === existing.id) return;
        delete part.managed;
        return; // Matching operator-owned assignee is reused, never claimed.
      }
      const created = { id: generateRandomId(), name: part.value };
      assignees = [...assignees, created];
      part.managed = { kind: "assignee", id: created.id, fingerprint: JSON.stringify({ name: created.name }) };
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
        : createServicePlanTextResource({ title: "Imported description", text: multilineTextToRichText(part.value) });
      const existing = resources.find((resource) => isLink
        ? Boolean(resource.url && urlKey(resource.url) === urlKey(part.value))
        : resource.type === "text" && resource.title === "Imported description" &&
          richTextToPlainText(getServicePlanResourceText(resource)) === part.value,
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
      if (!match || stableStringify(match) !== managed.fingerprint) return false;
      next.notes = { blocks: blocks.filter((block) => block !== match) };
      return true;
    }
    if (managed.kind === "assignee") {
      const assignees = getServicePlanElementAssignees(next);
      const match = assignees.find((person) => person.id === managed.id);
      if (!match || JSON.stringify({ name: match.name }) !== managed.fingerprint) return false;
      next.assignees = assignees.flatMap((person) => person !== match ? [person] : person.microphoneIds?.length
        ? [{ id: person.id, microphoneIds: person.microphoneIds }]
        : []);
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
    if (part.kind === "person" && part.destination === "assignee") {
      const existing = part.managed?.kind === "assignee"
        ? getServicePlanElementAssignees(next).find((person) => person.id === part.managed!.id)
        : undefined;
      const id = existing?.id || generateRandomId();
      const person = { ...existing, id, name: part.value };
      const assignees = getServicePlanElementAssignees(next);
      next.assignees = existing ? assignees.map((item) => item === existing ? person : item) : [...assignees, person];
      return { ...part, managed: { kind: "assignee" as const, id, fingerprint: JSON.stringify({ name: person.name }) } };
    }
    if ((part.kind === "description" || part.kind === "url") && (part.destination === "resource" || part.destination === "content")) {
      const incomingResource = (incoming.resources || []).find((resource) =>
        resource.url === part.value || (resource.type === "text" && richTextToPlainText(getServicePlanResourceText(resource)) === part.value),
      );
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
    if (!managed) return;
    const valid = managed.kind === "scripture"
      ? getServicePlanElementScriptureRefs(next).some((ref) => ref.id === managed.id && scriptureFingerprint(ref) === managed.fingerprint)
      : managed.kind === "resource"
        ? (next.resources || []).some((resource) => resource.id === managed.id && servicePlanResourceFingerprint(resource) === managed.fingerprint)
        : managed.kind === "note"
          ? (next.notes?.blocks || []).some((block) => block.id === managed.id && stableStringify(block) === managed.fingerprint)
          : managed.kind === "assignee"
            ? getServicePlanElementAssignees(next).some((person) => person.id === managed.id && JSON.stringify({ name: person.name }) === managed.fingerprint)
            : false;
    if (!valid) {
      conflict = true;
      return;
    }
    if (oldPart.value !== freshPart.value || oldPart.destination !== freshPart.destination) {
      if (oldPart.destination !== freshPart.destination) removeExact(oldPart);
      const installed = installIncoming({ ...freshPart, managed: oldPart.destination === freshPart.destination ? managed : undefined });
      incomingParts[incomingIndex] = installed;
    } else {
      incomingParts[incomingIndex] = { ...freshPart, destination: oldPart.destination, managed };
    }
  });

  oldParts.forEach((part, index) => {
    if (processedOld.has(index) || !acceptedFields.has(part.sourceField || "title")) return;
    const sameGroupIncoming = incomingParts.some((candidate) => candidate.kind === part.kind && (candidate.sourceField || "title") === (part.sourceField || "title"));
    if (sameGroupIncoming) {
      conflict = true;
      return;
    }
    if (part.managed && !removeExact(part)) conflict = true;
  });

  const mergedParts = incomingParts.map((part, index) => {
    if (processedIncoming.has(index)) return part;
    const field = part.sourceField || "title";
    if (acceptedFields.has(field)) return part;
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
