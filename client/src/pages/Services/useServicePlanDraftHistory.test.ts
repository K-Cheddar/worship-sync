import { act, renderHook } from "@testing-library/react";
import { useServicePlanDraftHistory } from "./useServicePlanDraftHistory";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanSection } from "../../types/servicePlan";

const sections = (title: string): ServicePlanSection[] => [{
  id: "s1", name: "Order", elements: [{ id: "e1", type: "free", title: plainTextToRichText(title) }],
}];

describe("service plan draft history after reconciliation", () => {
  it("drops pre-reconciliation undo entries so they cannot restore an obsolete server snapshot", () => {
    let restored = jest.fn();
    const initial = sections("Base");
    const view = renderHook(({ draft }) => useServicePlanDraftHistory({ draft, onRestore: restored }), {
      initialProps: { draft: { sections: initial, planName: "Plan" } },
    });
    act(() => view.result.current.record("title"));
    view.rerender({ draft: { sections: sections("Local edit"), planName: "Plan" } });
    act(() => view.result.current.reset());
    act(() => view.result.current.undo());
    expect(restored).not.toHaveBeenCalled();
    expect(view.result.current.canUndo).toBe(false);
  });
});
