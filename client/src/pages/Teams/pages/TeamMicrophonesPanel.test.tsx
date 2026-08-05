import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamMicrophonesPanel from "./TeamMicrophonesPanel";
import type { TeamsAssignmentSummaryRow } from "./teamsAssignmentsSummary";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";

const microphones: ServicePlanMicrophone[] = [
  { id: "mic-lead", name: "Lead", type: "Handheld", color: "#9ca3af" },
  { id: "mic-orange", name: "Orange", type: "Handheld", color: "#f97316" },
  { id: "mic-spare", name: "Countryman", type: "Headset", color: "#22d3ee" },
];

const baseRow = (
  overrides: Partial<TeamsAssignmentSummaryRow>,
): TeamsAssignmentSummaryRow => ({
  teamId: "team-1",
  teamName: "Praise Team",
  scheduleId: "schedule-1",
  occurrenceId: "occ-1",
  positionId: "pos-lead",
  positionName: "Lead",
  columnKey: "pos-lead::0",
  slotLabel: "Lead",
  memberName: "Johnny Mclain",
  microphoneIds: [],
  ...overrides,
});

describe("TeamMicrophonesPanel", () => {
  it("marks microphones already assigned to another role in the dropdown", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <TeamMicrophonesPanel
        canEdit
        microphones={microphones}
        onChange={onChange}
        rows={[
          baseRow({
            microphoneIds: ["mic-lead"],
          }),
          baseRow({
            positionId: "pos-tenor",
            positionName: "Tenor",
            columnKey: "pos-tenor::0",
            slotLabel: "Tenor",
            memberName: "Member Three",
            microphoneIds: ["mic-orange"],
          }),
          baseRow({
            positionId: "pos-soprano",
            positionName: "Soprano",
            columnKey: "pos-soprano::0",
            slotLabel: "Soprano",
            memberName: "Member Four",
            microphoneIds: [],
          }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: /Microphone for Member Four \(Soprano\)/i }),
    );

    const lead = await screen.findByRole("option", { name: /Lead/i });
    expect(within(lead).getByText("Assigned: Johnny Mclain")).toBeInTheDocument();

    const orange = screen.getByRole("option", { name: /Orange/i });
    expect(within(orange).getByText("Assigned: Member Three")).toBeInTheDocument();

    const spare = screen.getByRole("option", { name: /Countryman/i });
    expect(within(spare).queryByText(/Assigned:/i)).not.toBeInTheDocument();
  });

  it("does not label the option as assigned for the role that already holds it", async () => {
    const user = userEvent.setup();

    render(
      <TeamMicrophonesPanel
        canEdit
        microphones={microphones}
        onChange={jest.fn()}
        rows={[
          baseRow({
            microphoneIds: ["mic-lead"],
          }),
          baseRow({
            positionId: "pos-soprano",
            positionName: "Soprano",
            columnKey: "pos-soprano::0",
            slotLabel: "Soprano",
            memberName: "Member Four",
            microphoneIds: [],
          }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: /Microphone for Johnny Mclain \(Lead\)/i }),
    );

    const lead = await screen.findByRole("option", { name: /^Lead$/i });
    expect(within(lead).queryByText(/Assigned:/i)).not.toBeInTheDocument();
  });

  it("shows church-list guidance when there are no rows and no microphones", () => {
    render(
      <TeamMicrophonesPanel
        canEdit
        microphones={[]}
        onChange={jest.fn()}
        rows={[]}
      />,
    );

    expect(
      screen.getByText(/No microphones in the church list yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No scheduled roles for teams that use microphones yet/i),
    ).toBeInTheDocument();
  });

  // A date whose schedule the bootstrap only summarized has no rows to show,
  // and "assign people on the schedule" would be aimed at an operator who has
  // already done exactly that.
  it("says the roles have not loaded rather than telling the operator to assign them", () => {
    render(
      <TeamMicrophonesPanel
        canEdit
        microphones={microphones}
        onChange={jest.fn()}
        rows={[]}
        assignmentsStatus="unavailable"
      />,
    );

    expect(
      screen.getByText(/scheduled roles haven't loaded/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No scheduled roles for teams that use microphones yet/i),
    ).not.toBeInTheDocument();
  });

  it("says the roles are loading while they are being fetched", () => {
    render(
      <TeamMicrophonesPanel
        canEdit
        microphones={microphones}
        onChange={jest.fn()}
        rows={[]}
        assignmentsStatus="loading"
      />,
    );

    expect(
      screen.getByText(/Loading this date's scheduled roles/i),
    ).toBeInTheDocument();
  });
});
