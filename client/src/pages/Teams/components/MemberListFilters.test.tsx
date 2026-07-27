import { useState, type ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemberFilterPanel,
  MemberListFilterToolbar,
} from "./MemberListFilters";
import {
  countActiveMemberListFilters,
  emptyMemberListFilters,
  type MemberListFilterState,
} from "../teamsSelectors";

describe("MemberListFilterToolbar", () => {
  it("shows a clear control only when filters are active", async () => {
    const user = userEvent.setup();
    const onClearFilters = jest.fn();
    const filters = {
      ...emptyMemberListFilters(),
      includeArchived: true,
    };

    const { rerender } = render(
      <MemberListFilterToolbar
        listQuery=""
        onListQueryChange={() => undefined}
        filters={emptyMemberListFilters()}
        filtersOpen={false}
        onFiltersOpenChange={() => undefined}
        onClearFilters={onClearFilters}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();

    rerender(
      <MemberListFilterToolbar
        listQuery=""
        onListQueryChange={() => undefined}
        filters={filters}
        filtersOpen={false}
        onFiltersOpenChange={() => undefined}
        onClearFilters={onClearFilters}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Filter members, 1 selected" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});

describe("MemberFilterPanel", () => {
  const StatefulMemberFilterPanel = ({
    data,
    initialValue = emptyMemberListFilters(),
  }: {
    data: ComponentProps<typeof MemberFilterPanel>["data"];
    initialValue?: MemberListFilterState;
  }) => {
    const [value, setValue] = useState(initialValue);
    return (
      <MemberFilterPanel data={data} value={value} onChange={setValue} />
    );
  };

  it("offers a show-archived control that counts as an active filter", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <MemberFilterPanel
        data={{
          teams: [],
          positions: [],
          teamRoles: [],
          qualificationAreas: [],
          qualificationLevels: [],
        }}
        value={emptyMemberListFilters()}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Show archived members" })).not.toBeChecked();
    expect(countActiveMemberListFilters(emptyMemberListFilters())).toBe(0);

    await user.click(screen.getByRole("checkbox", { name: "Show archived members" }));
    expect(onChange).toHaveBeenCalledWith({
      ...emptyMemberListFilters(),
      includeArchived: true,
    });
    expect(
      countActiveMemberListFilters({
        ...emptyMemberListFilters(),
        includeArchived: true,
      }),
    ).toBe(1);
  });

  it("groups scheduling positions and team roles by team without parenthetical labels", async () => {
    const user = userEvent.setup();

    render(
      <MemberFilterPanel
        data={{
          teams: [
            {
              teamId: "team-1",
              churchId: "church-1",
              name: "Production",
              memberIds: [],
            },
          ],
          positions: [
            {
              positionId: "position-camera",
              churchId: "church-1",
              teamId: "team-1",
              name: "Camera",
            },
          ],
          teamRoles: [
            {
              roleId: "role-lead",
              churchId: "church-1",
              teamId: "team-1",
              name: "Team lead",
            },
          ],
          qualificationAreas: [],
          qualificationLevels: [],
        }}
        value={emptyMemberListFilters()}
        onChange={() => undefined}
      />,
    );

    const positionsGroup = screen.getByRole("group", {
      name: "Scheduling positions",
    });

    expect(within(positionsGroup).getByText("Production")).toBeInTheDocument();
    expect(within(positionsGroup).getByText("Camera")).toBeInTheDocument();
    expect(within(positionsGroup).queryByText("Camera (Production)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Team roles" }));
    const teamRolesGroup = await screen.findByRole("group", { name: "Team roles" });

    expect(within(teamRolesGroup).getByText("Production")).toBeInTheDocument();
    expect(within(teamRolesGroup).getByText("Team lead")).toBeInTheDocument();
    expect(within(teamRolesGroup).queryByText("Camera")).not.toBeInTheDocument();
  });

  it("keeps only teams and scheduling positions expanded by default", async () => {
    const user = userEvent.setup();

    render(
      <MemberFilterPanel
        data={{
          teams: [
            {
              teamId: "team-1",
              churchId: "church-1",
              name: "Production",
              memberIds: [],
            },
          ],
          positions: [
            {
              positionId: "position-camera",
              churchId: "church-1",
              teamId: "team-1",
              name: "Camera",
            },
          ],
          teamRoles: [
            {
              roleId: "role-lead",
              churchId: "church-1",
              teamId: "team-1",
              name: "Team lead",
            },
          ],
          qualificationAreas: [
            {
              areaId: "area-1",
              churchId: "church-1",
              teamId: "team-1",
              name: "Safety",
            },
          ],
          qualificationLevels: [],
        }}
        value={emptyMemberListFilters()}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("group", { name: "Teams" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Scheduling positions" })).toBeVisible();
    expect(screen.getByText("Camera")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Team lead" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qualifications" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Safety" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Team roles" }));
    expect(screen.getByRole("checkbox", { name: "Team lead" })).toBeInTheDocument();
  });

  it("nests qualification levels and status under areas inside Qualifications", async () => {
    const user = userEvent.setup();

    render(
      <StatefulMemberFilterPanel
        data={{
          teams: [
            {
              teamId: "team-1",
              churchId: "church-1",
              name: "Production",
              memberIds: [],
            },
          ],
          positions: [],
          teamRoles: [],
          qualificationAreas: [
            {
              areaId: "area-1",
              churchId: "church-1",
              teamId: "team-1",
              name: "Safety",
            },
          ],
          qualificationLevels: [
            {
              levelId: "level-1",
              churchId: "church-1",
              areaId: "area-1",
              name: "Level 1",
              rank: 1,
            },
          ],
        }}
      />,
    );

    expect(screen.queryByRole("checkbox", { name: "Level 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Completed" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Qualifications" }));
    const qualificationsGroup = await screen.findByRole("group", {
      name: "Qualifications",
    });

    await user.click(within(qualificationsGroup).getByRole("checkbox", { name: "Safety" }));
    expect(screen.getByRole("checkbox", { name: "Level 1" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Completed" })).toBeInTheDocument();
  });
});
