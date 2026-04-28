import type PouchDB from "pouchdb-browser";
import type { ParsedBibleRef } from "../integrations/servicePlanning/parseBibleReference";
import type { BibleFontMode, MediaType, ServiceItem } from "../types";
import type { OutlineItemCandidate } from "../types/servicePlanningImport";
import generateRandomId from "./generateRandomId";
import { createNewHeading } from "./itemUtil";
import {
  createBibleItemFromParsedReference,
  getBibleImportDisplayName,
} from "./servicePlanningBibleImport";

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

const normalizeOutlineItemName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

const findHeadingIndex = (list: ServiceItem[], headingName: string): number =>
  list.findIndex(
    (item) =>
      item.type === "heading" &&
      normalizeOutlineItemName(item.name) ===
        normalizeOutlineItemName(headingName),
  );

const getSectionEndIndex = (
  list: ServiceItem[],
  headingIndex: number,
): number => {
  for (let i = headingIndex + 1; i < list.length; i++) {
    if (list[i].type === "heading") return i;
  }
  return list.length;
};

const getOutlineCandidateItemName = (
  candidate: OutlineItemCandidate,
): string | null => {
  if (candidate.outlineItemType === "song") {
    return candidate.matchedLibraryItem?.name ?? null;
  }
  if (candidate.outlineItemType === "bible" && candidate.parsedRef) {
    return (
      candidate.title?.trim() ||
      getBibleImportDisplayName(
        candidate.parsedRef,
        candidate.parsedRef.version,
      )
    );
  }
  return null;
};

export const isOutlineCandidatePresentInList = (
  list: ServiceItem[],
  headingName: string,
  candidate: OutlineItemCandidate,
): boolean => {
  const headingIndex = findHeadingIndex(list, headingName);
  if (headingIndex === -1) return false;

  const candidateName = getOutlineCandidateItemName(candidate);
  if (!candidateName) return false;

  const candidateNameLower = normalizeOutlineItemName(candidateName);
  const sectionEndIndex = getSectionEndIndex(list, headingIndex);

  return list
    .slice(headingIndex + 1, sectionEndIndex)
    .some((item) => normalizeOutlineItemName(item.name) === candidateNameLower);
};

export const planServicePlanningOutlineSyncSteps = (
  outlineCandidates: OutlineItemCandidate[],
  currentList: ServiceItem[] = [],
): ServicePlanningOutlineSyncStep[] => {
  const groups = buildHeadingGroups(outlineCandidates);
  const steps: ServicePlanningOutlineSyncStep[] = [];
  let plannedList = [...currentList];

  for (const group of groups) {
    const headingExists = findHeadingIndex(plannedList, group.headingName) !== -1;
    const itemSteps: ServicePlanningOutlineSyncStep[] = [];
    let groupList = plannedList;

    if (!headingExists) {
      groupList = [
        ...plannedList,
        {
          _id: `planned-heading-${group.headingName}`,
          name: group.headingName,
          type: "heading",
          listId: `planned-heading-${group.headingName}`,
        },
      ];
    }

    for (const candidate of group.candidates) {
      if (isOutlineCandidatePresentInList(groupList, group.headingName, candidate)) {
        continue;
      }
      const candidateName = getOutlineCandidateItemName(candidate);
      if (!candidateName) continue;

      itemSteps.push({
        kind:
          candidate.outlineItemType === "bible" ? "insertBible" : "insertSong",
        headingName: group.headingName,
        candidate,
      });
      groupList = [
        ...groupList,
        {
          _id: `planned-item-${group.headingName}-${candidateName}`,
          name: candidateName,
          type: candidate.outlineItemType,
          listId: `planned-item-${group.headingName}-${candidateName}`,
        },
      ];
    }

    if (itemSteps.length === 0) {
      continue;
    }

    if (!headingExists) {
      steps.push({
        kind: "ensureHeading",
        headingName: group.headingName,
      });
    }
    steps.push(...itemSteps);
    plannedList = groupList;
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
  let headingIndex = findHeadingIndex(currentList, headingName);

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

  if (
    isOutlineCandidatePresentInList(
      ensured.newList,
      step.headingName,
      step.candidate,
    )
  ) {
    return {
      newList: ensured.newList,
      inserted: 0,
      createdAllItems,
      listChanged: ensured.listChanged,
      activeListId: ensured.createdHeadingListId,
    };
  }

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
  const steps = planServicePlanningOutlineSyncSteps(
    outlineCandidates,
    currentList,
  );

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
