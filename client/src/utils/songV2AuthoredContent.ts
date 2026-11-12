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
