import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TeamEquipmentPanel from "./TeamEquipmentPanel";
import type { TeamsAssignmentSummaryRow } from "./teamsAssignmentsSummary";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";
import type { ServiceEquipment } from "../../../types/servicePlan";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

const renderPanel = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const microphones: ServicePlanMicrophone[] = [
  { id: "mic-lead", name: "Lead", type: "Handheld", color: "#9ca3af" },
  { id: "mic-orange", name: "Orange", type: "Handheld", color: "#f97316" },
  { id: "mic-spare", name: "Countryman", type: "Headset", color: "#22d3ee" },
];
const iems: ServiceEquipment[] = [
  { id: "iem-black", category: "iem", name: "Black", subtype: "wireless-beltpack", color: "#111827" },
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
  canNotify: overrides.canNotify ?? true,
});

describe("TeamEquipmentPanel", () => {
  it("marks microphones already assigned to another role in the dropdown", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderPanel(
      <TeamEquipmentPanel
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

    renderPanel(
      <TeamEquipmentPanel
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

  it("reports an empty microphone list when No microphone is chosen", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    renderPanel(
      <TeamEquipmentPanel
        canEdit
        microphones={microphones}
        onChange={onChange}
        rows={[
          baseRow({
            microphoneIds: ["mic-lead"],
          }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole("combobox", {
        name: /Microphone for Johnny Mclain \(Lead\)/i,
      }),
    );
    await user.click(await screen.findByRole("option", { name: /^No microphone$/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ columnKey: "pos-lead::0" }),
      [],
    );
  });

  it("links to the church Microphones page when the catalog is empty", () => {
    renderPanel(
      <TeamEquipmentPanel
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
      screen.getByRole("link", { name: /^Open Microphones$/i }),
    ).toHaveAttribute("href", TEAMS_SECTION_PATHS.microphones);
    expect(
      screen.getByText(/No scheduled roles for teams that use equipment yet/i),
    ).toBeInTheDocument();
  });

  // A date whose schedule the bootstrap only summarized has no rows to show,
  // and "assign people on the schedule" would be aimed at an operator who has
  // already done exactly that.
  it("says the roles have not loaded rather than telling the operator to assign them", () => {
    renderPanel(
      <TeamEquipmentPanel
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
      screen.queryByText(/No scheduled roles for teams that use equipment yet/i),
    ).not.toBeInTheDocument();
  });

  it("says the roles are loading while they are being fetched", () => {
    renderPanel(
      <TeamEquipmentPanel
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

  it("renders only the IEM control for an IEM-only team and saves clears", async () => {
    const user = userEvent.setup();
    const onIemChange = jest.fn();
    const row = baseRow({ iemIds: ["iem-black"] });

    renderPanel(
      <TeamEquipmentPanel
        canEdit
        teams={[{ teamId: "team-1", churchId: "church-1", name: "Monitor", memberIds: [], usesIemAssignments: true }]}
        microphones={microphones}
        iems={iems}
        rows={[row]}
        onMicrophoneChange={jest.fn()}
        onIemChange={onIemChange}
      />,
    );

    expect(screen.queryByRole("combobox", { name: /Microphone for Johnny Mclain \(Lead\)$/i })).not.toBeInTheDocument();
    const iemSelect = screen.getByRole("combobox", { name: /Microphone for Johnny Mclain \(Lead\) IEM/i });
    await user.click(iemSelect);
    await user.click(screen.getByRole("option", { name: /^No IEM$/i }));
    expect(onIemChange).toHaveBeenCalledWith(row, []);
  });

  it("renders both selectors and excludes the current role from conflicts", async () => {
    const user = userEvent.setup();
    const onIemChange = jest.fn();
    const onMicrophoneChange = jest.fn();
    const first = baseRow({ microphoneIds: ["mic-lead"], iemIds: ["iem-black"] });
    const second = baseRow({
      positionId: "pos-tenor",
      columnKey: "pos-tenor::0",
      slotLabel: "Tenor",
      memberName: "Morgan Lee",
      microphoneIds: [],
      iemIds: [],
    });

    renderPanel(
      <TeamEquipmentPanel
        canEdit
        teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [], usesMicrophoneAssignments: true, usesIemAssignments: true }]}
        microphones={microphones}
        iems={iems}
        rows={[first, second]}
        onMicrophoneChange={onMicrophoneChange}
        onIemChange={onIemChange}
      />,
    );

    expect(screen.getAllByRole("combobox", { name: /Microphone for/i })).toHaveLength(4);
    await user.click(screen.getByRole("combobox", { name: /Microphone for Morgan Lee \(Tenor\)$/i }));
    expect(await screen.findByText(/Assigned: Johnny Mclain/i)).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Lead/i }));
    expect(onMicrophoneChange).toHaveBeenCalledWith(second, ["mic-lead"]);

    await user.click(screen.getByRole("combobox", { name: /Microphone for Johnny Mclain \(Lead\) IEM/i }));
    const black = await screen.findByRole("option", { name: /Black/i });
    expect(within(black).queryByText(/Assigned elsewhere/i)).not.toBeInTheDocument();
  });
});
