import { mergeServicePlan } from "./servicePlanMerge";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServicePlanElement } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";

const plan = (sections: ServicePlan["sections"]): ServicePlan => ({
  planId: "p", churchId: "c", planKey: "k", serviceId: "s", date: "2026-09-27", name: "Plan", sections,
});
const element = (id: string, title: string, notes = "") => ({
  id, type: "free" as const, title: plainTextToRichText(title),
  ...(notes ? { notes: plainTextToRichText(notes) } : {}),
});
const section = (elements: ServicePlanElement[]) => ({ id: "s1", name: "Order", elements });

describe("mergeServicePlan", () => {
  it("merges independent fields on one item", () => {
    const base = plan([section([element("e1", "Welcome")])]);
    const local = plan([section([element("e1", "Opening", "")])]);
    const remote = plan([section([element("e1", "Welcome", "Mic check")])]);
    const result = mergeServicePlan(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.plan.sections[0].elements[0]).toMatchObject({ title: plainTextToRichText("Opening"), notes: plainTextToRichText("Mic check") });
  });

  it("reports divergent edits to the same field and delete versus modify", () => {
    const base = plan([section([element("e1", "Welcome")])]);
    const sameField = mergeServicePlan(base, plan([section([element("e1", "Open")])]), plan([section([element("e1", "Start")])]));
    expect(sameField.conflicts.map(({ kind }) => kind)).toContain("field");
    const deleteModify = mergeServicePlan(base, plan([section([])]), plan([section([element("e1", "Changed")])]));
    expect(deleteModify.conflicts.map(({ kind }) => kind)).toContain("delete-modify");
    const deleteVersusMove = mergeServicePlan(
      plan([section([element("e1", "Welcome"), element("e2", "Song"), element("e3", "Talk")])]),
      plan([section([element("e1", "Welcome"), element("e3", "Talk")])]),
      plan([section([element("e2", "Song"), element("e1", "Welcome"), element("e3", "Talk")])]),
    );
    expect(deleteVersusMove.conflicts.map(({ kind }) => kind)).toContain("delete-modify");
  });

  it("combines a local section deletion with an independent remote plan-name change", () => {
    const base = plan([section([element("e1", "Welcome")]), { id: "s2", name: "Response", elements: [] }]);
    const local = { ...base, sections: [base.sections[1]] };
    const remote = { ...base, name: "Remote version" };
    const result = mergeServicePlan(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.plan).toMatchObject({ name: "Remote version", sections: [base.sections[1]] });
  });

  it("preserves independent additions and combines compatible order constraints", () => {
    const base = plan([section([element("a", "A"), element("b", "B"), element("c", "C"), element("d", "D")])]);
    const local = plan([section([element("b", "B"), element("a", "A"), element("c", "C"), element("d", "D"), element("z", "Z")])]);
    const remote = plan([section([element("a", "A"), element("b", "B"), element("d", "D"), element("c", "C"), element("a-addition", "A addition")])]);
    const result = mergeServicePlan(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.plan.sections[0].elements.map(({ id }) => id)).toEqual(["b", "a", "d", "c", "a-addition", "z"]);
  });

  it("requires a decision for incompatible reorderings and merges nested ID records", () => {
    const base = plan([section([
      { ...element("e1", "Welcome"), teamNotes: [{ id: "n1", label: "Band", note: plainTextToRichText("old") }] },
      element("e2", "Song"), element("e3", "Talk"),
    ])]);
    const local = plan([section([
      { ...element("e1", "Welcome"), teamNotes: [{ id: "n1", label: "Band", note: plainTextToRichText("new") }] },
      element("e3", "Talk"), element("e2", "Song"),
    ])]);
    const remote = plan([section([element("e2", "Song"), element("e1", "Welcome"), element("e3", "Talk")])]);
    const result = mergeServicePlan(base, local, remote);
    expect(result.conflicts.some(({ kind }) => kind === "order")).toBe(true);
    expect(result.plan.sections[0].elements.find(({ id }) => id === "e1")?.teamNotes?.[0].note).toEqual(plainTextToRichText("new"));
  });
});
