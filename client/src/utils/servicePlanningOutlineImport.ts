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

export type ExecuteServicePlanningOutlineStepResult = {
  newList: ServiceItem[];
  inserted: number;
  createdAllItems: ServiceItem[];
  listChanged: boolean;
  activeListId?: string;
};

export type ServicePlanningOutlineSyncStep =
  | {
      kind: "ensureHeading";
      headingName: string;
    }
  | {
      kind: "insertSong";
      headingName: string;
      candidate: OutlineItemCandidate;
    }
  | {
      kind: "insertBible";
      headingName: string;
      candidate: OutlineItemCandidate;
    };

type ExecuteServicePlanningOutlineStepArgs = Omit<
  InsertServicePlanningOutlineCandidatesArgs,
  "outlineCandidates"
> & {
  step: ServicePlanningOutlineSyncStep;
};

type HeadingGroup = {
  headingName: string;
  candidates: OutlineItemCandidate[];
};

const isInsertableSongCandidate = (candidate: OutlineItemCandidate) =>
  candidate.outlineItemType === "song" &&
  Boolean(candidate.headingName) &&
  Boolean(candidate.matchedLibraryItem);

const isInsertableBibleCandidate = (candidate: OutlineItemCandidate) =>
  candidate.outlineItemType === "bible" &&
  Boolean(candidate.headingName) &&
  Boolean(candidate.parsedRef);

const buildHeadingGroups = (
  outlineCandidates: OutlineItemCandidate[],
): HeadingGroup[] => {
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

  return groups;
};

export const planServicePlanningOutlineSyncSteps = (
  outlineCandidates: OutlineItemCandidate[],
): ServicePlanningOutlineSyncStep[] => {
  const groups = buildHeadingGroups(outlineCandidates);
  const steps: ServicePlanningOutlineSyncStep[] = [];

  for (const group of groups) {
    steps.push({
      kind: "ensureHeading",
      headingName: group.headingName,
    });
    for (const candidate of group.candidates) {
      steps.push({
        kind:
          candidate.outlineItemType === "bible" ? "insertBible" : "insertSong",
        headingName: group.headingName,
        candidate,
      });
    }
  }

  return steps;
};

const ensureHeadingInList = async ({
  headingName,
  currentList,
  db,
}: {
  headingName: string;
  currentList: ServiceItem[];
  db: PouchDB.Database | undefined;
}) => {
  let headingIndex = currentList.findIndex(
    (item) =>
      item.type === "heading" &&
      item.name.toLowerCase() === headingName.toLowerCase(),
  );

  if (headingIndex !== -1) {
    return {
      newList: currentList,
      headingIndex,
      createdHeadingListId: undefined as string | undefined,
      listChanged: false,
    };
  }

  const result = await createNewHeading({
    name: headingName,
    list: currentList,
    db,
  });
  const headingItem: ServiceItem = {
    ...result,
    listId: generateRandomId(),
  };
  const newList = [...currentList, headingItem];
  headingIndex = newList.length - 1;

  return {
    newList,
    headingIndex,
    createdHeadingListId: headingItem.listId,
    listChanged: true,
  };
};

export const executeServicePlanningOutlineSyncStep = async ({
  step,
  currentList,
  allItems,
  db,
  bibleDb,
  defaultBibleBackground,
  defaultBibleMediaInfo,
  defaultBibleBackgroundBrightness,
  defaultBibleFontMode,
}: ExecuteServicePlanningOutlineStepArgs): Promise<ExecuteServicePlanningOutlineStepResult> => {
  const ensured = await ensureHeadingInList({
    headingName: step.headingName,
    currentList,
    db,
  });

  if (step.kind === "ensureHeading") {
    return {
      newList: ensured.newList,
      inserted: 0,
      createdAllItems: [],
      listChanged: ensured.listChanged,
      activeListId: ensured.createdHeadingListId,
    };
  }

  let sourceItem: ServiceItem | null = null;
  const createdAllItems: ServiceItem[] = [];
  const currentAllItems = [...allItems];

  if (step.kind === "insertSong" && step.candidate.matchedLibraryItem) {
    sourceItem = step.candidate.matchedLibraryItem;
  } else if (step.kind === "insertBible" && step.candidate.parsedRef) {
    const createdBible = await createBibleItemFromParsedReference({
      parsedRef: step.candidate.parsedRef as ParsedBibleRef,
      name: step.candidate.title,
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
  }

  if (!sourceItem) {
    return {
      newList: ensured.newList,
      inserted: 0,
      createdAllItems,
      listChanged: ensured.listChanged,
      activeListId: ensured.createdHeadingListId,
    };
  }

  const existingNames = new Set<string>();
  for (let i = ensured.headingIndex + 1; i < ensured.newList.length; i++) {
    if (ensured.newList[i].type === "heading") break;
    existingNames.add(ensured.newList[i].name.toLowerCase());
  }

  const nameLower = sourceItem.name.toLowerCase();
  if (existingNames.has(nameLower)) {
    return {
      newList: ensured.newList,
      inserted: 0,
      createdAllItems,
      listChanged: ensured.listChanged,
      activeListId: ensured.createdHeadingListId,
    };
  }

  let insertAfter = ensured.headingIndex;
  for (let i = ensured.headingIndex + 1; i < ensured.newList.length; i++) {
    if (ensured.newList[i].type === "heading") break;
    insertAfter = i;
  }

  const outlineItem: ServiceItem = {
    ...sourceItem,
    listId: generateRandomId(),
  };
  const newList = [
    ...ensured.newList.slice(0, insertAfter + 1),
    outlineItem,
    ...ensured.newList.slice(insertAfter + 1),
  ];

  return {
    newList,
    inserted: 1,
    createdAllItems,
    listChanged: true,
    activeListId: outlineItem.listId,
  };
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
  const steps = planServicePlanningOutlineSyncSteps(outlineCandidates);

  if (steps.length === 0) {
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

  for (const step of steps) {
    const result = await executeServicePlanningOutlineSyncStep({
      step,
      currentList: newList,
      allItems: [...allItems, ...createdAllItems],
      db,
      bibleDb,
      defaultBibleBackground,
      defaultBibleMediaInfo,
      defaultBibleBackgroundBrightness,
      defaultBibleFontMode,
    });

    newList = result.newList;
    inserted += result.inserted;
    createdAllItems.push(...result.createdAllItems);
    listChanged = listChanged || result.listChanged;
  }

  return { newList, inserted, createdAllItems, listChanged };
};
