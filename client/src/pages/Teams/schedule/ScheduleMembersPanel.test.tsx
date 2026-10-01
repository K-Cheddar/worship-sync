import { render, screen } from "@testing-library/react";
import ScheduleMembersPanel from "./ScheduleMembersPanel";
import type { TeamRosterMember } from "../../../api/authTypes";

const member: TeamRosterMember = {
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  positionIds: [],
  blockoutDates: [],
  profileImageUrl: "https://example.com/rae.jpg",
};

describe("ScheduleMembersPanel", () => {
  it("renders a member photo in browse mode", () => {
    render(
      <ScheduleMembersPanel
        open
        expandedMemberIds={[]}
        onExpandedMemberIdsChange={jest.fn()}
        membersSort={{ field: "name", direction: "asc" }}
        onMembersSortChange={jest.fn()}
        onOpenChange={jest.fn()}
        mode="browse"
        activeTeamMembers={[member]}
        schedulePositions={[]}
        scheduleAssignmentCounts={new Map()}
        memberServingHistory={new Map()}
        duplicateFirstNames={new Set()}
        highlightedMemberIdSet={new Set()}
        onToggleHighlight={jest.fn()}
        memberPositionFilterIds={[]}
        onMemberPositionFilterChange={jest.fn()}
        membersPanelQuery=""
        onMembersPanelQueryChange={jest.fn()}
        assignmentQuery=""
        onAssignmentQueryChange={jest.fn()}
        onClearSlot={jest.fn()}
        onSelectMember={jest.fn()}
        getIssue={() => ""}
      />,
    );

    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "https://example.com/rae.jpg",
    );
    expect(screen.getByRole("group", { name: /Rae/ })).toBeInTheDocument();
  });

  it("keeps the avatar inside the assign action in assignment mode", () => {
    render(
      <ScheduleMembersPanel
        open
        expandedMemberIds={[]}
        onExpandedMemberIdsChange={jest.fn()}
        membersSort={{ field: "name", direction: "asc" }}
        onMembersSortChange={jest.fn()}
        onOpenChange={jest.fn()}
        mode="assign"
        activeTeamMembers={[{ ...member, positionIds: ["position-1"] }]}
        schedulePositions={[]}
        scheduleAssignmentCounts={new Map()}
        memberServingHistory={new Map()}
        duplicateFirstNames={new Set()}
        highlightedMemberIdSet={new Set()}
        onToggleHighlight={jest.fn()}
        memberPositionFilterIds={[]}
        onMemberPositionFilterChange={jest.fn()}
        membersPanelQuery=""
        onMembersPanelQueryChange={jest.fn()}
        assignmentQuery=""
        onAssignmentQueryChange={jest.fn()}
        slotContext={{
          positionLabel: "Camera",
          occurrenceLabel: "Sunday",
          currentAssigneeLabel: "Empty",
          positionId: "position-1",
          currentPrimaryMemberId: "",
        }}
        onClearSlot={jest.fn()}
        onSelectMember={jest.fn()}
        getIssue={() => ""}
      />,
    );

    const assignButton = screen.getByRole("button", { name: "Assign Rae" });
    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "https://example.com/rae.jpg",
    );
    expect(assignButton).toContainElement(screen.getByAltText(""));
  });
});
