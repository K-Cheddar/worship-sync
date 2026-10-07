/**
 * Converts a ServicePlan into real PouchDB outline items — the one piece of
 * this feature that touches the live show list, so it's kept narrow and
 * explicit. Call from the Controller's opt-in apply flow
 * (see useServicePlanOutlinePush.ts), not from the Teams plan editor.
 *
 * v1 scope, deliberately: insert-only, not two-way sync. What an element
 * becomes follows its attachment:
 *   - a library song → that song;
 *   - a scripture reference → a real Bible item built through the same
 *     `createBibleItemFromParsedReference` pipeline the Controller's import
 *     uses;
 *   - a "pending" song (lyrics captured but no song doc yet) → that attachment
 *     alone is skipped and reported, since there's no library doc to reference;
 *     everything else on the same element still goes out;
 *   - unattached elements and generic resources → no outline item.
 *
 * Idempotency is per attachment, not per element: every item an element pushes
 * takes a listId derived from the element and what is attached to it (see
 * `outlineListIdFor`), so a re-push adds exactly the items that are missing
 * from the live list. That is what lets an element push its resolved songs now
 * and the one that was still unmatched later, and what stops a re-push from
 * duplicating an element's surviving items after the operator deleted one of
 * them. True update-in-place for an edited-then-re-pushed element
 * (repositioning it back under its original heading) is out of scope for v1.
 */
import type PouchDB from "pouchdb-browser";
import type { DBItem, ServiceItem } from "../../types";
import { createBibleItemFromParsedReference } from "../../utils/servicePlanningBibleImport";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { richTextToPlainText } from "../../types/richText";
import type { ServicePlanningSectionRule } from "../../types/integrations";
import { resolveServicePlanningSection } from "../../integrations/servicePlanning/servicePlanningSectionResolution";
import type {
  ServicePlan,
  ServicePlanElement,
  ServicePlanScriptureReference,
} from "../../types/servicePlan";
import {
  getServicePlanCustomDocumentId,
  getServicePlanElementContentResources,
} from "../../types/servicePlan";

export type ServicePlanOutlinePushResult = {
  /** New actionable content items to insert into resolved outline sections. */
  items: ServiceItem[];
  insertedCount: number;
  /** Titles of elements carrying an attachment that still can't be pushed. */
  skippedTitles: string[];
  placementIssues: ServicePlanOutlinePlacementIssue[];
};

export type ServicePlanOutlinePlacementIssue = {
  sectionName: string;
  headingName?: string;
  reason: "mapped-heading-missing" | "no-matching-heading" | "heading-removed";
};

const findExistingListId = (
  currentList: ServiceItem[],
  listId: string | undefined,
): ServiceItem | undefined =>
  listId ? currentList.find((item) => item.listId === listId) : undefined;

const getPushedOutlineListIds = (element: ServicePlanElement): string[] =>
  element.pushedOutlineListIds?.length
    ? element.pushedOutlineListIds
    : element.pushedOutlineListId
      ? [element.pushedOutlineListId]
      : [];

/**
 * A push carried out before per-attachment ids existed stamped randomly
 * generated listIds, which say nothing about *what* they carry. So while one of
 * those is still on the list, the element is left alone entirely — re-deriving
 * its ids would push a second copy of everything it already added.
 */
const hasLegacyPushOnList = (
  list: ServiceItem[],
  element: ServicePlanElement,
): boolean =>
  getPushedOutlineListIds(element).some(
    (listId) =>
      !listId.startsWith(`${element.id}::`) && findExistingListId(list, listId),
  );

/**
 * The listId one attachment takes on the live list. Derived from the element
 * and what is attached rather than random, so a re-push can tell an item that
 * is already on screen from one that is genuinely new.
 *
 * Both halves are capped: these ids travel back to the server on the plan's
 * `pushedOutlineListIds`, which is a short text field that would silently
 * truncate a longer one — and a truncated id matches nothing, which is exactly
 * the duplicate this whole scheme exists to prevent. Element ids are short
 * random strings, so only an unusually long song id ever reaches the cap.
 */
const outlineListIdFor = (
  element: ServicePlanElement,
  key: string,
  occurrence: number,
): string =>
  `${element.id.slice(0, 60)}::${key.slice(0, 80)}${
    occurrence ? `::${occurrence}` : ""
  }`;

/** One item an element would put on the list, and the listId it would take. */
type PlannedOutlineItem =
  | { kind: "song"; listId: string; song: ServiceItem }
  | { kind: "scripture"; listId: string; scriptureRef: ServicePlanScriptureReference }
  | {
      kind: "custom-document";
      listId: string;
      document: Pick<DBItem, "_id" | "name" | "type">;
    };

type ElementOutlinePlan = {
  element: ServicePlanElement;
  title: string;
  planned: PlannedOutlineItem[];
  /** An attached song still has no library doc, so it can't be pushed yet. */
  hasUnresolvedAttachment: boolean;
};

export type ServicePlanOutlineStep = {
  planned: PlannedOutlineItem;
  element: ElementOutlinePlan;
  sectionName: string;
  targetHeading: { listId: string; name: string };
};

export type ServicePlanOutlinePlan = {
  steps: ServicePlanOutlineStep[];
  skippedTitles: string[];
  placementIssues: ServicePlanOutlinePlacementIssue[];
};

/** Insert immediately before the next heading, or at the list end. */
export const insertServicePlanOutlineItem = (
  list: ServiceItem[],
  item: ServiceItem,
  targetHeading: ServicePlanOutlineStep["targetHeading"],
): ServiceItem[] | null => {
  const headingIndex = list.findIndex(
    (candidate) =>
      candidate.type === "heading" && candidate.listId === targetHeading.listId,
  );
  if (headingIndex === -1) return null;
  let sectionEndIndex = list.length;
  for (let index = headingIndex + 1; index < list.length; index += 1) {
    if (list[index].type === "heading") {
      sectionEndIndex = index;
      break;
    }
  }
  return [
    ...list.slice(0, sectionEndIndex),
    item,
    ...list.slice(sectionEndIndex),
  ];
};

/**
 * What an element would push, worked out without touching the database so the
 * idempotency checks can be made before anything is created.
 */
const planElementOutlineItems = (
  element: ServicePlanElement,
  songs: ServiceItem[],
  customDocuments: Pick<DBItem, "_id" | "name" | "type">[],
): ElementOutlinePlan => {
  const title = richTextToPlainText(element.title).trim() || "Untitled";
  const planned: PlannedOutlineItem[] = [];
  let hasUnresolvedAttachment = false;
  // An element may legitimately attach the same song twice (a reprise); the
  // occurrence count keeps those from collapsing onto one listId.
  for (const [attachmentIndex, resource] of getServicePlanElementContentResources(element).entries()) {
    const occurrenceId = resource.id || `${resource.type}-${attachmentIndex}`;
    const listId = outlineListIdFor(element, `attachment:${occurrenceId}`, 0);
    if (resource.type === "song") {
      const storedSongRef = resource.data?.songRef;
      const songRef = storedSongRef && typeof storedSongRef === "object"
        ? storedSongRef as { kind?: string; songId?: string; songName?: string; title?: string }
        : null;
      const linkedSongId = songRef?.kind === "library"
        ? String(songRef.songId || "").trim()
        : typeof resource.data?.songId === "string"
          ? resource.data.songId.trim()
          : "";
      const linkedSong = linkedSongId
        ? songs.find((candidate) => candidate._id === linkedSongId && candidate.type === "song")
        : null;
      if (linkedSong) {
        planned.push({ kind: "song", listId, song: linkedSong });
        continue;
      }
      // A saved-plan link is authoritative. Never substitute a same-titled
      // song when its id is missing or no longer resolves.
      hasUnresolvedAttachment = true;
      continue;
    }
    if (resource.type === "scripture") {
      const storedReference = resource.data?.scripture;
      const scriptureRef = storedReference && typeof storedReference === "object"
        ? storedReference as ServicePlanScriptureReference
        : resource.data && typeof resource.data.book === "string"
            ? resource.data as unknown as ServicePlanScriptureReference
            : undefined;
      const parsedReference = scriptureRef?.book && scriptureRef.chapter && scriptureRef.verseRange
        ? parseBibleReference(`${scriptureRef.book} ${scriptureRef.chapter}:${scriptureRef.verseRange}`)
        : null;
      if (parsedReference && scriptureRef) {
        planned.push({
          kind: "scripture",
          listId,
          scriptureRef: {
            ...parsedReference,
            label: scriptureRef.label,
            version: scriptureRef.version || parsedReference.version,
          },
        });
      } else {
        hasUnresolvedAttachment = true;
      }
      continue;
    }
    if (resource.type === "custom-document") {
      const documentId = getServicePlanCustomDocumentId(resource);
      const document = customDocuments.find(
        (candidate) => candidate._id === documentId && candidate.type === "free",
      );
      if (!documentId || !document) {
        hasUnresolvedAttachment = true;
        continue;
      }
      planned.push({ kind: "custom-document", listId, document });
      continue;
    }
    // Generic resources, URLs, attachments and text fields are not outline
    // documents. Only explicit references above are actionable here.
  }

  return { element, title, planned, hasUnresolvedAttachment };
};

/** The planned items not already on the list — what a push would really add. */
const missingPlannedItems = (
  list: ServiceItem[],
  plan: ElementOutlinePlan,
): PlannedOutlineItem[] =>
  hasLegacyPushOnList(list, plan.element)
    ? []
    : plan.planned.filter(({ listId }) => !findExistingListId(list, listId));

export const buildServicePlanOutlineItem = async ({
  step,
  list,
  db,
  bibleDb,
}: {
  step: ServicePlanOutlineStep;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
}): Promise<ServiceItem> => {
  const { planned } = step;
  if (planned.kind === "song") {
    return {
      ...planned.song,
      listId: planned.listId,
    };
  }

  if (planned.kind === "scripture") {
    const { scriptureRef } = planned;
    const created = await createBibleItemFromParsedReference({
      parsedRef: {
        book: scriptureRef.book,
        chapter: scriptureRef.chapter,
        verseRange: scriptureRef.verseRange,
        version: scriptureRef.version,
      },
      db,
      bibleDb,
      allItems: list,
      background: "",
      brightness: 100,
      fontMode: "fit",
    });
    return {
      _id: created._id,
      name: created.name,
      type: "bible",
      background: created.background,
      listId: planned.listId,
    };
  }

  if (planned.kind === "custom-document") {
    return {
      _id: planned.document._id,
      name: planned.document.name,
      type: "free",
      listId: planned.listId,
    };
  }

  throw new Error("Unsupported service plan outline item");
};

export const planServicePlanOutlineItems = ({
  plan,
  currentList,
  songs,
  customDocuments = [],
  sectionRules = [],
}: {
  plan: ServicePlan;
  currentList: ServiceItem[];
  /** The song library as it stands now, for re-checking unmatched imports.
   * Required rather than defaulted: omitting it silently drops songs. */
  songs: ServiceItem[];
  /** Current church free-form library, used to resolve custom-document refs. */
  customDocuments?: Pick<DBItem, "_id" | "name" | "type">[];
  sectionRules?: ServicePlanningSectionRule[];
}): ServicePlanOutlinePlan => {
  const steps: ServicePlanOutlineStep[] = [];
  const skippedTitles: string[] = [];
  const placementIssues: ServicePlanOutlinePlacementIssue[] = [];
  let workingList = [...currentList];

  for (const section of plan.sections) {
    const placement = resolveServicePlanningSection({
      sectionName: section.name,
      sectionRules,
      outline: workingList,
    });
    const elementPlans = section.elements.map((element) =>
      planElementOutlineItems(element, songs, customDocuments),
    );

    // A song with nothing behind it in the library is the operator's to fix, so
    // it is reported whether or not the rest of the element gets pushed.
    for (const elementPlan of elementPlans) {
      if (elementPlan.hasUnresolvedAttachment) {
        skippedTitles.push(elementPlan.title);
      }
    }

    const sectionSteps: ServicePlanOutlineStep[] = [];
    const unresolvedForSection: PlannedOutlineItem[] = [];
    for (const elementPlan of elementPlans) {
      const additions = missingPlannedItems(workingList, elementPlan);
      if (!placement.heading) {
        unresolvedForSection.push(...additions);
        continue;
      }
      for (const planned of additions) {
        const step = {
          planned,
          element: elementPlan,
          sectionName: section.name,
          targetHeading: {
            listId: placement.heading.listId,
            name: placement.heading.name,
          },
        } satisfies ServicePlanOutlineStep;
        sectionSteps.push(step);
        const simulatedItem: ServiceItem = {
          _id:
            planned.kind === "song"
              ? planned.song._id
              : planned.kind === "custom-document"
                ? planned.document._id
                : `planned:${planned.listId}`,
          name:
            planned.kind === "song"
              ? planned.song.name
              : planned.kind === "custom-document"
                ? planned.document.name
                : elementPlan.title,
          type:
            planned.kind === "song"
              ? "song"
              : planned.kind === "custom-document"
                ? "free"
                : "bible",
          listId: planned.listId,
        };
        const inserted = insertServicePlanOutlineItem(workingList, simulatedItem, step.targetHeading);
        if (inserted) workingList = inserted;
      }
    }
    if (sectionSteps.length) steps.push(...sectionSteps);
    else if (placement.issue && unresolvedForSection.length) {
      placementIssues.push(placement.issue);
    }
  }

  return { steps, skippedTitles, placementIssues };
};

export const buildServicePlanOutlineItems = async ({
  plan,
  currentList,
  db,
  bibleDb,
  songs,
  customDocuments = [],
  sectionRules = [],
  isContextCurrent = () => true,
}: {
  plan: ServicePlan;
  currentList: ServiceItem[];
  db: PouchDB.Database | undefined;
  bibleDb?: PouchDB.Database | undefined;
  songs: ServiceItem[];
  customDocuments?: Pick<DBItem, "_id" | "name" | "type">[];
  sectionRules?: ServicePlanningSectionRule[];
  isContextCurrent?: () => boolean;
}): Promise<ServicePlanOutlinePushResult> => {
  const assertCurrentContext = () => {
    if (!isContextCurrent()) {
      throw new Error("The selected outline changed before the service plan could be imported.");
    }
  };
  const planned = planServicePlanOutlineItems({ plan, currentList, songs, customDocuments, sectionRules });
  const items: ServiceItem[] = [];
  let workingList = currentList;
  for (const step of planned.steps) {
    assertCurrentContext();
    // eslint-disable-next-line no-await-in-loop -- build and append in content order
    const item = await buildServicePlanOutlineItem({ step, list: workingList, db, bibleDb });
    const inserted = insertServicePlanOutlineItem(workingList, item, step.targetHeading);
    if (!inserted) {
      planned.placementIssues.push({
        sectionName: step.sectionName,
        headingName: step.targetHeading.name,
        reason: "heading-removed",
      });
      continue;
    }
    items.push(item);
    workingList = inserted;
  }
  assertCurrentContext();
  return { items, insertedCount: items.length, skippedTitles: planned.skippedTitles, placementIssues: planned.placementIssues };
};
