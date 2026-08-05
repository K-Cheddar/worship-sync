import {
  addServicePlanAssignee,
  applyAssigneeChanges,
  filterAssigneeSuggestions,
} from "./ServicePlanAssigneeList";
import type { ServicePlanAssignee } from "../../types/servicePlan";

describe("filterAssigneeSuggestions", () => {
  const history = [
    "Abigail",
    "Alrae Spence",
    "Bobby Zecher",
    "Chadwick Anderson",
  ];

  const assignees: ServicePlanAssignee[] = [
    { id: "a1", name: "Bobby Zecher" },
    { id: "a2", name: "Alrae Spence" },
    { id: "a3", name: "" },
  ];

  it("drops names already used on other assignee rows", () => {
    expect(filterAssigneeSuggestions(history, assignees, "a3")).toEqual([
      "Abigail",
      "Chadwick Anderson",
    ]);
  });

  it("keeps the current row's own name so renaming still suggests peers only", () => {
    expect(filterAssigneeSuggestions(history, assignees, "a1")).toEqual([
      "Abigail",
      "Bobby Zecher",
      "Chadwick Anderson",
    ]);
  });

  it("matches taken names case-insensitively", () => {
    expect(
      filterAssigneeSuggestions(
        ["bobby zecher", "Abigail"],
        [{ id: "a1", name: "Bobby Zecher" }, { id: "a2" }],
        "a2",
      ),
    ).toEqual(["Abigail"]);
  });

  it("returns the full list when nobody else is named", () => {
    expect(
      filterAssigneeSuggestions(history, [{ id: "a1", name: "" }], "a1"),
    ).toEqual(history);
  });
});

describe("addServicePlanAssignee", () => {
  it("appends an empty assignee slot", () => {
    const next = addServicePlanAssignee([{ id: "a1", name: "Sam" }]);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ id: "a1", name: "Sam" });
    expect(next[1].id).toBeTruthy();
    expect(next[1].name).toBeUndefined();
  });
});

describe("applyAssigneeChanges", () => {
  it("keeps the row when clearing a name with no microphones", () => {
    const next = applyAssigneeChanges([{ id: "a1", name: "Sam" }], "a1", {
      name: "",
    });
    expect(next).toEqual([{ id: "a1", name: "" }]);
  });

  it("keeps a named row when its name is partially cleared mid-edit", () => {
    const next = applyAssigneeChanges([{ id: "a1", name: "Sa" }], "a1", {
      name: "S",
    });
    expect(next).toEqual([{ id: "a1", name: "S" }]);
  });

  it("prunes an unassigned slot when its last microphone is removed", () => {
    const next = applyAssigneeChanges(
      [{ id: "a1", microphoneIds: ["mic-1"] }],
      "a1",
      { microphoneIds: [] },
    );
    expect(next).toEqual([]);
  });

  it("keeps a named person when their last microphone is removed", () => {
    const next = applyAssigneeChanges(
      [{ id: "a1", name: "Sam", microphoneIds: ["mic-1"] }],
      "a1",
      { microphoneIds: [] },
    );
    expect(next).toEqual([{ id: "a1", name: "Sam", microphoneIds: [] }]);
  });
});
