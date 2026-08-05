import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhosServingPanel from "./WhosServingPanel";
import type { TeamsAssignmentSummaryTeamGroup } from "./teamsAssignmentsSummary";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";

const longName = "The Member With A Very Long Display Name";

const assignmentTeams: TeamsAssignmentSummaryTeamGroup[] = [
  {
    teamId: "team-media",
    teamName: "Media",
    scheduleId: "schedule-media",
    occurrenceId: "occ-1",
    filled: [
      {
        teamId: "team-media",
        teamName: "Media",
        scheduleId: "schedule-media",
        occurrenceId: "occ-1",
        positionId: "pos-camera",
        positionName: "Camera - Roving 2",
        columnKey: "pos-camera::0",
        slotLabel: "Camera - Roving 2",
        memberName: longName,
        microphoneIds: ["mic-lead"],
      },
    ],
    unfilled: [],
  },
];

const microphones: ServicePlanMicrophone[] = [
  { id: "mic-lead", name: "Lead", type: "Handheld", color: "#9ca3af" },
];

describe("WhosServingPanel", () => {
  it("opens a popover with the full member name, role, and microphones", async () => {
    const user = userEvent.setup();
    const onOpenSchedule = jest.fn();

    render(
      <WhosServingPanel
        assignmentTeams={assignmentTeams}
        onOpenSchedule={onOpenSchedule}
        microphones={microphones}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: `Details for ${longName}` }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Camera - Roving 2")).toBeInTheDocument();
    expect(within(dialog).getByText(longName)).toBeInTheDocument();
    expect(within(dialog).getByText("Lead")).toBeInTheDocument();
  });
});
