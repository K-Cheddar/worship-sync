import generatedCreditsReducer, {
  initialGeneratedCreditsState,
  startGeneratedCredits,
} from "./generatedCreditsSlice";

describe("generatedCreditsSlice", () => {
  it("keeps missed schedule entries out of the update step count", () => {
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
            creditId: "schedule-miss-1-stream-audio",
            creditHeading: "Stream Audio",
            sourceLabel: "Media schedule",
            previousText: "",
            nextText: "Sam",
            status: "missed",
          },
        ],
      }),
    );

    expect(state.totalSteps).toBe(1);
    expect(state.items.map((item) => item.status)).toEqual([
      "pending",
      "missed",
    ]);
  });
});
