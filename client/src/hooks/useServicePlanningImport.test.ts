import {
  dedupeOutlineCandidatesForPreview,
  getChangedOverlayPatch,
  getRepeatedOverlayDedupeKey,
  overlayPlanHasExecutableChange,
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

  it("clears an existing title when the service plan has no matching title", () => {
    expect(
      getChangedOverlayPatch(overlay, {
        name: "Avery",
        title: undefined,
        event: "Welcome",
      }),
    ).toEqual({ title: undefined });
  });
});

describe("getRepeatedOverlayDedupeKey", () => {
  it("returns a stable key when the rule opts into repeated-overlay dedupe", () => {
    expect(
      getRepeatedOverlayDedupeKey(
        {
          rule: {
            id: "song-rule",
            dedupeRepeatedOverlays: true,
          },
        } as any,
        {
          patch: {
            name: "Desmond Dunkley",
            title: "Praise God",
            event: "Song of Praise",
          },
        },
      ),
    ).toBe("song-rule::Desmond Dunkley::Praise God::Song of Praise");
  });

  it("returns null when repeated-overlay dedupe is off", () => {
    expect(
      getRepeatedOverlayDedupeKey(
        {
          rule: {
            id: "song-rule",
            dedupeRepeatedOverlays: false,
          },
        } as any,
        {
          patch: {
            name: "Desmond Dunkley",
            title: "Praise God",
            event: "Song of Praise",
          },
        },
      ),
    ).toBeNull();
  });
});

describe("overlayPlanHasExecutableChange", () => {
  it("does not treat existing-overlay placement as executable by itself", () => {
    const overlays: OverlayInfo[] = [
      { id: "welcome", type: "participant", event: "Welcome", name: "Avery" },
      {
        id: "sabbath",
        type: "participant",
        event: "Sabbath School",
        name: "Taylor",
      },
    ];

    expect(
      overlayPlanHasExecutableChange(
        [
          {
            sectionName: "",
            sourceRowIndex: 0,
            elementType: "Sabbath School",
            title: "",
            ledBy: "",
            personIndex: 0,
            rawNameToken: "Taylor",
            action: "update",
            placementOnly: true,
            targetOverlayId: "sabbath",
            patch: {
              name: "Taylor",
              event: "Sabbath School",
              title: undefined,
            },
          },
        ],
        overlays,
      ),
    ).toBe(false);
  });

  it("does not treat an already positioned overlay as executable by itself", () => {
    const overlays: OverlayInfo[] = [
      {
        id: "sabbath",
        type: "participant",
        event: "Sabbath School",
        name: "Taylor",
      },
    ];

    expect(
      overlayPlanHasExecutableChange(
        [
          {
            sectionName: "",
            sourceRowIndex: 0,
            elementType: "Sabbath School",
            title: "",
            ledBy: "",
            personIndex: 0,
            rawNameToken: "Taylor",
            action: "update",
            placementOnly: true,
            targetOverlayId: "sabbath",
            patch: {
              name: "Taylor",
              event: "Sabbath School",
              title: undefined,
            },
          },
        ],
        overlays,
      ),
    ).toBe(false);
  });
});
