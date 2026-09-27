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
    const oldPart = element.importAmbiguity?.parts.find((candidate) =>
      candidate.kind === part.kind && candidate.value === part.value &&
      (candidate.sourceField || "title") === (part.sourceField || "title"),
    );
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
