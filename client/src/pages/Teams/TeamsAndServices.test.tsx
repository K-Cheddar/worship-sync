import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeamsNavigationGuardProvider } from "./TeamsNavigationGuardContext";
import TeamsAndServices from "./TeamsAndServices";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastProvider } from "../../context/toastContext";
import { createMockGlobalContext } from "../../test/mocks";
import {
  createTeamPosition,
  createTeamRosterMember,
  createTeamSchedule,
  deleteTeamPosition,
  getServicePlanMicrophones,
  getTeamScheduleDetail,
  getTeamsBootstrap,
  listServicePlans,
  updateTeam,
  updateTeamPosition,
  updateTeamSchedule,
  updateTeamScheduleAssignment,
  updateTeamScheduleAssignmentSwap,
} from "../../api/auth";
import type { TeamSchedulePayload } from "../../api/auth";
import type {
  TeamRecord,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
  TeamsBootstrap,
} from "../../api/authTypes";
import ScheduleEditForm from "./schedule/ScheduleEditForm";

let mockState: unknown;
const mockDispatch = jest.fn();
let originalMatchMedia: typeof window.matchMedia;

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
  AuthApiError: class AuthApiError extends Error {
    status?: number;
    isReachabilityError: boolean;
    details?: unknown;

    constructor(
      message: string,
      options: {
        status?: number;
        isReachabilityError?: boolean;
        details?: unknown;
      } = {},
    ) {
      super(message);
      this.name = "AuthApiError";
      this.status = options.status;
      this.isReachabilityError = Boolean(options.isReachabilityError);
      this.details = options.details;
    }
  },
  getTeamsBootstrap: jest.fn(),
  getTeamScheduleDetail: jest.fn(),
  listServicePlans: jest.fn(),
  getServicePlanMicrophones: jest.fn(),
  saveServicePlanMicrophones: jest.fn(),
  createTeamPosition: jest.fn(),
  updateTeamPosition: jest.fn(),
  updateTeamScheduleAssignment: jest.fn(),
  updateTeamScheduleAssignmentSwap: jest.fn(),
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
const mockGetTeamScheduleDetail = jest.mocked(getTeamScheduleDetail);
const mockListServicePlans = jest.mocked(listServicePlans);
const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);
const mockCreateTeamPosition = jest.mocked(createTeamPosition);
const mockUpdateTeamPosition = jest.mocked(updateTeamPosition);
const mockUpdateTeamSchedule = jest.mocked(updateTeamSchedule);
const mockDeleteTeamPosition = jest.mocked(deleteTeamPosition);
const mockUpdateTeamScheduleAssignment = jest.mocked(
  updateTeamScheduleAssignment,
);
const mockUpdateTeamScheduleAssignmentSwap = jest.mocked(
  updateTeamScheduleAssignmentSwap,
);
const mockCreateTeamRosterMember = jest.mocked(createTeamRosterMember);
const mockCreateTeamSchedule = jest.mocked(createTeamSchedule);
const mockUpdateTeam = jest.mocked(updateTeam);
const sundayOccurrenceId = "service-sunday@2026-07-05T10:00:00.000Z";

type TeamsBootstrapResponse = Awaited<ReturnType<typeof getTeamsBootstrap>>;
// Fixtures always supply fully-hydrated schedules; the real bootstrap type
// allows summaries too, which would block reads of `assignments` here.
type TestTeamsBootstrap = Omit<TeamsBootstrap, "schedules"> & {
  schedules: TeamSchedule[];
  services?: TeamService[];
};
type CreateTeamPositionResponse = Awaited<ReturnType<typeof createTeamPosition>>;
type UpdateTeamPositionResponse = Awaited<ReturnType<typeof updateTeamPosition>>;
type CreateTeamRosterMemberResponse = Awaited<
  ReturnType<typeof createTeamRosterMember>
>;
type CreateTeamScheduleResponse = Awaited<ReturnType<typeof createTeamSchedule>>;
type DeleteTeamPositionResponse = Awaited<ReturnType<typeof deleteTeamPosition>>;
type UpdateTeamResponse = Awaited<ReturnType<typeof updateTeam>>;
type UpdateTeamScheduleAssignmentResponse = Awaited<
  ReturnType<typeof updateTeamScheduleAssignment>
>;
type UpdateTeamScheduleResponse = Awaited<ReturnType<typeof updateTeamSchedule>>;
type UpdateTeamScheduleAssignmentSwapResponse = Awaited<
  ReturnType<typeof updateTeamScheduleAssignmentSwap>
>;

const asTeamsBootstrapResponse = (
  value: TestTeamsBootstrap,
): TeamsBootstrapResponse => value;

const makeMatchMedia = (matches: boolean): typeof window.matchMedia =>
  jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;

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
  initialEntry = "/teams-and-services",
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
            <Route path="/teams-and-services/*" element={<TeamsAndServices />} />
          </Routes>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

const waitForTeamsBootstrap = async () => {
  await screen.findByRole("heading", { name: /^Schedules$/i }, { timeout: 8000 });
};

const openTeamsSectionsNavIfNeeded = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  const openButton = screen.queryByRole("button", { name: /Open sections/i });
  if (openButton) {
    await user.click(openButton);
  }
};

const waitForScheduleGrid = async () => {
  await waitForTeamsBootstrap();
  await screen.findByRole("button", { name: /Sunday Vocal/i }, { timeout: 8000 });
};

const openVocalSlot = async (
  user: ReturnType<typeof userEvent.setup>,
  cellName: RegExp = /Sunday Vocal/i,
) => {
  await waitForScheduleGrid();
  const cell = await screen.findByRole("button", { name: cellName }, { timeout: 3000 });
  await user.click(cell);
  return screen.findByRole("combobox", { name: /Sunday Vocal/i }, { timeout: 3000 });
};

describe("Teams", () => {
  jest.setTimeout(15000);
  beforeEach(() => {
    jest.clearAllMocks();
    originalMatchMedia = window.matchMedia;
    // Desktop default: max-width queries do not match, so the schedule grid
    // (not the board) is the layout under test.
    window.matchMedia = makeMatchMedia(false);
    mockState = makeMockState();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(baseBootstrap),
    );
    mockListServicePlans.mockResolvedValue({ success: true, servicePlans: [] });
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [],
      audiences: [],
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.localStorage.clear();
  });

  it("shows both sidebar domains and navigates between their sections", async () => {
    const user = userEvent.setup();
    renderTeams();

    await waitForTeamsBootstrap();
    await openTeamsSectionsNavIfNeeded(user);
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Plans$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Microphones$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Services$/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /^Microphones$/i }));
    expect(
      await screen.findByRole("heading", { name: /^Microphones$/i }),
    ).toBeInTheDocument();
    expect(mockGetServicePlanMicrophones).toHaveBeenCalledWith("church-1");

    await openTeamsSectionsNavIfNeeded(user);
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /^Schedules$/i }));
    await waitForTeamsBootstrap();
  });

  it("confirms before discarding unsaved microphone changes during sidebar navigation", async () => {
    const user = userEvent.setup();
    renderTeams("/teams-and-services/microphones");

    expect(
      await screen.findByRole("heading", { name: /^Microphones$/i }),
    ).toBeInTheDocument();
    // The list is read-only until the operator explicitly enters edit mode.
    await user.click(
      await screen.findByRole("button", { name: /Edit microphones/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Add microphone/i }),
    );
    await openTeamsSectionsNavIfNeeded(user);

    await user.click(screen.getByRole("link", { name: /^Plans$/i }));
    expect(
      await screen.findByRole("dialog", { name: /Unsaved changes/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Stay$/i }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /Unsaved changes/i }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("link", { name: /^Plans$/i }));
    await user.click(await screen.findByRole("button", { name: /Discard changes/i }));
    expect(
      await screen.findByRole("heading", { name: /^Plans$/i }),
    ).toBeInTheDocument();
  });

  it("renders the empty schedule state after bootstrap loads", async () => {
    renderTeams();

    expect(
      await screen.findByRole("heading", { name: /^Teams and Services$/i }),
    ).toBeInTheDocument();
    await waitForTeamsBootstrap();
    expect(
      await screen.findByText(/Create a team, services, and a schedule/i),
    ).toBeInTheDocument();
  });

  it("hydrates the remembered schedule after its bootstrap summary arrives", async () => {
    const { assignments: _assignments, ...summaryBase } = scheduleBootstrap.schedules[0];
    const scheduleId = "schedule-june";
    const summary = {
      ...summaryBase,
      scheduleId,
      name: "June",
      assignmentsOmitted: true,
    };
    const hydrated = {
      ...scheduleBootstrap.schedules[0],
      scheduleId,
      name: "June",
    };
    window.localStorage.setItem(
      "teams:selected-schedule:church-1",
      scheduleId,
    );
    mockGetTeamsBootstrap.mockResolvedValue({
      ...scheduleBootstrap,
      schedules: [summary],
    } as TeamsBootstrapResponse);
    mockGetTeamScheduleDetail.mockResolvedValue({
      success: true,
      schedule: hydrated,
      relatedSchedules: [],
    });

    renderTeams();

    await waitFor(() => {
      expect(mockGetTeamScheduleDetail).toHaveBeenCalledWith("church-1", scheduleId);
    });
    expect(
      await screen.findByRole("button", { name: /Sunday Vocal/i }),
    ).toBeInTheDocument();
  });

  it("saves auto-fill as one protected schedule update", async () => {
    const user = userEvent.setup();
    const autoFillSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      assignments: {},
      occurrences: [
        {
          occurrenceId: sundayOccurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
          positionRequirements: [
            { positionId: "position-vocal", count: 1 },
            { positionId: "position-keys", count: 1 },
          ],
        },
      ],
    };
    let resolveSave: (value: UpdateTeamScheduleResponse) => void = () => undefined;
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        members: scheduleBootstrap.members.map((member) => ({
          ...member,
          blockoutDates: [],
        })),
        schedules: [autoFillSchedule],
      }),
    );
    mockUpdateTeamSchedule.mockImplementationOnce(
      () =>
        new Promise<UpdateTeamScheduleResponse>((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(mockUpdateTeamSchedule).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateTeamScheduleAssignment).not.toHaveBeenCalled();
    expect(mockUpdateTeamSchedule).toHaveBeenCalledWith(
      "church-1",
      "schedule-july",
      expect.objectContaining({
        assignments: expect.objectContaining({ [sundayOccurrenceId]: expect.any(Object) }),
      }),
    );

    await user.click(screen.getByRole("link", { name: /^Members$/i }));
    expect(
      await screen.findByRole("dialog", { name: /Unsaved changes/i }),
    ).toBeInTheDocument();

    resolveSave({
      success: true,
      schedule: {
        ...autoFillSchedule,
        assignments: mockUpdateTeamSchedule.mock.calls[0][2].assignments,
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Auto-filled 2 of 2 open slots/i)).toBeInTheDocument();
    });
  });

  it("clears just-filled highlights when auto-fill save fails", async () => {
    const user = userEvent.setup();
    const autoFillSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      assignments: {},
      occurrences: [
        {
          occurrenceId: sundayOccurrenceId,
          serviceId: "service-sunday",
          name: "Sunday",
          startsAt: "2026-07-05T10:00:00.000Z",
          positionRequirements: [
            { positionId: "position-vocal", count: 1 },
            { positionId: "position-keys", count: 1 },
          ],
        },
      ],
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        members: scheduleBootstrap.members.map((member) => ({
          ...member,
          blockoutDates: [],
        })),
        schedules: [autoFillSchedule],
      }),
    );
    // Reject after the first reveal step has painted so the failure path must
    // clear just-filled highlights rather than relying on them never appearing.
    mockUpdateTeamSchedule.mockImplementationOnce(
      () =>
        new Promise<UpdateTeamScheduleResponse>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Save failed")), 80);
        }),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));

    expect(
      await screen.findByText(/Save failed/i, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sunday Vocal, Empty/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sunday Keys, Empty/i }),
    ).toBeInTheDocument();
    // outline-cyan-300/40 is only applied while justFilled is true.
    const justFilledCells = screen
      .getAllByRole("cell")
      .filter((cell) => cell.className.includes("outline-cyan-300/40"));
    expect(justFilledCells).toHaveLength(0);
  });

  it("refreshes other-team schedules before auto-fill considers their members", async () => {
    const user = userEvent.setup();
    const openSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      assignments: {},
      occurrences: [
        {
          ...scheduleBootstrap.schedules[0].occurrences[0],
          positionRequirements: [{ positionId: "position-vocal", count: 1 }],
        },
      ],
    };
    const otherTeamSchedule: TeamSchedule = {
      ...openSchedule,
      scheduleId: "schedule-production",
      name: "Production July",
      teamId: "team-production",
      assignments: {
        [sundayOccurrenceId]: {
          "position-camera::0": { primaryMemberId: "member-avery" },
        },
      },
    };
    const staleOtherTeamSchedule: TeamScheduleSummary = {
      ...otherTeamSchedule,
      assignments: {},
    };
    mockGetTeamsBootstrap.mockResolvedValue({
      ...scheduleBootstrap,
      teams: [
        ...scheduleBootstrap.teams,
        {
          teamId: "team-production",
          churchId: "church-1",
          name: "Production",
          memberIds: [],
        },
      ],
      schedules: [openSchedule, staleOtherTeamSchedule],
    });
    mockGetTeamScheduleDetail.mockResolvedValue({
      success: true,
      schedule: openSchedule,
      relatedSchedules: [otherTeamSchedule],
    });

    renderTeams();
    await waitForScheduleGrid();

    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(mockGetTeamScheduleDetail).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
      );
    });
    expect(
      await screen.findByText(/No eligible person was available for the open slots/i),
    ).toBeInTheDocument();
    expect(mockUpdateTeamSchedule).not.toHaveBeenCalled();
  });

  it("routes the admin sections through sidebar links without using public link paths", async () => {
    const user = userEvent.setup();
    renderTeams();

    expect(await screen.findByRole("heading", { name: /^Schedules$/i })).toBeInTheDocument();

    await openTeamsSectionsNavIfNeeded(user);

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toHaveAttribute(
      "href",
      "/teams-and-services/schedules",
    );
    expect(screen.getByRole("link", { name: /^Forms$/i })).toHaveAttribute(
      "href",
      "/teams-and-services/forms",
    );
    expect(screen.getByRole("link", { name: /^Forms$/i })).not.toHaveAttribute(
      "href",
      "/teams/intake",
    );

    await openTeamsSectionsNavIfNeeded(user);
    await user.click(screen.getByRole("link", { name: /^Members$/i }));
    expect(
      await screen.findByRole("button", { name: /Create member/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Members$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await openTeamsSectionsNavIfNeeded(user);
    await user.click(screen.getByRole("link", { name: /^Positions$/i }));
    expect(
      await screen.findByRole("button", { name: /Create position/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Positions$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await openTeamsSectionsNavIfNeeded(user);
    await user.click(screen.getByRole("link", { name: /^Teams$/i }));
    expect(
      await screen.findByRole("button", { name: /Create team/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Teams$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await openTeamsSectionsNavIfNeeded(user);
    await user.click(screen.getByRole("link", { name: /^Schedules$/i }));
    expect(
      await screen.findByRole("heading", { name: /^Schedules$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("contains a crash inside the active Teams section", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    renderTeams("/teams-and-services/forms");

    expect(
      await screen.findByRole("heading", { name: /^Teams and Services$/i }),
    ).toBeInTheDocument();
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

    renderTeams("/teams-and-services/positions");
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

  it("keeps the team editor open after saving so teams can be edited back-to-back", async () => {
    const user = userEvent.setup();
    mockUpdateTeam.mockResolvedValue({
      success: true,
      team: {
        teamId: "team-main",
        churchId: "church-1",
        name: "Main Team Renamed",
        memberIds: [],
      },
    } satisfies UpdateTeamResponse);

    renderTeams("/teams-and-services/groups");
    await screen.findByRole("button", { name: /Edit Main Team/i });
    await user.click(screen.getByRole("button", { name: /Edit Main Team/i }));
    expect(
      await screen.findByRole("heading", { name: /Edit team/i }),
    ).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/^Name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Main Team Renamed");
    await user.click(screen.getByRole("button", { name: /Save team/i }));

    await waitFor(() => {
      expect(mockUpdateTeam).toHaveBeenCalledWith(
        "church-1",
        "team-main",
        expect.objectContaining({ name: "Main Team Renamed" }),
      );
    });
    // On desktop the panel stays open on save so the next team can be edited
    // without reopening it.
    expect(screen.getByRole("heading", { name: /Edit team/i })).toBeInTheDocument();
  });

  it("closes the team editor after saving on narrow screens", async () => {
    window.matchMedia = makeMatchMedia(true);
    const user = userEvent.setup();
    mockUpdateTeam.mockResolvedValue({
      success: true,
      team: {
        teamId: "team-main",
        churchId: "church-1",
        name: "Main Team Renamed",
        memberIds: [],
      },
    } satisfies UpdateTeamResponse);

    renderTeams("/teams-and-services/groups");
    await screen.findByRole("button", { name: /Edit Main Team/i });
    await user.click(screen.getByRole("button", { name: /Edit Main Team/i }));
    expect(
      await screen.findByRole("heading", { name: /Edit team/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save team/i }));

    await waitFor(() => {
      expect(mockUpdateTeam).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("heading", { name: /Edit team/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create team/i }),
    ).toBeInTheDocument();
  });

  it("shows Close for an unchanged team and Cancel after an edit", async () => {
    const user = userEvent.setup();

    renderTeams("/teams-and-services/groups");
    await user.click(await screen.findByRole("button", { name: /Edit Main Team/i }));

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Use microphone assignments/i }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("confirms before leaving a team with unsaved changes", async () => {
    const user = userEvent.setup();

    renderTeams("/teams-and-services/groups");
    await user.click(await screen.findByRole("button", { name: /Edit Main Team/i }));
    await user.type(screen.getByLabelText(/^Name/i), " updated");

    await openTeamsSectionsNavIfNeeded(user);
    await user.click(screen.getByRole("link", { name: /^Members$/i }));
    expect(
      await screen.findByRole("dialog", { name: /Unsaved changes/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Unsaved changes/i })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("link", { name: /^Members$/i }));
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(
      await screen.findByRole("button", { name: "Create member" }),
    ).toBeInTheDocument();
  });

  it("confirms before replacing an edited member", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse(scheduleBootstrap));

    renderTeams("/teams-and-services/members");
    await user.click(
      await screen.findByRole("button", { name: "Edit Avery Stone" }),
    );
    await user.type(await screen.findByDisplayValue("Avery"), " updated");
    await user.click(screen.getByRole("button", { name: "Edit Morgan Lee" }));

    expect(
      await screen.findByRole("dialog", { name: /Unsaved changes/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(await screen.findByDisplayValue("Morgan")).toBeInTheDocument();
  });

  it("does not create duplicate positions when Save is double-clicked", async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: CreateTeamPositionResponse) => void = () => { };
    mockCreateTeamPosition.mockImplementation(
      () =>
        new Promise<CreateTeamPositionResponse>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    renderTeams("/teams-and-services/positions");
    await screen.findByRole("button", { name: /Create position/i });
    await user.click(screen.getByRole("button", { name: /Create position/i }));
    await user.type(screen.getByLabelText(/^Name/i), "Vocal");

    const saveButton = screen.getByRole("button", { name: /Save position/i });
    await user.click(saveButton);
    // A second Save while the create is still in flight must be ignored so the
    // panel staying open can't spawn duplicate positions.
    await user.click(saveButton);
    expect(mockCreateTeamPosition).toHaveBeenCalledTimes(1);

    resolveCreate({
      success: true,
      position: {
        positionId: "position-vocal",
        churchId: "church-1",
        teamId: "team-main",
        name: "Vocal",
        description: "",
        icon: "",
      },
    } satisfies CreateTeamPositionResponse);

    await waitFor(() => {
      expect(mockCreateTeamPosition).toHaveBeenCalledTimes(1);
    });
  });

  it("does not rebind the panel to a stale position when an in-flight save resolves after switching", async () => {
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
      }),
    );
    let resolveVocalSave: (value: UpdateTeamPositionResponse) => void = () => { };
    mockUpdateTeamPosition.mockImplementation(
      () =>
        new Promise<UpdateTeamPositionResponse>((resolve) => {
          resolveVocalSave = resolve;
        }),
    );

    renderTeams("/teams-and-services/positions");
    await screen.findByRole("button", { name: /Edit Vocal/i });

    // Edit Vocal, save, and leave the save in flight.
    await user.click(screen.getByRole("button", { name: /Edit Vocal/i }));
    const vocalNameInput = screen.getByLabelText(/^Name/i);
    await user.clear(vocalNameInput);
    await user.type(vocalNameInput, "Lead Vocal");
    await user.click(screen.getByRole("button", { name: /Save position/i }));
    await waitFor(() => {
      expect(mockUpdateTeamPosition).toHaveBeenCalledWith(
        "church-1",
        "position-vocal",
        expect.objectContaining({ name: "Lead Vocal" }),
      );
    });

    // Switch to another position while the first save is still pending.
    await user.click(screen.getByRole("button", { name: /Edit Keys/i }));
    expect(screen.getByLabelText(/^Name/i)).toHaveValue("Keys");

    // The in-flight Vocal save resolves; the panel must stay on Keys.
    resolveVocalSave({
      success: true,
      position: {
        positionId: "position-vocal",
        churchId: "church-1",
        teamId: "team-main",
        name: "Lead Vocal",
        icon: "mic",
      },
    } satisfies UpdateTeamPositionResponse);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Name/i)).toHaveValue("Keys");
    });

    // Editing and saving now must target Keys, never overwrite Vocal.
    const keysNameInput = screen.getByLabelText(/^Name/i);
    await user.clear(keysNameInput);
    await user.type(keysNameInput, "Grand Piano");
    await user.click(screen.getByRole("button", { name: /Save position/i }));

    await waitFor(() => {
      expect(mockUpdateTeamPosition).toHaveBeenLastCalledWith(
        "church-1",
        "position-keys",
        expect.objectContaining({ name: "Grand Piano" }),
      );
    });
    const vocalSaves = mockUpdateTeamPosition.mock.calls.filter(
      ([, positionId]) => positionId === "position-vocal",
    );
    expect(vocalSaves).toHaveLength(1);
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

    renderTeams("/teams-and-services/positions");
    await screen.findByRole("button", { name: /Edit Vocal/i });

    await user.click(screen.getByRole("button", { name: /Edit Vocal/i }));
    expect(await screen.findByRole("heading", { name: /Edit position/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Position actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /Delete position/i }));
    await user.click(screen.getByRole("button", { name: /Delete Forever/i }));

    await waitFor(() => {
      expect(mockDeleteTeamPosition).toHaveBeenCalledWith("church-1", "position-vocal");
    });
  });

  it("allows moving an already scheduled member into an empty slot", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );
    let resolveAssignment:
      | ((value: UpdateTeamScheduleAssignmentResponse) => void)
      | undefined;
    mockUpdateTeamScheduleAssignment.mockImplementation(
      () =>
        new Promise<UpdateTeamScheduleAssignmentResponse>((resolve) => {
          resolveAssignment = resolve;
        }),
    );

    renderTeams();
    await openVocalSlot(user);

    expect(await screen.findByRole("button", { name: /Assign Morgan/i })).toBeEnabled();
    expect(
      screen.queryByRole("group", { name: /^Recommended$/i }),
    ).not.toBeInTheDocument();
    const averyOption = await screen.findByRole("option", {
      name: /Avery.*Will move from Keys/i,
    });
    expect(averyOption).not.toBeDisabled();

    await user.click(averyOption);

    expect(
      await screen.findByRole("button", { name: /Sunday Vocal, Avery/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Sunday Keys, Empty/i }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-vocal::0",
          memberId: "member-avery",
          serviceDate: "2026-07-05",
          sourceServiceId: sundayOccurrenceId,
          sourcePositionSlotKey: "position-keys::0",
        },
      );
    });
    resolveAssignment?.({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: {
          [sundayOccurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-avery" },
          },
        },
      },
    });
  });

  it("confirms before scheduling a member with a blocked-out date", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: {
          [sundayOccurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-morgan" },
            "position-keys::0": { primaryMemberId: "member-avery" },
          },
        },
      },
    });

    renderTeams();
    await openVocalSlot(user);

    await user.click(await screen.findByRole("button", { name: /Assign Morgan/i }));

    expect(
      await screen.findByRole("heading", { name: /Blocked-out date/i }),
    ).toBeInTheDocument();
    expect(mockUpdateTeamScheduleAssignment).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Schedule anyway/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-vocal::0",
          memberId: "member-morgan",
          serviceDate: "2026-07-05",
          allowBlockout: true,
        },
      );
    });
  });

  it("does not focus the assignment search when opening a schedule cell", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    const vocalCombo = await openVocalSlot(user);

    expect(vocalCombo).not.toHaveFocus();
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
    expect(screen.getByText("Recommended")).toBeInTheDocument();
  });

  it("does not recommend members who can only be assigned as shadows", async () => {
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
    await openVocalSlot(user, /Sunday Vocal, Avery/i);

    const recommendedGroup = await screen.findByRole("group", {
      name: /^Recommended$/i,
    });
    expect(
      within(recommendedGroup).getByRole("option", { name: /^Jordan$/i }),
    ).toBeInTheDocument();
    expect(
      within(recommendedGroup).queryByRole("option", { name: /^Casey$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Casey$/i })).toBeInTheDocument();
  });

  it("applies a recommended swap from the assignment popover", async () => {
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
            positionIds: ["position-vocal", "position-keys"],
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
                "position-keys::0": { primaryMemberId: "member-jordan" },
              },
            },
          },
        ],
      }),
    );
    mockUpdateTeamScheduleAssignmentSwap.mockResolvedValue({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: {
          [sundayOccurrenceId]: {
            "position-vocal::0": { primaryMemberId: "member-jordan" },
            "position-keys::0": { primaryMemberId: "member-avery" },
          },
        },
      },
    } satisfies UpdateTeamScheduleAssignmentSwapResponse);

    renderTeams();
    await openVocalSlot(user, /Sunday Vocal, Avery/i);

    expect(await screen.findByText("Possible swaps")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Move Avery to Keys.*Assign Jordan here/i }),
    );

    expect(await screen.findByText("Recommended swap")).toBeInTheDocument();
    expect(screen.getByText(/Move Avery from Vocal to Keys/i)).toBeInTheDocument();
    expect(screen.getByText(/Assign Jordan to Vocal/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply swap/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentSwap).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateTeamScheduleAssignmentSwap).toHaveBeenCalledWith(
      "church-1",
      "schedule-july",
      {
        serviceId: sundayOccurrenceId,
        targetPositionSlotKey: "position-vocal::0",
        sourcePositionSlotKey: "position-keys::0",
        currentMemberId: "member-avery",
        candidateMemberId: "member-jordan",
        serviceDate: "2026-07-05",
      },
    );
    expect(mockUpdateTeamScheduleAssignment).not.toHaveBeenCalled();
  });

  it("opens a readable service summary dialog from a schedule date", async () => {
    const user = userEvent.setup();
    window.matchMedia = makeMatchMedia(true);
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(
      await screen.findByRole("button", {
        name: /View and copy assignments for Sunday/i,
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Sunday" });
    expect(within(dialog).getByText("Keys:")).toBeInTheDocument();
    expect(within(dialog).getByText(/Avery/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Close modal" }),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    await user.click(screen.getByRole("menuitem", { name: /Edit schedule/i }));

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

    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    await user.click(screen.getByRole("menuitem", { name: /Copy schedule/i }));

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
    expect(Object.values(payload.assignments || {})).toEqual([
      { "position-keys::0": { primaryMemberId: "member-avery" } },
    ]);
  });

  it("loads Teams in view-only mode without schedule edit actions", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams("/teams-and-services", {
      role: "member",
      permissions: { teams: "view" },
      canViewTeams: true,
      canEditTeams: false,
      canEditTeam: jest.fn(() => false),
    });
    await waitForScheduleGrid();

    expect(
      screen.queryByRole("button", { name: /New schedule/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /More schedule options/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the saved schedule name when a cached edit draft is blank", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
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
              schedules={scheduleBootstrap.schedules as TeamSchedule[]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onScheduleSaved={jest.fn()}
              onScheduleRemoved={jest.fn()}
              setSelectedScheduleId={jest.fn()}
              onCancel={jest.fn()}
            />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </MemoryRouter>,
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
    await user.click(vocalCombo);
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
