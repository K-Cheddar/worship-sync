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
 *   - a "pending" song (lyrics captured but no song doc yet) → skipped and
 *     reported, since there's no library doc to reference;
 *   - anything unattached → a blank free-form item stamped with the element's
 *     title/notes: a real, editable placeholder in the correct running order
 *     rather than nothing at all.
 *
 * Idempotency is per-element via `pushedOutlineListId`: re-pushing a plan
 * skips any element whose previously-pushed listId is still present in the
 * live list, so re-pushing an unchanged plan doesn't duplicate items. If a
 * section has nothing new to add, no fresh heading is created for it either.
 * True update-in-place for an edited-then-re-pushed element (repositioning
 * it back under its original heading) is out of scope for v1.
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
  ServicePlanSection,
} from "../../types/servicePlan";

export type ServicePlanOutlinePushResult = {
  /** New items to append to the live list, in order (headings + content). */
  items: ServiceItem[];
  /** Plan sections with pushedOutlineListId stamped onto newly-pushed elements. */
  updatedSections: ServicePlanSection[];
  /** Count of content elements actually added (excludes heading items). */
  insertedCount: number;
  /** Titles of elements skipped because they had no real content to push yet. */
  skippedTitles: string[];
};

const findExistingListId = (
  currentList: ServiceItem[],
  listId: string | undefined,
): ServiceItem | undefined =>
  listId ? currentList.find((item) => item.listId === listId) : undefined;

const sectionHasNewElements = (
  section: ServicePlanSection,
  list: ServiceItem[],
): boolean =>
  section.elements.some(
    (element) => !findExistingListId(list, element.pushedOutlineListId),
  );

const buildOutlineItemForElement = async ({
  element,
  list,
  db,
  bibleDb,
  songs,
}: {
  element: ServicePlanElement;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
  songs: ServiceItem[];
}): Promise<{ item: ServiceItem | null; skippedTitle: string | null }> => {
  const title = richTextToPlainText(element.title).trim() || "Untitled";

  if (element.songRef) {
    // A song the import couldn't find may have been added to the library since,
    // so the stored reference is re-checked rather than trusted — otherwise a
    // song that plainly exists is dropped on its way to the screen.
    const songRef = resolveServicePlanSongRef(element.songRef, songs);
    if (songRef?.kind === "library") {
      return {
        item: {
          _id: songRef.songId,
          name: songRef.songName,
          type: "song",
          listId: generateRandomId(),
        },
        skippedTitle: null,
      };
    }
    // Still nothing in the library to reference.
    return { item: null, skippedTitle: title };
  }

  if (element.scriptureRef) {
    const created = await createBibleItemFromParsedReference({
      parsedRef: {
        book: element.scriptureRef.book,
        chapter: element.scriptureRef.chapter,
        verseRange: element.scriptureRef.verseRange,
        version: element.scriptureRef.version,
      },
      db,
      bibleDb,
      allItems: list,
      background: "",
      brightness: 100,
      fontMode: "fit",
    });
    return {
      item: {
        _id: created._id,
        name: created.name,
        type: "bible",
        background: created.background,
        listId: generateRandomId(),
      },
      skippedTitle: null,
    };
  }

  if (element.type === "heading") {
    const result = await createNewHeading({ name: title, list, db });
    return {
      item: { ...result, listId: generateRandomId() },
      skippedTitle: null,
    };
  }

  const result = await createNewFreeForm({
    name: title,
    text: richTextToFormattedPlainText(element.notes),
    list,
    db,
    background: "",
    brightness: 100,
  });
  return {
    item: {
      _id: result._id,
      name: result.name,
      type: "free",
      background: result.background,
      listId: generateRandomId(),
    },
    skippedTitle: null,
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
    if (!sectionHasNewElements(section, workingList)) {
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
    for (const element of section.elements) {
      const existing = findExistingListId(
        workingList,
        element.pushedOutlineListId,
      );
      if (existing) {
        updatedElements.push(element);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop -- each item may write a new library doc, order matters
      const { item, skippedTitle } = await buildOutlineItemForElement({
        element,
        list: workingList,
        db,
        bibleDb,
        songs,
      });

      if (skippedTitle) {
        skippedTitles.push(skippedTitle);
        updatedElements.push(element);
        continue;
      }
      if (!item) {
        updatedElements.push(element);
        continue;
      }

      workingList = [...workingList, item];
      items.push(item);
      insertedCount += 1;
      updatedElements.push({ ...element, pushedOutlineListId: item.listId });
    }

    updatedSections.push({ ...section, elements: updatedElements });
  }

  return { items, updatedSections, insertedCount, skippedTitles };
};
