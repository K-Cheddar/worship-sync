import { act, renderHook, waitFor } from "@testing-library/react";
import { useServicePlanAutosave } from "./useServicePlanAutosave";
import type { ServicePlan, ServicePlanPayload } from "../../types/servicePlan";

const payloadFor = (name: string): ServicePlanPayload =>
  ({ serviceId: "svc1", date: "2026-07-26", name, sections: [] }) as ServicePlanPayload;

const planFor = (planKey: string, revision: number): ServicePlan =>
  ({ planKey, revision, sections: [] }) as unknown as ServicePlan;

type Options = Parameters<typeof useServicePlanAutosave>[0];

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
});
