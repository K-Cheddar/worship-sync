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
 *   - anything unattached → a blank free-form item stamped with the element's
 *     title/notes: a real, editable placeholder in the correct running order
 *     rather than nothing at all.
 *
 * Idempotency is per attachment, not per element: every item an element pushes
 * takes a listId derived from the element and what is attached to it (see
 * `outlineListIdFor`), so a re-push adds exactly the items that are missing
 * from the live list. That is what lets an element push its resolved songs now
 * and the one that was still unmatched later, and what stops a re-push from
 * duplicating an element's surviving items after the operator deleted one of
 * them. If a section has nothing new to add, no fresh heading is created for it
 * either. True update-in-place for an edited-then-re-pushed element
 * (repositioning it back under its original heading) is out of scope for v1.
 */
import type PouchDB from "pouchdb-browser";
import type { ServiceItem } from "../../types";
import { createNewFreeForm, createNewHeading } from "../../utils/itemUtil";
import { createBibleItemFromParsedReference } from "../../utils/servicePlanningBibleImport";
import generateRandomId from "../../utils/generateRandomId";
import { resolveServicePlanSongRef } from "./servicePlanSongResolution";
import {
  richTextToFormattedPlainText,
  richTextToPlainText,
} from "../../types/richText";
import type {
  ServicePlan,
  ServicePlanElement,
  ServicePlanScriptureReference,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";

export type ServicePlanOutlinePushResult = {
  /** New items to append to the live list, in order (headings + content). */
  items: ServiceItem[];
  /** Plan sections with pushedOutlineListId stamped onto newly-pushed elements. */
  updatedSections: ServicePlanSection[];
  /** Count of content items actually added (excludes heading items). */
  insertedCount: number;
  /** Titles of elements carrying an attachment that still can't be pushed. */
  skippedTitles: string[];
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
  | { kind: "song"; listId: string; songId: string; songName: string }
  | { kind: "scripture"; listId: string; scriptureRef: ServicePlanScriptureReference }
  /** No attachment: a blank placeholder standing in for the element itself. */
  | { kind: "placeholder"; listId: string };

type ElementOutlinePlan = {
  element: ServicePlanElement;
  title: string;
  planned: PlannedOutlineItem[];
  /** An attached song still has no library doc, so it can't be pushed yet. */
  hasUnresolvedAttachment: boolean;
};

/**
 * What an element would push, worked out without touching the database so the
 * heading decision and the idempotency checks can be made before anything is
 * created. Deliberately total: an element whose only song is unresolved plans
 * nothing at all, which is what keeps a re-push from stamping a fresh heading
 * above an item it can't add.
 */
const planElementOutlineItems = (
  element: ServicePlanElement,
  songs: ServiceItem[],
): ElementOutlinePlan => {
  const title = richTextToPlainText(element.title).trim() || "Untitled";
  const planned: PlannedOutlineItem[] = [];
  let hasUnresolvedAttachment = false;
  // An element may legitimately attach the same song twice (a reprise); the
  // occurrence count keeps those from collapsing onto one listId.
  const keyUses = new Map<string, number>();
  const listIdFor = (key: string) => {
    const used = keyUses.get(key) ?? 0;
    keyUses.set(key, used + 1);
    return outlineListIdFor(element, key, used);
  };

  for (const storedSongRef of getServicePlanElementSongRefs(element)) {
    // A song the import couldn't find may have been added to the library since,
    // so the stored reference is re-checked rather than trusted — otherwise a
    // song that plainly exists is dropped on its way to the screen.
    const songRef = resolveServicePlanSongRef(storedSongRef, songs);
    if (songRef?.kind === "library") {
      planned.push({
        kind: "song",
        listId: listIdFor(`song:${songRef.songId}`),
        songId: songRef.songId,
        songName: songRef.songName,
      });
      continue;
    }
    // Still nothing in the library to reference. The rest of the element is
    // pushed regardless — one unmatched song is no reason to leave an operator
    // without the songs and scripture that did resolve.
    hasUnresolvedAttachment = true;
  }

  for (const scriptureRef of getServicePlanElementScriptureRefs(element)) {
    planned.push({
      kind: "scripture",
      listId: listIdFor(
        `bible:${scriptureRef.book}:${scriptureRef.chapter}:${scriptureRef.verseRange}:${scriptureRef.version}`,
      ),
      scriptureRef,
    });
  }

  if (!planned.length && !hasUnresolvedAttachment) {
    planned.push({ kind: "placeholder", listId: outlineListIdFor(element, "item", 0) });
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

const buildOutlineItem = async ({
  planned,
  plan,
  list,
  db,
  bibleDb,
}: {
  planned: PlannedOutlineItem;
  plan: ElementOutlinePlan;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
}): Promise<ServiceItem> => {
  if (planned.kind === "song") {
    return {
      _id: planned.songId,
      name: planned.songName,
      type: "song",
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

  if (plan.element.type === "heading") {
    const result = await createNewHeading({ name: plan.title, list, db });
    return { ...result, listId: planned.listId };
  }

  const result = await createNewFreeForm({
    name: plan.title,
    text: richTextToFormattedPlainText(plan.element.notes),
    list,
    db,
    background: "",
    brightness: 100,
  });
  return {
    _id: result._id,
    name: result.name,
    type: "free",
    background: result.background,
    listId: planned.listId,
  };
};

export const buildServicePlanOutlineItems = async ({
  plan,
  currentList,
  db,
  bibleDb,
  songs,
}: {
  plan: ServicePlan;
  currentList: ServiceItem[];
  db: PouchDB.Database | undefined;
  bibleDb?: PouchDB.Database | undefined;
  /** The song library as it stands now, for re-checking unmatched imports.
   * Required rather than defaulted: omitting it silently drops songs. */
  songs: ServiceItem[];
}): Promise<ServicePlanOutlinePushResult> => {
  const items: ServiceItem[] = [];
  const skippedTitles: string[] = [];
  const updatedSections: ServicePlanSection[] = [];
  let workingList = currentList;
  let insertedCount = 0;

  for (const section of plan.sections) {
    const elementPlans = section.elements.map((element) =>
      planElementOutlineItems(element, songs),
    );

    // A song with nothing behind it in the library is the operator's to fix, so
    // it is reported whether or not the rest of the element gets pushed.
    for (const elementPlan of elementPlans) {
      if (elementPlan.hasUnresolvedAttachment) {
        skippedTitles.push(elementPlan.title);
      }
    }

    // Resolved against the list as it stands before this section adds anything;
    // each element's ids are its own, so nothing here interferes.
    const listBeforeSection = workingList;
    const sectionAdditions = elementPlans.map((elementPlan) =>
      missingPlannedItems(listBeforeSection, elementPlan),
    );
    if (!sectionAdditions.some((additions) => additions.length)) {
      updatedSections.push(section);
      continue;
    }

    const headingResult = await createNewHeading({
      name: section.name || "Section",
      list: workingList,
      db,
    });
    const headingItem: ServiceItem = {
      ...headingResult,
      listId: generateRandomId(),
    };
    workingList = [...workingList, headingItem];
    items.push(headingItem);

    const updatedElements: ServicePlanElement[] = [];
    for (const [index, elementPlan] of elementPlans.entries()) {
      const additions = sectionAdditions[index];
      if (!additions.length) {
        updatedElements.push(elementPlan.element);
        continue;
      }

      const elementItems: ServiceItem[] = [];
      for (const planned of additions) {
        // eslint-disable-next-line no-await-in-loop -- each item may write a new library doc, order matters
        const item = await buildOutlineItem({
          planned,
          plan: elementPlan,
          list: workingList,
          db,
          bibleDb,
        });
        elementItems.push(item);
        workingList = [...workingList, item];
      }

      items.push(...elementItems);
      insertedCount += elementItems.length;
      updatedElements.push({
        ...elementPlan.element,
        // Every planned id, not just the ones added now: the rest are already
        // on the list, and the stamp describes the element as a whole.
        pushedOutlineListId: elementPlan.planned[0].listId,
        pushedOutlineListIds: elementPlan.planned.map(({ listId }) => listId),
      });
    }

    updatedSections.push({ ...section, elements: updatedElements });
  }

  return { items, updatedSections, insertedCount, skippedTitles };
};
