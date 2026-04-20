import type PouchDB from "pouchdb-browser";
import type { ParsedBibleRef } from "../integrations/servicePlanning/parseBibleReference";
import type { BibleFontMode, MediaType, ServiceItem } from "../types";
import type { OutlineItemCandidate } from "../types/servicePlanningImport";
import generateRandomId from "./generateRandomId";
import { createNewHeading } from "./itemUtil";
import { createBibleItemFromParsedReference } from "./servicePlanningBibleImport";

type InsertServicePlanningOutlineCandidatesArgs = {
  outlineCandidates: OutlineItemCandidate[];
  currentList: ServiceItem[];
  allItems: ServiceItem[];
  db: PouchDB.Database | undefined;
  bibleDb?: Pick<PouchDB.Database, "get" | "put"> | undefined;
  defaultBibleBackground: string;
  defaultBibleMediaInfo?: MediaType;
  defaultBibleBackgroundBrightness: number;
  defaultBibleFontMode: BibleFontMode;
};

type InsertServicePlanningOutlineCandidatesResult = {
  newList: ServiceItem[];
  inserted: number;
  createdAllItems: ServiceItem[];
  listChanged: boolean;
};

const isInsertableSongCandidate = (candidate: OutlineItemCandidate) =>
  candidate.outlineItemType === "song" &&
  Boolean(candidate.headingName) &&
  Boolean(candidate.matchedLibraryItem);

const isInsertableBibleCandidate = (candidate: OutlineItemCandidate) =>
  candidate.outlineItemType === "bible" &&
  Boolean(candidate.headingName) &&
  Boolean(candidate.parsedRef);

type HeadingGroup = {
  headingName: string;
  candidates: OutlineItemCandidate[];
};

export const insertServicePlanningOutlineCandidates = async ({
  outlineCandidates,
  currentList,
  allItems,
  db,
  bibleDb,
  defaultBibleBackground,
  defaultBibleMediaInfo,
  defaultBibleBackgroundBrightness,
  defaultBibleFontMode,
}: InsertServicePlanningOutlineCandidatesArgs): Promise<InsertServicePlanningOutlineCandidatesResult> => {
  const groups: HeadingGroup[] = [];
  const seenHeadings = new Set<string>();
  for (const candidate of outlineCandidates) {
    if (
      !isInsertableSongCandidate(candidate) &&
      !isInsertableBibleCandidate(candidate)
    ) {
      continue;
    }
    const headingName = candidate.headingName!;
    if (!seenHeadings.has(headingName)) {
      seenHeadings.add(headingName);
      groups.push({ headingName, candidates: [] });
    }
    groups
      .find((group) => group.headingName === headingName)!
      .candidates.push(candidate);
  }

  if (groups.length === 0) {
    return {
      newList: currentList,
      inserted: 0,
      createdAllItems: [],
      listChanged: false,
    };
  }

  let newList = [...currentList];
  let inserted = 0;
  const createdAllItems: ServiceItem[] = [];
  let listChanged = false;
  const currentAllItems = [...allItems];

  for (const group of groups) {
    let headingIndex = newList.findIndex(
      (item) =>
        item.type === "heading" &&
        item.name.toLowerCase() === group.headingName.toLowerCase(),
    );

    if (headingIndex === -1) {
      const result = await createNewHeading({
        name: group.headingName,
        list: newList,
        db,
      });
      const headingItem: ServiceItem = {
        ...result,
        listId: generateRandomId(),
      };
      newList = [...newList, headingItem];
      headingIndex = newList.length - 1;
      listChanged = true;
    }

    const existingNames = new Set<string>();
    for (let i = headingIndex + 1; i < newList.length; i++) {
      if (newList[i].type === "heading") break;
      existingNames.add(newList[i].name.toLowerCase());
    }

    let insertAfter = headingIndex;
    for (let i = headingIndex + 1; i < newList.length; i++) {
      if (newList[i].type === "heading") break;
      insertAfter = i;
    }

    for (const candidate of group.candidates) {
      let sourceItem: ServiceItem | null = null;

      if (
        candidate.outlineItemType === "song" &&
        candidate.matchedLibraryItem
      ) {
        sourceItem = candidate.matchedLibraryItem;
      } else if (candidate.outlineItemType === "bible" && candidate.parsedRef) {
        const createdBible = await createBibleItemFromParsedReference({
          parsedRef: candidate.parsedRef as ParsedBibleRef,
          name: candidate.title,
          db,
          bibleDb,
          allItems: currentAllItems,
          background: defaultBibleBackground,
          mediaInfo: defaultBibleMediaInfo,
          brightness: defaultBibleBackgroundBrightness,
          fontMode: defaultBibleFontMode,
        });
        sourceItem = {
          _id: createdBible._id,
          name: createdBible.name,
          type: "bible",
          background: createdBible.background,
          listId: generateRandomId(),
        };
        createdAllItems.push(sourceItem);
        currentAllItems.push(sourceItem);
      }

      if (!sourceItem) continue;

      const nameLower = sourceItem.name.toLowerCase();
      if (existingNames.has(nameLower)) continue;

      const outlineItem: ServiceItem = {
        ...sourceItem,
        listId: generateRandomId(),
      };
      newList = [
        ...newList.slice(0, insertAfter + 1),
        outlineItem,
        ...newList.slice(insertAfter + 1),
      ];
      existingNames.add(nameLower);
      insertAfter += 1;
      inserted += 1;
      listChanged = true;
    }
  }

  return { newList, inserted, createdAllItems, listChanged };
};
