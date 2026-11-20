import type { DBItem, ServiceItem } from "../types";

export type ItemLibrarySortField = "relevance" | "name" | "updatedAt" | "createdAt" | "updatedBy";
export type ItemLibrarySortDirection = "ascending" | "descending";

export type ItemLibraryAuditDisplay = {
  updatedAt: string;
  updatedBy: string;
};

/** Map displayed result objects back to their first index in the unsorted source list. */
export const getItemLibrarySourceIndices = <T,>(items: readonly T[]): ReadonlyMap<T, number> => {
  const indices = new Map<T, number>();
  items.forEach((item, index) => {
    if (!indices.has(item)) indices.set(item, index);
  });
  return indices;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/;
const localDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const parseItemAuditDate = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = isoDatePattern.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null;
  const dateValue = value.trim();
  const timestamp = dateValue.includes("T")
    ? Date.parse(dateValue)
    : new Date(year, month - 1, day).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const formatItemAuditDate = (value: unknown): string => {
  const timestamp = parseItemAuditDate(value);
  return timestamp === null ? "—" : localDateFormatter.format(timestamp);
};

const parseAuditActor = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const actor = value.trim();
  return actor && actor.toLowerCase() !== "unknown" ? actor : null;
};

const auditActor = (value: unknown): string => parseAuditActor(value) ?? "—";

export const getItemLibraryAuditDisplay = (
  document: DBItem | undefined,
): ItemLibraryAuditDisplay => ({
  updatedAt: formatItemAuditDate(document?.updatedAt),
  updatedBy: auditActor(document?.updatedBy),
});

const compareNullable = <T,>(
  left: T | null,
  right: T | null,
  compare: (a: T, b: T) => number,
  direction: ItemLibrarySortDirection,
): number => {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const compared = compare(left, right);
  return direction === "ascending" ? compared : -compared;
};

export const sortItemLibraryResults = <T extends ServiceItem & { matchRank?: number }>(
  items: readonly T[],
  docsById: ReadonlyMap<string, DBItem>,
  field: ItemLibrarySortField,
  direction: ItemLibrarySortDirection,
): T[] => [...items].sort((left, right) => {
  const leftDoc = docsById.get(left._id);
  const rightDoc = docsById.get(right._id);
  let primary = 0;

  if (field === "relevance") {
    const compared = (left.matchRank ?? 0) - (right.matchRank ?? 0);
    primary = direction === "ascending" ? compared : -compared;
  } else if (field === "name") {
    primary = collator.compare(left.name, right.name);
    if (direction === "descending") primary = -primary;
  } else if (field === "updatedAt" || field === "createdAt") {
    primary = compareNullable(
      parseItemAuditDate(leftDoc?.[field]),
      parseItemAuditDate(rightDoc?.[field]),
      (a, b) => a - b,
      direction,
    );
  } else {
    const leftActor = parseAuditActor(leftDoc?.updatedBy);
    const rightActor = parseAuditActor(rightDoc?.updatedBy);
    primary = compareNullable(leftActor, rightActor, collator.compare, direction);
  }

  return primary || collator.compare(left.name, right.name) || left._id.localeCompare(right._id);
});
