import {
  dedupeOutlineCandidatesForPreview,
  getChangedOverlayPatch,
} from "./useServicePlanningImport";
import type { OutlineItemCandidate } from "../types/servicePlanningImport";
import type { OverlayInfo } from "../types";

const makeSongCandidate = (
  overrides: Partial<OutlineItemCandidate> = {},
): OutlineItemCandidate => ({
  sectionName: "Worship",
  headingName: "Praise",
  elementType: "Song of Praise",
  title: "You Deserve It (F)",
  outlineItemType: "song",
  cleanedTitle: "You Deserve It",
  matchedLibraryItem: null,
  parsedRef: null,
  overlayReady: false,
  outlineAlreadyPresent: false,
  ...overrides,
});

describe("dedupeOutlineCandidatesForPreview", () => {
  it("removes duplicate song rows that would collapse into the same heading", () => {
    const deduped = dedupeOutlineCandidatesForPreview([
      makeSongCandidate(),
      makeSongCandidate({ title: "You Deserve It (F) reprise" }),
      makeSongCandidate({ title: "You Deserve It (F) tag" }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].cleanedTitle).toBe("You Deserve It");
  });

  it("keeps the same song when it belongs under a different heading", () => {
    const deduped = dedupeOutlineCandidatesForPreview([
      makeSongCandidate({ headingName: "Praise" }),
      makeSongCandidate({ headingName: "Response" }),
    ]);

    expect(deduped).toHaveLength(2);
  });
});

describe("getChangedOverlayPatch", () => {
  const overlay: OverlayInfo = {
    id: "overlay-1",
    type: "participant",
    name: "Avery",
    title: "Host",
    event: "Welcome",
  };

  it("returns no changes when the mapped fields already match", () => {
    expect(
      getChangedOverlayPatch(overlay, {
        name: "Avery",
        title: "Host",
        event: "Welcome",
      }),
    ).toEqual({});
  });

  it("returns only fields that differ", () => {
    expect(
      getChangedOverlayPatch(overlay, {
        name: "Avery",
        title: "Speaker",
        event: "Welcome",
      }),
    ).toEqual({ title: "Speaker" });
  });
});
