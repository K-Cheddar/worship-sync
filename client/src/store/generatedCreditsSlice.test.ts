import generatedCreditsReducer, {
  initialGeneratedCreditsState,
  completeGeneratedCreditItem,
  completeGeneratedCredits,
  failGeneratedCredits,
  setGeneratedCreditActive,
  startGeneratedCredits,
} from "./generatedCreditsSlice";

const owner = {
  churchId: "church-1",
  databaseKey: "church-content",
  databaseScopeId: "church-content:church-1",
  databaseInstanceId: 1,
  outlineId: "outline-1",
};

describe("generatedCreditsSlice", () => {
  it("counts scheduled creates and updates but not unmatched entries", () => {
    const state = generatedCreditsReducer(
      initialGeneratedCreditsState,
      startGeneratedCredits({
        operationId: "generation-1",
        owner,
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
          {
            creditId: "schedule-skipped-camera",
            creditHeading: "Camera",
            sourceLabel: "Media schedule",
            previousText: "Manual edit",
            nextText: "Manual edit",
            status: "skipped",
            reason: "The media schedule couldn't be loaded.",
          },
        ],
      }),
    );

    expect(state.totalSteps).toBe(2);
    expect(state.items.map((item) => item.status)).toEqual([
      "pending",
      "creating",
      "unmatched",
      "skipped",
    ]);
  });

  it("ignores a late completion from an older operation after a newer outline starts", () => {
    const operationA = startGeneratedCredits({
      operationId: "generation-A",
      owner,
      generatedAt: "2026-07-01T12:00:00.000Z",
      items: [{
        creditId: "shared-credit",
        creditHeading: "Welcome",
        sourceLabel: "Participant overlays",
        previousText: "Old",
        nextText: "A result",
      }],
    });
    const ownerB = { ...owner, churchId: "church-2", outlineId: "outline-1" };
    let state = generatedCreditsReducer(initialGeneratedCreditsState, operationA);
    state = generatedCreditsReducer(
      state,
      startGeneratedCredits({
        operationId: "generation-B",
        owner: ownerB,
        generatedAt: "2026-07-01T12:01:00.000Z",
        items: [{
          creditId: "shared-credit",
          creditHeading: "Welcome",
          sourceLabel: "Participant overlays",
          previousText: "Old B",
          nextText: "B result",
        }],
      }),
    );
    const afterBStarts = state;

    state = generatedCreditsReducer(
      state,
      setGeneratedCreditActive({
        operationId: "generation-A",
        creditId: "shared-credit",
      }),
    );
    state = generatedCreditsReducer(
      state,
      completeGeneratedCreditItem({
        operationId: "generation-A",
        creditId: "shared-credit",
        status: "updated",
      }),
    );
    state = generatedCreditsReducer(
      state,
      failGeneratedCredits({
        operationId: "generation-A",
        error: "A failed late",
      }),
    );
    state = generatedCreditsReducer(
      state,
      completeGeneratedCredits({ operationId: "generation-A" }),
    );

    expect(state).toEqual(afterBStarts);
    expect(state.operationId).toBe("generation-B");
    expect(state.owner).toEqual(ownerB);
    expect(state.status).toBe("running");
    expect(state.currentStep).toBe(0);
    expect(state.items[0]).toEqual(expect.objectContaining({
      nextText: "B result",
      status: "pending",
    }));
  });
});
