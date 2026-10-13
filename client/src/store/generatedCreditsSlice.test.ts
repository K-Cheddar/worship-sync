import generatedCreditsReducer, {
  initialGeneratedCreditsState,
  startGeneratedCredits,
} from "./generatedCreditsSlice";

describe("generatedCreditsSlice", () => {
  it("counts scheduled creates and updates but not unmatched entries", () => {
    const state = generatedCreditsReducer(
      initialGeneratedCreditsState,
      startGeneratedCredits({
        generatedAt: "2026-07-01T12:00:00.000Z",
        items: [
          {
            creditId: "credit-1",
            creditHeading: "Camera Operators",
            sourceLabel: "Media schedule",
            previousText: "",
            nextText: "Alice",
          },
          {
            creditId: "credit-created",
            creditHeading: "Stage Manager",
            sourceLabel: "Media schedule",
            previousText: "",
            nextText: "Jesse Green",
            status: "creating",
          },
          {
            creditId: "schedule-miss-1-stream-audio",
            creditHeading: "Stream Audio",
            sourceLabel: "Media schedule",
            previousText: "",
            nextText: "Sam",
            status: "unmatched",
          },
        ],
      }),
    );

    expect(state.totalSteps).toBe(2);
    expect(state.items.map((item) => item.status)).toEqual([
      "pending",
      "creating",
      "unmatched",
    ]);
  });
});
