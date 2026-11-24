import {
  clearPresentationDiagnostics,
  getPresentationDiagnostics,
  recordPresentationDiagnostic,
} from "./presentationDiagnostics";

describe("presentationDiagnostics", () => {
  beforeEach(clearPresentationDiagnostics);

  it("retains a bounded chronological history with output and slide context", () => {
    for (let index = 0; index < 300; index += 1) {
      recordPresentationDiagnostic({
        at: index,
        event: "incoming.rejected",
        outputId: "monitor",
        itemId: "song-1",
        slideIndex: index,
        reason: "stale_timestamp",
      });
    }

    const events = getPresentationDiagnostics();
    expect(events).toHaveLength(256);
    expect(events[0]).toMatchObject({ at: 44, slideIndex: 44 });
    expect(events.at(-1)).toMatchObject({ at: 299, slideIndex: 299 });
  });
});
