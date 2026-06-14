import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Teams from "./Teams";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastProvider } from "../../context/toastContext";
import { createMockGlobalContext } from "../../test/mocks";
import {
  createTeamPosition,
  createTeamRosterMember,
  createTeamSchedule,
  deleteTeamPosition,
  getTeamsBootstrap,
  updateTeam,
  updateTeamScheduleAssignment,
} from "../../api/auth";
import type { TeamSchedulePayload } from "../../api/auth";
import type {
  TeamRecord,
  TeamSchedule,
  TeamService,
  TeamsBootstrap,
} from "../../api/authTypes";
import ScheduleEditForm from "./schedule/ScheduleEditForm";

let mockState: unknown;
const mockDispatch = jest.fn();

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => (
  <div>User</div>
));

jest.mock("../../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button">Menu</button>
));

jest.mock("./pages/TeamsFormsPage", () => ({
  __esModule: true,
  default: () => {
    throw new Error("Forms section crashed.");
  },
}));

jest.mock("../../api/auth", () => ({
  getTeamsBootstrap: jest.fn(),
  createTeamPosition: jest.fn(),
  updateTeamScheduleAssignment: jest.fn(),
  archiveTeamPosition: jest.fn(),
  deleteTeamPosition: jest.fn(),
  createTeamRosterMember: jest.fn(),
  updateTeamRosterMember: jest.fn(),
  archiveTeamRosterMember: jest.fn(),
  deleteTeamRosterMember: jest.fn(),
  createTeam: jest.fn(),
  updateTeam: jest.fn(),
  archiveTeam: jest.fn(),
  deleteTeam: jest.fn(),
  createTeamSchedule: jest.fn(),
  updateTeamSchedule: jest.fn(),
  archiveTeamSchedule: jest.fn(),
  deleteTeamSchedule: jest.fn(),
}));

const mockGetTeamsBootstrap = jest.mocked(getTeamsBootstrap);
const mockCreateTeamPosition = jest.mocked(createTeamPosition);
const mockDeleteTeamPosition = jest.mocked(deleteTeamPosition);
const mockUpdateTeamScheduleAssignment = jest.mocked(
  updateTeamScheduleAssignment,
);
const mockCreateTeamRosterMember = jest.mocked(createTeamRosterMember);
const mockCreateTeamSchedule = jest.mocked(createTeamSchedule);
const mockUpdateTeam = jest.mocked(updateTeam);
const sundayOccurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";

type TeamsBootstrapResponse = Awaited<ReturnType<typeof getTeamsBootstrap>>;
type TestTeamsBootstrap = TeamsBootstrap & { services?: TeamService[] };
type CreateTeamPositionResponse = Awaited<ReturnType<typeof createTeamPosition>>;
type CreateTeamRosterMemberResponse = Awaited<
  ReturnType<typeof createTeamRosterMember>
>;
type CreateTeamScheduleResponse = Awaited<ReturnType<typeof createTeamSchedule>>;
type DeleteTeamPositionResponse = Awaited<ReturnType<typeof deleteTeamPosition>>;
type UpdateTeamResponse = Awaited<ReturnType<typeof updateTeam>>;
type UpdateTeamScheduleAssignmentResponse = Awaited<
  ReturnType<typeof updateTeamScheduleAssignment>
>;

const asTeamsBootstrapResponse = (
  value: TestTeamsBootstrap,
): TeamsBootstrapResponse => value;

const baseBootstrap: TestTeamsBootstrap = {
  success: true,
  members: [],
  positions: [],
  teams: [
    {
      teamId: "team-main",
      churchId: "church-1",
      name: "Main Team",
      memberIds: [],
    },
  ],
  services: [],
  schedules: [],
};

const scheduleBootstrap: TestTeamsBootstrap = {
  success: true,
  positions: [
    {
      positionId: "position-vocal",
      churchId: "church-1",
      teamId: "team-main",
      name: "Vocal",
      icon: "mic",
    },
    {
      positionId: "position-keys",
      churchId: "church-1",
      teamId: "team-main",
      name: "Keys",
      icon: "keys",
    },
  ],
  members: [
    {
      memberId: "member-avery",
      churchId: "church-1",
      firstName: "Avery",
      lastName: "Stone",
      positionIds: ["position-vocal", "position-keys"],
      blockoutDates: [],
      notes: "",
    },
    {
      memberId: "member-morgan",
      churchId: "church-1",
      firstName: "Morgan",
      lastName: "Lee",
      positionIds: ["position-vocal"],
      blockoutDates: [
        { startDate: "2026-07-05", endDate: "2026-07-05", notes: "" },
      ],
      notes: "",
    },
  ],
  teams: [
    {
      teamId: "team-main",
      churchId: "church-1",
      name: "Main Team",
      memberIds: ["member-avery", "member-morgan"],
    },
  ],
  services: [],
  schedules: [
    {
      scheduleId: "schedule-july",
      churchId: "church-1",
      name: "July",
      teamId: "team-main",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      serviceIds: ["service-sunday"],
      occurrences: [
        {
          occurrenceId: sundayOccurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
        },
      ],
      assignments: {
        [sundayOccurrenceId]: {
          "position-keys::0": { primaryMemberId: "member-avery" },
        },
      },
    },
  ],
};

const mockSharedServices = [
  {
    id: "service-sunday",
    name: "Sunday",
    timerType: "countdown",
    reccurence: "one_time",
    dateTimeISO: "2026-07-05T10:00",
    color: "#ffffff",
    background: "#000000a1",
  },
];

const makeMockState = () => ({
  undoable: {
    present: {
      serviceTimes: {
        list: mockSharedServices,
      },
    },
  },
});

const renderTeams = (
  initialEntry = "/teams",
  contextOverrides: Record<string, unknown> = {},
) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext(contextOverrides) as ContextType<
            typeof GlobalInfoContext
          >
        }
      >
        <ToastProvider>
          <Routes>
            <Route path="/teams/*" element={<Teams />} />
          </Routes>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

const openVocalSlot = async (
  user: ReturnType<typeof userEvent.setup>,
  cellName: RegExp = /Sunday Vocal/i,
) => {
  const cell = await screen.findByRole("button", { name: cellName });
  await user.click(cell);
  return screen.findByRole("combobox", { name: /Sunday Vocal/i });
};

const waitForScheduleGrid = async () => {
  await screen.findByRole("button", { name: /Sunday Vocal/i });
};

describe("Teams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = makeMockState();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(baseBootstrap),
    );
  });

  it("renders the empty schedule state after bootstrap loads", async () => {
    renderTeams();

    expect(await screen.findByRole("heading", { name: /^Teams$/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(
      await screen.findByText(/Create a team, services, and a schedule/i),
    ).toBeInTheDocument();
  });

  it("routes the admin sections through sidebar links without using public link paths", async () => {
    const user = userEvent.setup();
    renderTeams();

    expect(await screen.findByRole("heading", { name: /^Schedules$/i })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toHaveAttribute(
      "href",
      "/teams/schedules",
    );
    expect(screen.getByRole("link", { name: /^Forms$/i })).toHaveAttribute(
      "href",
      "/teams/forms",
    );
    expect(screen.getByRole("link", { name: /^Forms$/i })).not.toHaveAttribute(
      "href",
      "/teams/intake",
    );

    await user.click(screen.getByRole("link", { name: /^Members$/i }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^Members$/i })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await user.click(screen.getByRole("link", { name: /^Positions$/i }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^Positions$/i })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await user.click(screen.getByRole("link", { name: /^Teams$/i }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^Teams$/i })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await user.click(screen.getByRole("link", { name: /^Services$/i }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^Services$/i })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    await user.click(screen.getByRole("link", { name: /^Schedules$/i }));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^Schedules$/i })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });

  it("contains a crash inside the active Teams section", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    renderTeams("/teams/forms");

    expect(await screen.findByRole("heading", { name: /^Teams$/i })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /This section could not load/i,
    );
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it("creates a position from the positions tab with a picked icon", async () => {
    const user = userEvent.setup();
    mockCreateTeamPosition.mockResolvedValue({
      success: true,
      position: {
        positionId: "position-vocal",
        churchId: "church-1",
        teamId: "team-main",
        name: "Vocal",
        description: "",
        icon: "Mic",
      },
    } satisfies CreateTeamPositionResponse);

    renderTeams("/teams/positions");
    await screen.findByRole("button", { name: /Create position/i });

    // Create form is gated: it is rendered but inert until "Create position" is clicked.
    const createRolePanel = screen.getByRole("region", {
      name: /Create position/i,
      hidden: true,
    });
    expect(createRolePanel).toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: /Create position/i }));
    expect(createRolePanel).not.toHaveAttribute("inert");

    await user.type(screen.getByLabelText(/^Name/i), "Vocal");
    await user.click(screen.getByRole("button", { name: /Icon picker/i }));
    await user.click(screen.getByRole("button", { name: /^Mic$/i }));
    await user.click(screen.getByRole("button", { name: /Save position/i }));

    await waitFor(() => {
      expect(mockCreateTeamPosition).toHaveBeenCalledWith("church-1", {
        name: "Vocal",
        description: "",
        icon: "Mic",
        teamId: "team-main",
      });
    });
  });

  it("permanently deletes a position after confirmation", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...baseBootstrap,
        positions: [
          {
            positionId: "position-vocal",
            churchId: "church-1",
            teamId: "team-main",
            name: "Vocal",
            icon: "Mic",
          },
        ],
      }),
    );
    mockDeleteTeamPosition.mockResolvedValue({
      success: true,
    } satisfies DeleteTeamPositionResponse);

    renderTeams("/teams/positions");
    await screen.findByRole("button", { name: /More actions for Vocal/i });

    await user.click(await screen.findByRole("button", { name: /More actions for Vocal/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Delete$/i }));
    await user.click(await screen.findByRole("button", { name: /Delete Forever/i }));

    await waitFor(() => {
      expect(mockDeleteTeamPosition).toHaveBeenCalledWith("church-1", "position-vocal");
    });
  });

  it("shows unavailable members as disabled in the assign panel", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await openVocalSlot(user);

    expect(
      await screen.findByRole("button", { name: /Morgan, unavailable: Blocked out/i }),
    ).toBeDisabled();
    expect(
      await screen.findByRole("button", {
        name: /Avery, unavailable: Already assigned in this service/i,
      }),
    ).toBeDisabled();
  });

  it("shows other eligible members when opening an occupied slot", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        members: [
          ...scheduleBootstrap.members,
          {
            memberId: "member-jordan",
            churchId: "church-1",
            firstName: "Jordan",
            lastName: "Ray",
            positionIds: ["position-vocal"],
            blockoutDates: [],
            notes: "",
          },
        ],
        teams: [
          {
            ...scheduleBootstrap.teams[0],
            memberIds: [
              ...scheduleBootstrap.teams[0].memberIds,
              "member-jordan",
            ],
          },
        ],
        schedules: [
          {
            ...scheduleBootstrap.schedules[0],
            assignments: {
              [sundayOccurrenceId]: {
                "position-vocal::0": { primaryMemberId: "member-avery" },
              },
            },
          },
        ],
      }),
    );

    renderTeams();
    // Open the occupied slot without clearing the input: the other eligible
    // member must still appear (the query must not be pre-filled with the
    // current assignee's name, which would hide everyone else).
    await openVocalSlot(user, /Sunday Vocal, Avery/i);

    expect(
      await screen.findByRole("option", { name: /^Jordan$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Clear assignment/i }),
    ).toBeInTheDocument();
  });

  it("limits day-of replacements to eligible members and hides clear assignment", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        members: [
          ...scheduleBootstrap.members,
          {
            memberId: "member-jordan",
            churchId: "church-1",
            firstName: "Jordan",
            lastName: "Ray",
            positionIds: ["position-vocal"],
            blockoutDates: [],
            notes: "",
          },
          {
            memberId: "member-casey",
            churchId: "church-1",
            firstName: "Casey",
            lastName: "Poe",
            positionIds: ["position-keys"],
            blockoutDates: [],
            notes: "",
          },
        ],
        teams: [
          {
            ...scheduleBootstrap.teams[0],
            memberIds: [
              ...scheduleBootstrap.teams[0].memberIds,
              "member-jordan",
              "member-casey",
            ],
          },
        ],
        schedules: [
          {
            ...scheduleBootstrap.schedules[0],
            assignments: {
              [sundayOccurrenceId]: {
                "position-vocal::0": { primaryMemberId: "member-avery" },
              },
            },
          },
        ],
      }),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(
      await screen.findByRole("button", {
        name: /View and copy assignments for Sunday/i,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Choose replacement/i }),
    );

    // An eligible vocal member is offered as a fill-in.
    expect(
      await screen.findByRole("option", { name: /^Jordan$/i }),
    ).toBeInTheDocument();
    // A keys-only member is not an eligible vocal replacement.
    expect(
      screen.queryByRole("option", { name: /^Casey$/i }),
    ).not.toBeInTheDocument();
    // The replacement flow never offers to clear the slot.
    expect(
      screen.queryByRole("button", { name: /Clear assignment/i }),
    ).not.toBeInTheDocument();
  });

  it("omits members who are not eligible for the position from assignment suggestions", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        members: [
          ...scheduleBootstrap.members,
          {
            memberId: "member-jordan",
            churchId: "church-1",
            firstName: "Jordan",
            lastName: "Ray",
            positionIds: ["position-keys"],
            blockoutDates: [],
            notes: "",
          },
        ],
        teams: [
          {
            ...scheduleBootstrap.teams[0],
            memberIds: [
              ...scheduleBootstrap.teams[0].memberIds,
              "member-jordan",
            ],
          },
        ],
      }),
    );

    renderTeams();
    await openVocalSlot(user);

    expect(screen.queryByRole("option", { name: /Jordan/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Jordan/i)).not.toBeInTheDocument();
  });

  it("loads the saved schedule name when editing a schedule", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /Edit schedule/i }));

    expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("July");
  });

  it("carries assignments into the new schedule when copying", async () => {
    const user = userEvent.setup();
    // A real service so the save can regenerate the same Sunday occurrence the
    // copied assignments are keyed to.
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        services: [
          {
            serviceId: "service-sunday",
            churchId: "church-1",
            name: "Sunday",
            reccurence: "one_time",
            dateTimeISO: "2026-07-05T10:00:00.000Z",
          } as TeamService,
        ],
      }),
    );
    mockCreateTeamSchedule.mockResolvedValue({
      success: true,
      schedule: { ...scheduleBootstrap.schedules[0], scheduleId: "schedule-copy" },
    } satisfies CreateTeamScheduleResponse);

    renderTeams();
    await waitForScheduleGrid();

    await user.click(screen.getByRole("button", { name: /Copy schedule/i }));

    // The copy seeds a "create" form that must already hold the copied data.
    expect(
      await screen.findByRole("textbox", { name: /^Name:?$/i }),
    ).toHaveValue("Copy of July");

    await user.click(screen.getByRole("button", { name: /Save schedule/i }));

    await waitFor(() => {
      expect(mockCreateTeamSchedule).toHaveBeenCalled();
    });
    const payload = mockCreateTeamSchedule.mock.calls[0][1] as TeamSchedulePayload;
    // The copy remaps assignments onto the freshly generated occurrence (its id
    // is timezone-dependent), so assert on the carried-over content, not the key.
    expect(Object.values(payload.assignments)).toEqual([
      { "position-keys::0": { primaryMemberId: "member-avery" } },
    ]);
  });

  it("loads Teams in view-only mode without schedule edit actions", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams("/teams", {
      role: "member",
      permissions: { teams: "view" },
      canViewTeams: true,
      canEditTeams: false,
      canEditTeam: jest.fn(() => false),
    });
    await waitForScheduleGrid();

    expect(screen.getByText("View-only Teams access")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /New schedule/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Edit schedule/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the saved schedule name when a cached edit draft is blank", () => {
    render(
      <ToastProvider>
        <ScheduleEditForm
          draftKey="schedule-july"
          persistedDraft={{
            name: "",
            description: "",
            teamId: "team-main",
            startDate: "2026-07-01",
            endDate: "2026-07-31",
            serviceIds: [],
            occurrences: [],
            assignments: {},
          }}
          selectedSchedule={scheduleBootstrap.schedules[0] as TeamSchedule}
          defaultTeamId="team-main"
          defaultServiceIds={["service-sunday"]}
          defaultRange={{ startDate: "2026-07-01", endDate: "2026-07-31" }}
          services={[
            {
              serviceId: "service-sunday",
              churchId: "church-1",
              ...mockSharedServices[0],
            } as TeamService,
          ]}
          activeTeams={scheduleBootstrap.teams as TeamRecord[]}
          churchId="church-1"
          canEdit
          onDraftChange={jest.fn()}
          onDraftFlush={jest.fn()}
          onScheduleSaved={jest.fn()}
          onScheduleRemoved={jest.fn()}
          setSelectedScheduleId={jest.fn()}
          onCancel={jest.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole("textbox", { name: /^Name:?$/i })).toHaveValue("July");
  });

  it("shows assignment counts beside members in the schedule roster", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await waitForScheduleGrid();

    expect(screen.getByLabelText(/Avery, assigned 1 time on this schedule/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Morgan, assigned 0 times on this schedule/i)).toBeInTheDocument();
  });

  it("shows last initials when multiple team members share a first name", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        members: [
          {
            memberId: "member-jordan-s",
            churchId: "church-1",
            firstName: "Jordan",
            lastName: "Smith",
            positionIds: ["position-vocal"],
            blockoutDates: [],
            notes: "",
          },
          {
            memberId: "member-jordan-m",
            churchId: "church-1",
            firstName: "Jordan",
            lastName: "Miller",
            positionIds: ["position-vocal"],
            blockoutDates: [],
            notes: "",
          },
        ],
        teams: [
          {
            teamId: "team-main",
            churchId: "church-1",
            name: "Main Team",
            memberIds: ["member-jordan-s", "member-jordan-m"],
          },
        ],
      }),
    );

    renderTeams();
    await waitForScheduleGrid();

    expect(screen.getByText("Jordan S.")).toBeInTheDocument();
    expect(screen.getByText("Jordan M.")).toBeInTheDocument();
  });

  it("adds a shadow member from the assignment submenu", async () => {
    const user = userEvent.setup();
    const shadowBootstrap: TestTeamsBootstrap = {
      ...scheduleBootstrap,
      members: [
        ...scheduleBootstrap.members,
        {
          memberId: "member-jordan",
          churchId: "church-1",
          firstName: "Jordan",
          lastName: "Ray",
          positionIds: ["position-vocal"],
          blockoutDates: [],
          notes: "",
        },
      ],
      teams: [
        {
          ...scheduleBootstrap.teams[0],
          memberIds: [
            ...scheduleBootstrap.teams[0].memberIds,
            "member-jordan",
          ],
        },
      ],
      schedules: [
        {
          ...scheduleBootstrap.schedules[0],
          assignments: {
            [sundayOccurrenceId]: {
              "position-vocal::0": { primaryMemberId: "member-morgan" },
            },
          },
        },
      ],
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(shadowBootstrap),
    );
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: {
          [sundayOccurrenceId]: {
            "position-vocal::0": {
              primaryMemberId: "member-morgan",
              shadows: [{ memberId: "member-jordan", kind: "shadow" }],
            },
          },
        },
      },
    } satisfies UpdateTeamScheduleAssignmentResponse);

    renderTeams();
    await openVocalSlot(user);
    await user.clear(screen.getByRole("combobox", { name: /Sunday Vocal/i }));
    await user.click(screen.getByRole("option", { name: /^Jordan$/i }));
    await user.click(screen.getByRole("menuitem", { name: /^Add as shadow$/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-vocal::0",
          memberId: "member-jordan",
          serviceDate: "2026-07-05",
          shadowAction: "add",
          shadowKind: "shadow",
        },
      );
    });
  });

  it("assigns an eligible member from the autocomplete", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        schedules: [
          {
            ...scheduleBootstrap.schedules[0],
            assignments: {},
          },
        ],
      }),
    );
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: {
          [sundayOccurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-avery" },
          },
        },
      },
    } satisfies UpdateTeamScheduleAssignmentResponse);

    renderTeams();
    await openVocalSlot(user);
    await user.click(await screen.findByRole("option", { name: /^Avery$/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-vocal::0",
          memberId: "member-avery",
          serviceDate: "2026-07-05",
        },
      );
    });
  });

  it("creates and assigns a new member when the typed name matches nobody", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        schedules: [{ ...scheduleBootstrap.schedules[0], assignments: {} }],
      }),
    );
    mockCreateTeamRosterMember.mockResolvedValue({
      success: true,
      member: {
        memberId: "member-new",
        churchId: "church-1",
        firstName: "Jordan",
        lastName: "Ray",
        positionIds: ["position-vocal"],
        blockoutDates: [],
        notes: "",
      },
    } satisfies CreateTeamRosterMemberResponse);
    mockUpdateTeam.mockResolvedValue({
      success: true,
      team: {
        ...scheduleBootstrap.teams[0],
        memberIds: [...scheduleBootstrap.teams[0].memberIds, "member-new"],
      },
    } satisfies UpdateTeamResponse);
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: {
          [sundayOccurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-new" },
          },
        },
      },
    } satisfies UpdateTeamScheduleAssignmentResponse);

    renderTeams();
    const vocalCombo = await openVocalSlot(user);
    await user.type(vocalCombo, "Jordan Ray");

    // No match -> the dropdown offers to add the typed person to the team.
    await user.click(
      await screen.findByRole("button", { name: /Add .*Jordan Ray.* to the team/i }),
    );

    // The mini-form is prefilled by splitting the typed name.
    expect(screen.getByRole("textbox", { name: /First name/i })).toHaveValue("Jordan");
    expect(screen.getByRole("textbox", { name: /Last name/i })).toHaveValue("Ray");
    await user.click(screen.getByRole("button", { name: /Add .*assign/i }));

    await waitFor(() => {
      expect(mockCreateTeamRosterMember).toHaveBeenCalledWith("church-1", {
        firstName: "Jordan",
        lastName: "Ray",
        positionIds: ["position-vocal"],
        blockoutDates: [],
      });
    });
    // New member is added to the team so they're eligible to be scheduled.
    expect(mockUpdateTeam).toHaveBeenCalledWith(
      "church-1",
      "team-main",
      expect.objectContaining({
        memberIds: expect.arrayContaining(["member-new"]),
      }),
    );
    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-vocal::0",
          memberId: "member-new",
          serviceDate: "2026-07-05",
        },
      );
    });
  });
});
