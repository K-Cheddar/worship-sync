import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanRolePicker from "./ServicePlanRolePicker";

const roles = [
  {
    positionId: "camera",
    label: "Media Team · Camera",
    teamId: "media",
    teamName: "Media Team",
  },
  {
    positionId: "lyrics",
    label: "Media Team · Lyrics",
    teamId: "media",
    teamName: "Media Team",
  },
  {
    positionId: "vocal",
    label: "Worship Team · Vocal",
    teamId: "worship",
    teamName: "Worship Team",
  },
];

describe("ServicePlanRolePicker", () => {
  beforeEach(() => localStorage.clear());

  it("shows supplied roles immediately, then narrows by a persisted team badge", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(
      <ServicePlanRolePicker
        value=""
        onValueChange={onValueChange}
        options={roles}
        teamFilterStorageKey="role-picker-team"
        ariaLabel="Filter role notes"
        label="Role notes"
      />,
    );

    expect(screen.getByRole("button", { name: "Filter role notes" })).toHaveTextContent(
      /Role notes:.*All roles/,
    );
    await user.click(screen.getByRole("button", { name: "Filter role notes" }));

    expect(screen.getByRole("button", { name: "Media Team · Camera" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worship Team · Vocal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Media Team" }));

    expect(screen.getByRole("button", { name: "Media Team" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "All teams" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Media Team · Camera" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Worship Team · Vocal" })).not.toBeInTheDocument();
    expect(localStorage.getItem("role-picker-team")).toBe("media");

    await user.click(screen.getByRole("button", { name: "Media Team · Camera" }));

    expect(onValueChange).toHaveBeenCalledWith("camera");
  });

  it("uses a parent team scope without overwriting the saved picker team", async () => {
    const user = userEvent.setup();
    localStorage.setItem("role-picker-team", "media");

    render(
      <ServicePlanRolePicker
        value=""
        onValueChange={jest.fn()}
        options={[roles[2]]}
        teamFilterStorageKey="role-picker-team"
        lockedTeamName="Worship Team"
        ariaLabel="Filter role notes"
        label="Role notes"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Filter role notes" }));

    expect(screen.queryByText("Filter by team")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worship Team · Vocal" })).toBeInTheDocument();
    expect(localStorage.getItem("role-picker-team")).toBe("media");
  });
});
