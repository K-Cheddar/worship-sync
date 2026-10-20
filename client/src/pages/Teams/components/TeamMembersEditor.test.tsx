import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamMembersEditor, { type TeamMemberSuggestion } from "./TeamMembersEditor";
import type { TeamRosterMember } from "../../../api/authTypes";
import { CurrentMemberIdentityProvider } from "./CurrentUserMemberIndicator";

const member = (memberId: string, firstName: string, lastName: string, extra: Partial<TeamRosterMember> = {}): TeamRosterMember => ({
  memberId,
  churchId: "church-1",
  firstName,
  lastName,
  blockoutDates: [],
  positionIds: [],
  qualifications: [],
  ...extra,
});

const renderEditor = (overrides: Partial<React.ComponentProps<typeof TeamMembersEditor>> = {}) =>
  render(
    <TeamMembersEditor
      memberIds={[]}
      members={[]}
      suggestions={[]}
      searchMode="local"
      searchQuery=""
      onSearchQueryChange={jest.fn()}
      canEditMembership
      onAddMember={jest.fn()}
      onRemoveMember={jest.fn()}
      {...overrides}
    />,
  );

it("sorts assigned members by display name and keeps every assigned ID visible", () => {
  renderEditor({
    memberIds: ["m-3", "m-1", "m-2", "m-missing"],
    members: [
      member("m-1", "Enya-Kaye", "Cheddar"),
      member("m-2", "Kevin", "Cheddar"),
      member("m-3", "Kevoun", "Morgan"),
    ],
  });

  const list = screen.getByRole("list", { name: "Members on this team" });
  expect(within(list).getAllByRole("button", { name: /Remove .* from team/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
    "Remove Enya-Kaye Cheddar from team",
    "Remove Kevin Cheddar from team",
    "Remove Kevoun Morgan from team",
    "Remove Member details unavailable from team",
  ]);
  expect(list).toHaveTextContent("Member details unavailable");
  expect(screen.getByRole("heading", { name: "Members · 4" })).toBeInTheDocument();
});

it("marks the linked assigned member without matching another member who has the same name", () => {
  const linked = member("linked", "Rae", "Kim");
  const sameName = member("same-name", "Rae", "Kim");
  render(
    <CurrentMemberIdentityProvider memberId="linked">
      <TeamMembersEditor
        memberIds={[linked.memberId]}
        members={[linked, sameName]}
        suggestions={[sameName]}
        searchMode="scoped"
        searchQuery="Rae"
        onSearchQueryChange={jest.fn()}
        canEditMembership
        onAddMember={jest.fn()}
        onRemoveMember={jest.fn()}
      />
    </CurrentMemberIdentityProvider>,
  );

  const assigned = screen.getByRole("list", { name: "Members on this team" });
  const suggestions = screen.getByRole("list", { name: "Matching members to add" });
  expect(within(assigned).getByText("You")).toBeInTheDocument();
  expect(within(suggestions).queryByText("You")).not.toBeInTheDocument();
  expect(within(assigned).getByRole("button", { name: "Remove Rae Kim from team, You" })).toBeInTheDocument();
  expect(within(suggestions).getByRole("button", { name: "Add Rae Kim to team" })).toBeInTheDocument();
});

it("shows no directory entries until searching, then offers only active unassigned people inline", async () => {
  const user = userEvent.setup();
  const onSearchQueryChange = jest.fn();
  const availableMembers = [
    member("assigned", "Avery", "Singer"),
    member("archived", "Ada", "Lovelace", { archivedAt: "2026-10-01T00:00:00.000Z" }),
    member("zara", "Zara", "Jones"),
    member("amy", "Amy", "Jones"),
  ];
  const { rerender } = renderEditor({
    memberIds: ["assigned"],
    members: availableMembers,
    onSearchQueryChange,
  });

  expect(screen.queryByText("Amy Jones")).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "jo");
  expect(onSearchQueryChange).toHaveBeenCalled();

  rerender(
    <TeamMembersEditor
      memberIds={["assigned"]}
      members={availableMembers}
      suggestions={[]}
      searchMode="local"
      searchQuery="jo"
      onSearchQueryChange={onSearchQueryChange}
      canEditMembership
      onAddMember={jest.fn()}
      onRemoveMember={jest.fn()}
    />,
  );
  const results = screen.getByRole("list", { name: "Matching members to add" });
  expect(within(results).getAllByRole("button", { name: /Add .* to team/ })).toHaveLength(2);
  expect(results).toHaveTextContent("Amy Jones");
  expect(results).toHaveTextContent("Zara Jones");
  expect(results).not.toHaveTextContent("Avery Singer");
  expect(results).not.toHaveTextContent("Ada Lovelace");
});

it("shows clear empty states for an empty team and a search with no matches", () => {
  renderEditor({ searchQuery: "missing" });

  expect(screen.getByText("No members on this team yet.")).toBeInTheDocument();
  expect(screen.getByText("No matching members found.")).toBeInTheDocument();
});

it("sorts safe scoped candidates and excludes assigned or duplicate IDs", () => {
  const assigned = member("assigned", "Avery", "Singer");
  const amy = member("amy", "Amy", "Jones");
  const zara = member("zara", "Zara", "Jones");
  const suggestions: TeamMemberSuggestion[] = [
    { memberId: "zara", firstName: "Zara", lastName: "Jones" },
    { memberId: "assigned", firstName: "Avery", lastName: "Singer" },
    { memberId: "amy", firstName: "Amy", lastName: "Jones" },
    { memberId: "amy", firstName: "Amy", lastName: "Jones" },
  ];
  renderEditor({
    members: [assigned],
    memberIds: ["assigned"],
    searchMode: "scoped",
    searchQuery: "jo",
    suggestions,
  });

  const results = screen.getByRole("list", { name: "Matching members to add" });
  expect(within(results).getAllByRole("button", { name: /Add .* to team/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
    `Add ${amy.firstName} ${amy.lastName} to team`,
    `Add ${zara.firstName} ${zara.lastName} to team`,
  ]);
});

it("routes inline Add and Remove actions by member ID", async () => {
  const user = userEvent.setup();
  const onAddMember = jest.fn();
  const onRemoveMember = jest.fn();
  renderEditor({
    members: [member("assigned", "Avery", "Singer")],
    memberIds: ["assigned"],
    searchMode: "scoped",
    searchQuery: "amy",
    suggestions: [{ memberId: "amy-id", firstName: "Amy", lastName: "Jones" }],
    onAddMember,
    onRemoveMember,
  });

  await user.click(screen.getByRole("button", { name: "Add Amy Jones to team" }));
  await user.click(screen.getByRole("button", { name: "Remove Avery Singer from team" }));
  expect(onAddMember).toHaveBeenCalledWith("amy-id");
  expect(onRemoveMember).toHaveBeenCalledWith("assigned");
});

it("expands and collapses large teams without creating a nested scroll area", async () => {
  const user = userEvent.setup();
  const members = Array.from({ length: 9 }, (_, index) =>
    member(`m-${index}`, `Member ${String(index + 1).padStart(2, "0")}`, "Singer"),
  );
  renderEditor({
    members,
    memberIds: members.map((entry) => entry.memberId),
    canEditMembership: false,
  });

  const list = screen.getByRole("list", { name: "Members on this team" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  await user.click(screen.getByRole("button", { name: "Show all 9 members" }));
  expect(within(list).getAllByRole("listitem")).toHaveLength(9);
  expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "Show fewer" }));
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
});

it("caps broad search suggestions and asks the editor to refine the query", () => {
  const suggestions = Array.from({ length: 25 }, (_, index) => ({
    memberId: `m-${String(index).padStart(2, "0")}`,
    firstName: `Member ${String(index).padStart(2, "0")}`,
    lastName: "Singer",
  }));
  renderEditor({
    searchMode: "scoped",
    searchQuery: "member",
    suggestions,
  });

  expect(within(screen.getByRole("list", { name: "Matching members to add" })).getAllByRole("button", { name: /Add .* to team/ })).toHaveLength(20);
  expect(screen.getByText("Showing the first 20 matches. Refine your search to narrow the list.")).toBeInTheDocument();
});

it("shows when the scoped server search has more matches beyond its returned page", () => {
  const suggestions = Array.from({ length: 20 }, (_, index) => ({
    memberId: `m-${String(index).padStart(2, "0")}`,
    firstName: `Member ${String(index).padStart(2, "0")}`,
    lastName: "Singer",
  }));
  renderEditor({
    searchMode: "scoped",
    searchQuery: "member",
    suggestions,
    hasMoreSuggestions: true,
  });

  expect(within(screen.getByRole("list", { name: "Matching members to add" })).getAllByRole("button", { name: /Add .* to team/ })).toHaveLength(20);
  expect(screen.getByText("Showing the first 20 matches. Refine your search to narrow the list.")).toBeInTheDocument();
});

it("provides labeled keyboard-operable controls with mobile touch targets", async () => {
  const user = userEvent.setup();
  renderEditor({
    searchMode: "scoped",
    searchQuery: "amy",
    suggestions: [{ memberId: "amy", firstName: "Amy", lastName: "Jones" }],
  });
  const search = screen.getByRole("textbox", { name: /Add members/i });
  const results = screen.getByRole("list", { name: "Matching members to add" });
  expect(search).toHaveAttribute("aria-controls", results.id);
  expect(search).toHaveClass("max-md:min-h-11");

  await user.click(search);
  await user.keyboard("{Tab}");
  const addButton = screen.getByRole("button", { name: "Add Amy Jones to team" });
  expect(addButton).toHaveFocus();
  expect(addButton).toHaveClass("max-md:min-h-11");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
