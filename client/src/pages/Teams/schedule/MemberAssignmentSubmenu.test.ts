import {
  shouldShowMemberAssignmentActionGroupDivider,
  sortMemberAssignmentActionItems,
} from "./MemberAssignmentSubmenu";

describe("MemberAssignmentSubmenu utils", () => {
  it("lists available assignment actions before unavailable ones", () => {
    const items = sortMemberAssignmentActionItems([
      { label: "Replace member", issue: "Not eligible for this position" },
      { label: "Add as shadow", issue: "" },
      {
        label: "Add as reverse shadow",
        issue: "Not eligible for this position",
      },
    ]);

    expect(items.map((item) => item.label)).toEqual([
      "Add as shadow",
      "Replace member",
      "Add as reverse shadow",
    ]);
  });

  it("shows a divider between available and unavailable assignment actions", () => {
    const items = sortMemberAssignmentActionItems([
      { label: "Replace member", issue: "Blocked out" },
      { label: "Add as shadow", issue: "" },
      {
        label: "Add as reverse shadow",
        issue: "Not eligible for this position",
      },
    ]);

    expect(shouldShowMemberAssignmentActionGroupDivider(items, 0)).toBe(false);
    expect(shouldShowMemberAssignmentActionGroupDivider(items, 1)).toBe(true);
    expect(shouldShowMemberAssignmentActionGroupDivider(items, 2)).toBe(false);
  });
});
