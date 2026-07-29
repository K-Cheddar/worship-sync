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
});
