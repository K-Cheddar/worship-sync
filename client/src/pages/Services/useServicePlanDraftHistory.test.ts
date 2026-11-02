import { act, renderHook } from "@testing-library/react";
import { useServicePlanDraftHistory } from "./useServicePlanDraftHistory";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanSection } from "../../types/servicePlan";

const sections = (title: string): ServicePlanSection[] => [{
  id: "s1", name: "Order", elements: [{ id: "e1", type: "free", title: plainTextToRichText(title) }],
}];

describe("service plan draft history after reconciliation", () => {
  it("restores section phase changes through undo and redo", () => {
    const restored = jest.fn();
    const initialSections: ServicePlanSection[] = [{
      id: "s1", phase: "main", name: "Order", elements: [],
    }];
    const editedSections: ServicePlanSection[] = [{
      ...initialSections[0], phase: "pre",
    }];
    const view = renderHook(({ draft }) => useServicePlanDraftHistory({ draft, onRestore: restored }), {
      initialProps: { draft: { sections: initialSections, planName: "Plan" } },
    });

    act(() => view.result.current.record("section:s1:phase"));
    view.rerender({ draft: { sections: editedSections, planName: "Plan" } });
    act(() => view.result.current.undo());
    expect(restored.mock.calls[0][0].sections[0].phase).toBe("main");

    act(() => view.result.current.redo());
    expect(restored.mock.calls[1][0].sections[0].phase).toBe("pre");
  });

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
