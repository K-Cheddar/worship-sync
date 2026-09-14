import { act, renderHook, waitFor } from "@testing-library/react";
import {
  isMatchingServicePlanWrite,
  useServicePlanAutosave,
  type UseServicePlanAutosaveOptions,
} from "./useServicePlanAutosave";
import type { ServicePlan, ServicePlanPayload } from "../../types/servicePlan";

const payloadFor = (name: string): ServicePlanPayload =>
  ({
    serviceId: "svc1",
    date: "2026-07-26",
    name,
    sections: [],
  }) as ServicePlanPayload;

const planFor = (planKey: string, revision: number): ServicePlan =>
  ({ planKey, revision, sections: [] }) as unknown as ServicePlan;

const conflictError = (plan: ServicePlan) =>
  Object.assign(new Error("conflict"), { conflictPlan: plan });

// The hook is generic over the document it saves (plans and templates both
// use it), so name the plan instantiation these tests exercise.
type Options = UseServicePlanAutosaveOptions<ServicePlan, ServicePlanPayload>;

const setup = (overrides: Partial<Options> = {}) => {
  const onSaved = jest.fn();
  const onConflict = jest.fn();
  const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
    async () => planFor("plan-a", 1),
  );
  const options: Options = {
    enabled: true,
    resetKey: "plan-a",
    changeVersion: 0,
    baseRevision: 0,
    buildPayload: () => payloadFor("A"),
    save,
    getConflictPlan: () => null,
    isOwnWrite: (doc, payload) => isMatchingServicePlanWrite(doc, payload),
    onSaved,
    onConflict,
    ...overrides,
  };
  const view = renderHook((props: Options) => useServicePlanAutosave(props), {
    initialProps: options,
  });
  return { view, save, onSaved, onConflict, options };
};

describe("useServicePlanAutosave", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("saves the newest snapshot after the debounce", async () => {
    const { view, save, onSaved, options } = setup();

    view.rerender({ ...options, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ name: "A" });
    expect(onSaved).toHaveBeenCalled();
  });

  it("uses the fetched revision for the first edit after the plan loads", async () => {
    const { view, save, options } = setup();

    // The hook mounts while the plan request is pending, then receives the
    // persisted document's revision on the same route.
    view.rerender({ ...options, baseRevision: 7 });
    view.rerender({ ...options, baseRevision: 7, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe(7);
  });

  it("does not replace the revision after local editing begins", async () => {
    const { view, save, options } = setup({ baseRevision: 3 });

    view.rerender({ ...options, baseRevision: 3, changeVersion: 1 });
    // A newer revision arriving after this edit belongs to another editor and
    // must remain a conflict, not silently become this save's base revision.
    view.rerender({ ...options, baseRevision: 7, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe(3);
  });

  // The template editor never feeds its saves back into `baseRevision` — a new
  // template identity resets its draft — so the prop stays on the revision the
  // document had before the first autosave. Adopting it again would send that
  // stale base with every later save, and the server would 409 forever.
  it("keeps the saved revision when baseRevision stays behind it", async () => {
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async (_payload, baseRevision) => planFor("plan-a", baseRevision + 1),
    );
    const { view, options } = setup({ baseRevision: 4, save });

    view.rerender({ ...options, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe(4);

    // Same stale prop, a second edit: the base has to be what the save returned.
    view.rerender({ ...options, changeVersion: 2 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1]).toBe(5);
  });

  it("identifies the revision expected from an in-flight save", async () => {
    let resolveSave: (plan: ServicePlan) => void = () => {};
    const save = jest.fn(
      () =>
        new Promise<ServicePlan>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { view, options } = setup({ save });

    view.rerender({ ...options, save, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(view.result.current.getInFlightExpectedRevision()).toBe(1);

    await act(async () => {
      resolveSave(planFor("plan-a", 1));
    });
    await waitFor(() =>
      expect(view.result.current.getInFlightExpectedRevision()).toBeNull(),
    );
  });

  it("ignores a save that resolves after the editor moved to another plan", async () => {
    // Regression: the editor stays mounted across prev/next, so an in-flight
    // save for plan A used to land on plan B — applying A's revision and
    // acking B's unsaved draft, which could then persist A's content under B.
    let resolveSave: (plan: ServicePlan) => void = () => {};
    const save = jest.fn(
      () =>
        new Promise<ServicePlan>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { view, onSaved, options } = setup({ save });

    view.rerender({ ...options, save, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // Operator hits "Next plan" while A's save is still in flight.
    view.rerender({
      ...options,
      save,
      resetKey: "plan-b",
      changeVersion: 1,
      buildPayload: () => payloadFor("B"),
    });

    await act(async () => {
      resolveSave(planFor("plan-a", 7));
    });

    // A's result must not be applied to the editor now showing B.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("persists a pending edit to the plan it belongs to when switching away", async () => {
    // Regression: navigating away cleared the debounce without saving, so the
    // last edit before prev/next was silently dropped.
    const saveA = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => planFor("plan-a", 1),
    );
    const saveB = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => planFor("plan-b", 1),
    );
    const { view, options } = setup({ save: saveA });

    // Dirty, but still inside the debounce window.
    view.rerender({ ...options, save: saveA, changeVersion: 1 });

    view.rerender({
      ...options,
      resetKey: "plan-b",
      changeVersion: 1,
      save: saveB,
      buildPayload: () => payloadFor("B"),
    });

    // Saved with plan A's own save function and payload, not plan B's.
    await waitFor(() => expect(saveA).toHaveBeenCalledTimes(1));
    expect(saveA.mock.calls[0][0]).toMatchObject({ name: "A" });
    expect(saveB).not.toHaveBeenCalled();
  });

  // Regression: `flush` looped while `changeVersion > savedVersion`, but
  // `saveLatest` resolves true *without* saving whenever it has nothing it can
  // do. The condition never changed, so the loop starved the event loop — a
  // frozen tab, not a failed save. Note the shape of a regression here is a
  // hung suite rather than a red test, which is the bug being guarded.
  it("gives up on a flush that cannot save because autosave is disabled", async () => {
    const { view, save, options } = setup({ enabled: false });

    view.rerender({ ...options, enabled: false, changeVersion: 1 });

    await expect(view.result.current.flush()).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("gives up on a flush when the draft cannot build a payload yet", async () => {
    const { view, save, options } = setup({ buildPayload: () => null });

    view.rerender({ ...options, buildPayload: () => null, changeVersion: 1 });

    await expect(view.result.current.flush()).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("carries edits made after the retry budget is spent", async () => {
    // Regression: the unsaved snapshot was only captured while autosave was
    // still scheduling. Once the retries ran out, further typing was never
    // captured, so leaving the page flushed the pre-failure draft over it.
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => {
        throw new Error("offline");
      },
    );
    const { view, options } = setup({ save });

    view.rerender({ ...options, save, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // Walk the retry ladder (2s, 5s, 15s) so the hook settles in "error".
    for (const delay of [2_000, 5_000, 15_000]) {
      await act(async () => {
        jest.advanceTimersByTime(delay + 100);
      });
    }
    await waitFor(() => expect(view.result.current.state).toBe("error"));
    expect(save).toHaveBeenCalledTimes(4);

    // The operator keeps working while the banner reads "Could not save".
    view.rerender({
      ...options,
      save,
      changeVersion: 2,
      buildPayload: () => payloadFor("C"),
    });

    view.unmount();

    await waitFor(() => expect(save).toHaveBeenCalledTimes(5));
    expect(save.mock.calls[4][0]).toMatchObject({ name: "C" });
  });

  it("sends the fetched revision after switching onto a lower-revision plan", async () => {
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async (_payload, baseRevision) => planFor("plan-b", baseRevision + 1),
    );
    const { view, options } = setup({
      resetKey: "plan-a",
      baseRevision: 50,
      save,
    });

    // Same mounted hook. The dated editor now reports 0 until the fetched
    // plan's identity matches, so this first render must not copy Sunday's 50.
    view.rerender({
      ...options,
      save,
      resetKey: "plan-b",
      baseRevision: 0,
      changeVersion: 0,
    });
    // Fetched document for the new plan. Must land while the draft is still
    // clean, matching the editor which keeps autosave disabled until sections
    // exist.
    view.rerender({
      ...options,
      save,
      resetKey: "plan-b",
      baseRevision: 3,
      changeVersion: 0,
    });
    expect(view.result.current.getRevision()).toBe(3);
    view.rerender({
      ...options,
      save,
      resetKey: "plan-b",
      baseRevision: 3,
      changeVersion: 1,
      buildPayload: () => payloadFor("B"),
    });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toBe(3);
  });

  it("saves an edit made during an in-flight request against the returned revision", async () => {
    let resolveFirst: (plan: ServicePlan) => void = () => {};
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      (_payload, baseRevision) => {
        if (save.mock.calls.length === 1) {
          return new Promise<ServicePlan>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(planFor("plan-a", baseRevision + 1));
      },
    );
    const { view, options } = setup({ baseRevision: 10, save });

    view.rerender({
      ...options,
      save,
      changeVersion: 1,
      buildPayload: () => payloadFor("A"),
    });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    view.rerender({
      ...options,
      save,
      changeVersion: 2,
      buildPayload: () => payloadFor("B"),
    });
    await act(async () => {
      resolveFirst(planFor("plan-a", 11));
    });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][1]).toBe(10);
    expect(save.mock.calls[1][0]).toMatchObject({ name: "B" });
    expect(save.mock.calls[1][1]).toBe(11);
  });

  it("keeps the expected acknowledgement revision while a failed save is retrying", async () => {
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => {
        throw new Error("offline");
      },
    );
    const { view, options } = setup({ save });

    view.rerender({ ...options, save, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.result.current.state).toBe("retrying"));
    expect(view.result.current.getInFlightExpectedRevision()).toBe(1);
  });

  it("treats a 409 of our own payload as an acknowledgement, not a conflict", async () => {
    const payload = payloadFor("A");
    const ownWrite = { ...planFor("plan-a", 1), name: "A", sections: [] };
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => {
        throw conflictError(ownWrite);
      },
    );
    const { view, onSaved, onConflict, options } = setup({
      save,
      buildPayload: () => payload,
      getConflictPlan: (error) =>
        error && typeof error === "object" && "conflictPlan" in error
          ? (error as { conflictPlan: ServicePlan }).conflictPlan
          : null,
    });

    view.rerender({
      ...options,
      save,
      buildPayload: () => payload,
      changeVersion: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(ownWrite));
    expect(onConflict).not.toHaveBeenCalled();
    expect(view.result.current.state).toBe("saved");
    expect(view.result.current.getRevision()).toBe(1);
  });

  it("still surfaces a 409 whose document is another editor's write", async () => {
    const theirWrite = {
      ...planFor("plan-a", 1),
      name: "Theirs",
      sections: [],
    };
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => {
        throw conflictError(theirWrite);
      },
    );
    const { view, onSaved, onConflict, options } = setup({
      save,
      getConflictPlan: (error) =>
        error && typeof error === "object" && "conflictPlan" in error
          ? (error as { conflictPlan: ServicePlan }).conflictPlan
          : null,
    });

    view.rerender({ ...options, save, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(theirWrite));
    expect(onSaved).not.toHaveBeenCalled();
    expect(view.result.current.state).toBe("conflict");
  });

  it("does not treat a generic save failure as a conflict", async () => {
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => {
        throw new Error("500");
      },
    );
    const { view, onConflict, options } = setup({ save });

    view.rerender({ ...options, save, changeVersion: 1 });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(view.result.current.state).toBe("retrying"));
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("acknowledges a lost HTTP response by loading the committed document", async () => {
    const payload = payloadFor("A");
    const ownWrite = { ...planFor("plan-a", 1), name: "A", sections: [] };
    const save = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => {
        throw new Error("network");
      },
    );
    const loadLatest = jest.fn(async () => ownWrite);
    const { view, onSaved, onConflict, options } = setup({
      save,
      loadLatest,
      buildPayload: () => payload,
    });

    view.rerender({
      ...options,
      save,
      loadLatest,
      buildPayload: () => payload,
      changeVersion: 1,
    });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });

    await waitFor(() => expect(loadLatest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(ownWrite));
    expect(save).toHaveBeenCalledTimes(1);
    expect(onConflict).not.toHaveBeenCalled();
    expect(view.result.current.state).toBe("saved");
  });

  it("flushes a newer pending snapshot with the in-flight save's returned revision", async () => {
    let resolveFirst: (plan: ServicePlan) => void = () => {};
    const saveA = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      (_payload, _baseRevision) => {
        if (saveA.mock.calls.length === 1) {
          return new Promise<ServicePlan>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(planFor("plan-a", 2));
      },
    );
    const saveB = jest.fn<Promise<ServicePlan>, [ServicePlanPayload, number]>(
      async () => planFor("plan-b", 1),
    );
    const { view, options } = setup({ save: saveA });

    view.rerender({
      ...options,
      save: saveA,
      changeVersion: 1,
      buildPayload: () => payloadFor("A1"),
    });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await waitFor(() => expect(saveA).toHaveBeenCalledTimes(1));

    view.rerender({
      ...options,
      save: saveA,
      changeVersion: 2,
      buildPayload: () => payloadFor("A2"),
    });
    view.rerender({
      ...options,
      resetKey: "plan-b",
      changeVersion: 1,
      save: saveB,
      buildPayload: () => payloadFor("B"),
    });

    await act(async () => {
      resolveFirst(planFor("plan-a", 1));
    });

    await waitFor(() => expect(saveA).toHaveBeenCalledTimes(2));
    expect(saveA.mock.calls[1][0]).toMatchObject({ name: "A2" });
    expect(saveA.mock.calls[1][1]).toBe(1);
    expect(saveB).not.toHaveBeenCalled();
  });
});
