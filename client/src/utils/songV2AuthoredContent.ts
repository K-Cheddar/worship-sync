import type { SongV2Documents } from "../types";

type AuthoredDocument = SongV2Documents["root"] | SongV2Documents["arrangements"][number] | SongV2Documents["slides"][number];

const ignoredDocumentFields = new Set([
  "_rev", "_revisions", "_conflicts", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);

export const canonicalSongV2Value = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalSongV2Value);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalSongV2Value(child)]));
  }
  return value;
};

export type SongV2ThreeWayMerge = { ok: true; value: unknown } | { ok: false };
const sameCanonicalValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalSongV2Value(left)) === JSON.stringify(canonicalSongV2Value(right));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Merge independent JSON fields, retaining ordered arrays unless their IDs are stable. */
export function mergeSongV2AuthoredValue(
  base: unknown,
  winner: unknown,
  branch: unknown,
): SongV2ThreeWayMerge {
  if (sameCanonicalValue(winner, base)) return { ok: true, value: branch };
  if (sameCanonicalValue(branch, base) || sameCanonicalValue(winner, branch)) {
    return { ok: true, value: winner };
  }
  if (isRecord(base) && isRecord(winner) && isRecord(branch)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(winner), ...Object.keys(branch)]);
    for (const key of keys) {
      const value = mergeSongV2AuthoredValue(base[key], winner[key], branch[key]);
      if (!value.ok) return value;
      if (value.value !== undefined) result[key] = value.value;
    }
    return { ok: true, value: result };
  }
  if (Array.isArray(base) && Array.isArray(winner) && Array.isArray(branch)) {
    const ids = (values: unknown[]) => values.map(value =>
      isRecord(value) && typeof value.id === "string" ? value.id : null,
    );
    const baseIds = ids(base);
    if (baseIds.every(id => id !== null) && new Set(baseIds).size === baseIds.length &&
      sameCanonicalValue(baseIds, ids(winner)) && sameCanonicalValue(baseIds, ids(branch))) {
      const values: unknown[] = [];
      for (let index = 0; index < base.length; index += 1) {
        const value = mergeSongV2AuthoredValue(base[index], winner[index], branch[index]);
        if (!value.ok) return value;
        values.push(value.value);
      }
      return { ok: true, value: values };
    }
  }
  return { ok: false };
}

const authoredValue = (document: AuthoredDocument) => canonicalSongV2Value(
  Object.fromEntries(Object.entries(document).filter(([key]) => !ignoredDocumentFields.has(key))),
);

/** Uses the writer's authored-content rules; audit fields and revision metadata are not edits. */
export const sameSongV2DocumentAuthoredContent = (left: AuthoredDocument, right: AuthoredDocument) =>
  left._id === right._id && JSON.stringify(authoredValue(left)) === JSON.stringify(authoredValue(right));

/** Compares the complete serialized song while ignoring physical revision and audit metadata. */
export function sameSongV2AuthoredContent(left: SongV2Documents, right: SongV2Documents): boolean {
  const sameDocuments = <T extends AuthoredDocument>(leftDocuments: T[], rightDocuments: T[]) => {
    if (leftDocuments.length !== rightDocuments.length) return false;
    const rightById = new Map(rightDocuments.map(document => [document._id, document]));
    return leftDocuments.every(document => {
      const matching = rightById.get(document._id);
      return !!matching && sameSongV2DocumentAuthoredContent(document, matching);
    });
  };
  return sameSongV2DocumentAuthoredContent(left.root, right.root) &&
    sameDocuments(left.arrangements, right.arrangements) &&
    sameDocuments(left.slides, right.slides);
}

export const canonicalSongV2AuthoredDocument = (document: AuthoredDocument) => JSON.stringify(authoredValue(document));
