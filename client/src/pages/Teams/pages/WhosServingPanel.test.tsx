import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhosServingPanel, {
  getServingMasonryColumnCount,
} from "./WhosServingPanel";
import type { TeamsAssignmentSummaryTeamGroup } from "./teamsAssignmentsSummary";
import type { ServiceEquipment, ServicePlanMicrophone } from "../../../types/servicePlan";

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
        canNotify: true,
        microphoneIds: ["mic-lead"],
      },
    ],
    unfilled: [],
  },
];

const microphones: ServicePlanMicrophone[] = [
  { id: "mic-lead", name: "Lead", type: "Handheld", color: "#9ca3af" },
];
const iemEquipment: ServiceEquipment[] = [
  { id: "iem-red", category: "iem", name: "Red", subtype: "wireless-beltpack", color: "#ef4444" },
];

describe("WhosServingPanel", () => {
  it("uses every fitting masonry column without creating empty columns", () => {
    expect(getServingMasonryColumnCount(1_500, 4)).toBe(4);
    expect(getServingMasonryColumnCount(1_500, 3)).toBe(3);
    expect(getServingMasonryColumnCount(700, 4)).toBe(1);
  });

  it("keeps a small number of team columns compact in a wide panel", () => {
    const clientWidthSpy = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(1_800);
    try {
      render(
        <WhosServingPanel
          assignmentTeams={[
            assignmentTeams[0],
            {
              ...assignmentTeams[0],
              teamId: "team-worship",
              teamName: "Worship",
              scheduleId: "schedule-worship",
            },
          ]}
          onOpenSchedule={jest.fn()}
        />,
      );

      const columns = screen.getAllByTestId("serving-team-column");
      expect(columns).toHaveLength(2);
      columns.forEach((column) => {
        expect(column).toHaveClass("w-full", "max-w-[28rem]");
        expect(column).not.toHaveClass("flex-1");
      });
    } finally {
      clientWidthSpy.mockRestore();
    }
  });

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

  it("shows schedule access without edit actions for a view-only team", () => {
    const schedule = {
      ...assignmentTeams[0],
      unfilled: [{ ...assignmentTeams[0].filled[0], memberName: null }],
    };
    render(
      <WhosServingPanel
        assignmentTeams={[schedule]}
        onOpenSchedule={jest.fn()}
        canEditTeam={() => false}
      />,
    );

    expect(screen.getByRole("button", { name: "View Media schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Media schedule" })).not.toBeInTheDocument();
    expect(screen.getByText("1 unfilled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fill .* for Media/ })).not.toBeInTheDocument();
  });

  it("puts microphone chips on a second line under the role and name", () => {
    render(
      <WhosServingPanel
        assignmentTeams={assignmentTeams}
        onOpenSchedule={jest.fn()}
        microphones={microphones}
      />,
    );

    const micGroup = screen.getByRole("group", {
      name: `Equipment for ${longName}`,
    });
    expect(within(micGroup).getByText("Lead")).toBeInTheDocument();
    expect(micGroup).toHaveClass("border-t");
    expect(screen.getByText("Camera - Roving 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Details for ${longName}` }),
    ).toBeInTheDocument();
  });

  it("shows microphone-only, IEM-only, and combined allocations", () => {
    const servingTeam = {
      ...assignmentTeams[0],
      filled: [
        { ...assignmentTeams[0].filled[0], columnKey: "pos-camera::0", memberName: "Mic Only", microphoneIds: ["mic-lead"], iemIds: [] },
        { ...assignmentTeams[0].filled[0], columnKey: "pos-camera::1", memberName: "IEM Only", microphoneIds: [], iemIds: ["iem-red"], memberProfileImageUrl: "https://example.com/iem.jpg" },
        { ...assignmentTeams[0].filled[0], columnKey: "pos-camera::2", memberName: "Both", microphoneIds: ["mic-lead"], iemIds: ["iem-red"] },
      ],
    };
    render(
      <WhosServingPanel
        assignmentTeams={[servingTeam]}
        onOpenSchedule={jest.fn()}
        microphones={microphones}
        iemEquipment={iemEquipment}
      />,
    );

    expect(screen.getAllByLabelText("Lead · Handheld")).toHaveLength(2);
    expect(screen.getAllByLabelText("Red · Wireless beltpack")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Equipment for IEM Only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View profile image of IEM Only" })).toBeInTheDocument();
  });

  it("opens a profile image in a viewport-constrained modal", async () => {
    const user = userEvent.setup();
    const imageUrl = "https://example.com/profile.jpg";
    const teamsWithImage: TeamsAssignmentSummaryTeamGroup[] = [
      {
        ...assignmentTeams[0],
        filled: [
          {
            ...assignmentTeams[0].filled[0],
            memberProfileImageUrl: imageUrl,
          },
        ],
      },
    ];

    render(
      <WhosServingPanel
        assignmentTeams={teamsWithImage}
        onOpenSchedule={jest.fn()}
        microphones={microphones}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: `View profile image of ${longName}` }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: `${longName} profile image`,
    });
    expect(
      within(dialog).getByRole("img", { name: `${longName} profile` }),
    ).toHaveClass("max-h-[calc(100vh-8rem)]", "max-w-[calc(100vw-2rem)]");

    await user.click(
      within(dialog).getByRole("button", { name: "Close modal" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
