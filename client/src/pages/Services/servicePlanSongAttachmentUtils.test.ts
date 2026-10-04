import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanElement } from "../../types/servicePlan";
import { getServicePlanElementType } from "../../types/servicePlan";
import { getServicePlanSongReferencesUpdate } from "./servicePlanSongAttachmentUtils";

const element = (overrides: Partial<ServicePlanElement> = {}): ServicePlanElement => ({
  id: "element-1",
  type: "free",
  title: plainTextToRichText("Welcome Song"),
  ...overrides,
});

describe("getServicePlanSongReferencesUpdate", () => {
  it("clears dismissal state when an operator attaches a real library song", () => {
    const update = getServicePlanSongReferencesUpdate(element({
      sourceOccurrenceId: "source-1",
      sourceElementTypeRaw: "Song",
      sourceSongReferenceDismissed: true,
      sourceSongReferenceDismissedFingerprint: "old-song",
      sourceSongReferenceDismissedOccurrenceId: "source-1",
    }), [{ kind: "library", songId: "song-1", songName: "New Song" }]);

    expect(update).toEqual({
      songRef: undefined,
      songRefs: [{ kind: "library", songId: "song-1", songName: "New Song" }],
      sourceSongReferenceDismissed: undefined,
      sourceSongReferenceDismissedFingerprint: undefined,
      sourceSongReferenceDismissedOccurrenceId: undefined,
    });
    expect(getServicePlanElementType({ ...element(), ...update })).toBe("song");
  });
});
