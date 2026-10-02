import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContextType, SVGProps } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TeamsNavigationGuardProvider } from "./TeamsNavigationGuardContext";
import TeamsAndServices from "./TeamsAndServices";
import TeamsMobileNavigation from "./components/TeamsMobileNavigation";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastProvider } from "../../context/toastContext";
import { createMockGlobalContext } from "../../test/mocks";
import {
  createTeamPosition,
  createTeamRosterMember,
  createTeamSchedule,
  addTeamSchedulePositionSlot,
  deleteTeamPosition,
  getServicePlanMicrophones,
  getServiceEquipment,
  getTeamScheduleDetail,
  ensureTeamScheduleForPeriod,
  getNotificationIntents,
  getTeamsBootstrap,
  listServicePlans,
  sendTeamSchedule,
  updateTeam,
  updateTeamPosition,
  updateTeamSchedule,
  updateTeamScheduleAssignment,
  updateTeamScheduleAssignmentsBatch,
  updateTeamScheduleAssignmentMicrophones,
  updateTeamScheduleAssignmentIems,
  updateTeamScheduleAssignmentSwap,
} from "../../api/auth";
import type { TeamSchedulePayload } from "../../api/auth";
import type {
  NotificationIntent,
  TeamRecord,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
  TeamsBootstrap,
} from "../../api/authTypes";
import ScheduleEditForm from "./schedule/ScheduleEditForm";
import { writeTeamScheduleAdminLayout } from "./teamScheduleAdminLayout";
import { calendarMonthRange, shiftRange } from "./rangeSelection";

let mockState: unknown;
const mockDispatch = jest.fn();
let originalMatchMedia: typeof window.matchMedia;

jest.mock("@tabler/icons-react", () => ({
  IconVideo: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
}));

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
  ensureTeamScheduleForPeriod: jest.fn(),
  sendTeamSchedule: jest.fn(),
  getNotificationIntents: jest.fn().mockResolvedValue({ success: true, intents: [], nextCursor: "", limit: 20 }),
  listServicePlans: jest.fn(),
  getServicePlanMicrophones: jest.fn(),
  getServiceEquipment: jest.fn(),
  saveServicePlanMicrophones: jest.fn(),
  createTeamPosition: jest.fn(),
  updateTeamPosition: jest.fn(),
  updateTeamScheduleAssignment: jest.fn(),
  updateTeamScheduleAssignmentsBatch: jest.fn(),
  updateTeamScheduleAssignmentMicrophones: jest.fn(),
  updateTeamScheduleAssignmentIems: jest.fn(),
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
  addTeamSchedulePositionSlot: jest.fn(),
  updateTeamSchedule: jest.fn(),
  archiveTeamSchedule: jest.fn(),
  deleteTeamSchedule: jest.fn(),
}));

const mockGetTeamsBootstrap = jest.mocked(getTeamsBootstrap);
const mockGetTeamScheduleDetail = jest.mocked(getTeamScheduleDetail);
const mockEnsureTeamScheduleForPeriod = jest.mocked(ensureTeamScheduleForPeriod);
const mockGetNotificationIntents = jest.mocked(getNotificationIntents);
const mockSendTeamSchedule = jest.mocked(sendTeamSchedule);
const mockListServicePlans = jest.mocked(listServicePlans);
const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);
const mockGetServiceEquipment = jest.mocked(getServiceEquipment);
const mockCreateTeamPosition = jest.mocked(createTeamPosition);
const mockUpdateTeamPosition = jest.mocked(updateTeamPosition);
const mockUpdateTeamSchedule = jest.mocked(updateTeamSchedule);
const mockDeleteTeamPosition = jest.mocked(deleteTeamPosition);
const mockUpdateTeamScheduleAssignment = jest.mocked(
  updateTeamScheduleAssignment,
);
const mockUpdateTeamScheduleAssignmentsBatch = jest.mocked(updateTeamScheduleAssignmentsBatch);
const mockUpdateTeamScheduleAssignmentMicrophones = jest.mocked(
  updateTeamScheduleAssignmentMicrophones,
);
const mockUpdateTeamScheduleAssignmentIems = jest.mocked(updateTeamScheduleAssignmentIems);
const mockUpdateTeamScheduleAssignmentSwap = jest.mocked(
  updateTeamScheduleAssignmentSwap,
);
const mockCreateTeamRosterMember = jest.mocked(createTeamRosterMember);
const mockCreateTeamSchedule = jest.mocked(createTeamSchedule);
const mockAddTeamSchedulePositionSlot = jest.mocked(addTeamSchedulePositionSlot);
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
type UpdateTeamScheduleAssignmentMicrophonesResponse = Awaited<
  ReturnType<typeof updateTeamScheduleAssignmentMicrophones>
>;
type UpdateTeamScheduleAssignmentIemsResponse = Awaited<
  ReturnType<typeof updateTeamScheduleAssignmentIems>
>;
type UpdateTeamScheduleAssignmentsBatchResponse = Awaited<
  ReturnType<typeof updateTeamScheduleAssignmentsBatch>
>;
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

const TeamsLocationProbe = () => {
  const location = useLocation();
  return <div data-testid="teams-location">{JSON.stringify({ pathname: location.pathname, state: location.state })}</div>;
};

const renderTeams = (
  initialEntry: string | { pathname: string; state?: unknown } = "/teams-and-services",
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
          <TeamsLocationProbe />
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

const waitForTeamsBootstrap = async () => {
  await screen.findByRole("heading", { name: /^Schedules$/i }, { timeout: 8000 });
};

const openTeamsNavigationIfNeeded = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  const openButton = screen.queryByRole("button", { name: /Open menu/i });
  if (openButton) {
    await user.click(openButton);
  }
};

const waitForScheduleGrid = async () => {
  await waitForTeamsBootstrap();
  if (!screen.queryByRole("button", { name: /Sunday Vocal/i })) {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    await user.click(screen.getByRole("menuitem", { name: "Schedule history" }));
    await user.click(await screen.findByRole("button", { name: /July/i }));
  }
  await screen.findByRole("button", { name: /Sunday Vocal/i }, { timeout: 8000 });
};

/**
 * Open a schedule assignment cell. Occupied slots start on an actions menu
 * (Find a sub / Add shadow / More options / …); pass `occupiedAction` to enter
 * the member picker, or leave it unset to default to "Find a sub".
 */
const openVocalSlot = async (
  user: ReturnType<typeof userEvent.setup>,
  cellName: RegExp = /Sunday Vocal/i,
  occupiedAction:
    | "Find a sub"
    | "Add shadow"
    | "Add reverse shadow"
    | "More options" = "Find a sub",
) => {
  await waitForScheduleGrid();
  const cell = await screen.findByRole("button", { name: cellName }, { timeout: 3000 });
  await user.click(cell);
  const occupiedMenuItem = screen.queryByRole("menuitem", {
    name: new RegExp(`^${occupiedAction}$`, "i"),
  });
  if (occupiedMenuItem) {
    await user.click(occupiedMenuItem);
  }
  return screen.findByRole("combobox", { name: /Sunday Vocal/i }, { timeout: 3000 });
};

describe("Teams", () => {
  // Coverage + suite load makes lazy routes and schedule grids slower than the
  // default 5s Jest budget; keep headroom without masking real hangs.
  jest.setTimeout(30_000);

  // Warm the lazy route chunks used by these tests so the first visit does not
  // sit in Suspense while findBy polls — under CI load that race can hang until
  // the suite timeout instead of failing cleanly.
  beforeAll(async () => {
    await Promise.all([
      import("./pages/TeamsMicrophonesPage"),
      import("./pages/TeamsPlansPage"),
      import("./pages/TeamsSchedulesPage"),
      import("./pages/TeamsMembersPage"),
      import("./pages/TeamsPositionsPage"),
      import("./pages/TeamsFormsPage"),
      import("./pages/TeamsGroupsPage"),
    ]);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    originalMatchMedia = window.matchMedia;
    // Prefer the table layout in these tests so cell roles and grid assertions
    // stay stable; production defaults to the card ("board") layout.
    window.matchMedia = makeMatchMedia(false);
    writeTeamScheduleAdminLayout("grid");
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
    mockGetServiceEquipment.mockResolvedValue({ success: true, equipment: [] });
    mockGetNotificationIntents.mockResolvedValue({
      success: true,
      intents: [],
      nextCursor: "",
      limit: 20,
    });
    mockUpdateTeamScheduleAssignmentsBatch.mockImplementation(async (_churchId, _scheduleId, body) => ({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: Object.fromEntries(body.changes.reduce((rows, change) => {
          const row = rows.get(change.serviceId) || {};
          if (change.assignment) row[change.positionSlotKey] = change.assignment;
          else delete row[change.positionSlotKey];
          rows.set(change.serviceId, row);
          return rows;
        }, new Map<string, Record<string, unknown>>())) as TeamSchedule["assignments"],
      },
      accepted: body.changes.map(({ serviceId, positionSlotKey }) => ({ serviceId, positionSlotKey })),
      skipped: [],
    }));
  });

  afterEach(() => {
    // Fake-timer tests must not leak into later async waits under suite load.
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
    window.localStorage.clear();
  });

  it("shows both sidebar domains and navigates between their sections", async () => {
    const user = userEvent.setup();
    renderTeams();

    await waitForTeamsBootstrap();
    await openTeamsNavigationIfNeeded(user);
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Services$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Equipment$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Services$/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /^Equipment$/i }));
    expect(
      await screen.findByRole(
        "button",
        { name: /Edit microphones/i },
        { timeout: 8_000 },
      ),
    ).toBeInTheDocument();
    expect(mockGetServicePlanMicrophones).toHaveBeenCalledWith("church-1");

    await openTeamsNavigationIfNeeded(user);
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /^Schedules$/i }));
    await waitForTeamsBootstrap();
  });

  it("combines app actions and workspace sections in the mobile menu drawer", async () => {
    const user = userEvent.setup();
    const onChangelog = jest.fn();

    render(
      <MemoryRouter>
        <TeamsNavigationGuardProvider>
          <TeamsMobileNavigation
            menuItems={[
              { text: "Home", to: "/" },
              { text: "Changelog", onClick: onChangelog },
            ]}
          />
        </TeamsNavigationGuardProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Open menu/i }));

    const drawer = screen.getByRole("dialog", { name: /^Menu$/i });
    expect(within(drawer).getByRole("link", { name: /^Home$/i })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: /^Services$/i })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: /^Changelog$/i }));
    expect(onChangelog).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: /^Menu$/i })).not.toBeInTheDocument();
  });

  it(
    "confirms before discarding unsaved microphone changes during sidebar navigation",
    async () => {
      const user = userEvent.setup({ delay: null });
      renderTeams("/teams-and-services/microphones");

      // Bootstrap must finish and the microphones outlet must mount before edit
      // controls exist; give CI enough time without relying on the suite default.
      const editMicrophones = await screen.findByRole(
        "button",
        { name: /Edit microphones/i },
        { timeout: 8_000 },
      );
      // The list is read-only until the operator explicitly enters edit mode.
      await user.click(editMicrophones);
      await user.click(
        await screen.findByRole("button", { name: /Add microphone/i }),
      );
      await openTeamsNavigationIfNeeded(user);

      await user.click(screen.getByRole("link", { name: /^Services$/i }));
      expect(
        await screen.findByRole("dialog", { name: /Unsaved changes/i }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^Stay$/i }));
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: /Unsaved changes/i }),
        ).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole("link", { name: /^Services$/i }));
      await user.click(
        await screen.findByRole("button", { name: /Discard changes/i }),
      );
      expect(
        await screen.findByRole("heading", { name: /^Services$/i }),
      ).toBeInTheDocument();
    },
    30_000,
  );

  it("renders the empty schedule state after bootstrap loads", async () => {
    renderTeams();

    expect(
      await screen.findByRole("heading", { name: /Teams and Services/i }),
    ).toBeInTheDocument();
    await waitForTeamsBootstrap();
    expect(
      await screen.findByText(/No service occurrences are configured for this period/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Service Setup" })).toHaveAttribute(
      "href",
      "/teams-and-services/service-setup",
    );
  });

  it("keeps Back to plan in the schedule identity and returns to the originating plan", async () => {
    const user = userEvent.setup();
    const returnTo = {
      label: "Back to plan",
      pathname: "/teams-and-services/services",
      restore: {
        kind: "plans" as const,
        serviceId: "service-worship",
        occurrenceId: "service-worship@2026-10-04T10:00:00.000Z",
        date: "2026-10-04",
      },
    };
    renderTeams({
      pathname: "/teams-and-services/schedules",
      state: { teamsReturnTo: returnTo },
    });

    const identity = await screen.findByRole("group", { name: "Team schedule identity" });
    expect(within(identity).getByRole("heading", { name: "Team schedule" })).toBeInTheDocument();
    await user.click(within(identity).getByRole("button", { name: "Back to plan" }));

    expect(screen.getByTestId("teams-location")).toHaveTextContent(returnTo.pathname);
  });

  it("opens the current service occurrence workspace without a render loop", async () => {
    const serviceId = "service-current-weekly";
    const positionId = "position-vocal";
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [
              {
                ...mockSharedServices[0],
                id: serviceId,
                name: "Weekly service",
                reccurence: "weekly",
                dayOfWeek: new Date().getDay(),
                time: "10:00",
                positionRequirements: [{ positionId, count: 1 }],
              },
            ],
          },
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...baseBootstrap,
        positions: [
          {
            positionId,
            churchId: "church-1",
            teamId: "team-main",
            name: "Vocal",
            icon: "mic",
          },
        ],
      }),
    );
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => { });

    try {
      renderTeams();

      expect(
        await screen.findByRole(
          "group",
          { name: "Team schedule identity" },
          { timeout: 8_000 },
        ),
      ).toBeInTheDocument();
      expect(
        consoleError.mock.calls
          .flat()
          .some((value) => String(value).includes("Maximum update depth exceeded")),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps a future period virtual until the first assignment and then uses the persisted id", async () => {
    const user = userEvent.setup();
    const serviceId = "service-next-period";
    const positionId = "position-vocal";
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [{
              ...mockSharedServices[0],
              id: serviceId,
              serviceId,
              name: "Saturday service",
              reccurence: "weekly",
              dayOfWeek: 6,
              time: "10:00",
              positionRequirements: [{ positionId, count: 1 }],
            }],
          },
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...baseBootstrap,
      positions: [{ positionId, churchId: "church-1", teamId: "team-main", name: "Vocal", icon: "mic" }],
      members: [{
        memberId: "member-morgan", churchId: "church-1", firstName: "Morgan", lastName: "Lee",
        positionIds: [positionId], blockoutDates: [], notes: "",
      }],
      teams: [{ ...baseBootstrap.teams[0], memberIds: ["member-morgan"] }],
      schedules: [],
    }));
    let ensuredSchedule: TeamSchedule | null = null;
    mockEnsureTeamScheduleForPeriod.mockImplementation(async (_churchId, body) => {
      ensuredSchedule = {
        scheduleId: `generated-period-${body.startDate}`,
        churchId: "church-1",
        name: body.name,
        teamId: body.teamId,
        startDate: body.startDate,
        endDate: body.endDate,
        serviceIds: body.serviceIds,
        occurrences: body.occurrences,
        source: "generated-period",
        generatedPeriodKey: "period-key",
        assignments: {},
      };
      return { success: true, created: true, schedule: ensuredSchedule };
    });
    const firstFuturePeriod = shiftRange("upcoming", calendarMonthRange(new Date()), 1);
    const secondFuturePeriod = shiftRange("upcoming", firstFuturePeriod, 1);
    mockUpdateTeamScheduleAssignment.mockImplementation(async (_churchId, scheduleId, body) => ({
      success: true,
      schedule: {
        scheduleId,
        churchId: "church-1",
        name: "Future period",
        teamId: "team-main",
        startDate: firstFuturePeriod.start,
        endDate: firstFuturePeriod.end,
        serviceIds: [serviceId],
        occurrences: [{
          occurrenceId: body.serviceId,
          serviceId,
          name: "Saturday service",
          startsAt: `${firstFuturePeriod.start}T10:00:00.000Z`,
          positionRequirements: [{ positionId, count: 1 }],
        }],
        assignments: { [body.serviceId]: { [body.positionSlotKey]: body.memberId ? { primaryMemberId: body.memberId } : {} } },
      },
    }));

    renderTeams();
    await waitForTeamsBootstrap();
    await user.click(screen.getByRole("button", { name: "Date range" }));
    expect(screen.getByRole("button", { name: "Upcoming" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upcoming" }));
    await user.click(screen.getByRole("button", { name: "Next period" }));
    expect(await screen.findByRole("group", { name: "Team schedule identity" })).toBeInTheDocument();
    expect(mockEnsureTeamScheduleForPeriod).not.toHaveBeenCalled();
    const cell = (await screen.findAllByRole("button", { name: /Vocal, Empty/i }))[0];
    expect(cell).toBeDefined();
    await user.click(cell);
    await screen.findByRole("combobox", { name: /Vocal/i });
    await user.click(await screen.findByRole("button", { name: /Assign Morgan/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(1);
    });
    expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(1);
    expect(mockEnsureTeamScheduleForPeriod.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateTeamScheduleAssignment.mock.invocationCallOrder[0],
    );
    expect(mockUpdateTeamScheduleAssignment.mock.calls[0][1]).toBe(
      `generated-period-${firstFuturePeriod.start}`,
    );

    mockAddTeamSchedulePositionSlot.mockImplementation(async (_churchId, _scheduleId, body) => ({
      success: true,
      schedule: {
        ...ensuredSchedule!,
        additionalPositionSlots: {
          ...(ensuredSchedule?.additionalPositionSlots || {}),
          [body.serviceId]: [body.positionSlotKey],
        },
      },
    }));
    await user.click(screen.getByRole("button", { name: "Next period" }));
    const addPositionButtons = await screen.findAllByRole("button", { name: "Add position" });
    await user.click(addPositionButtons[0]);
    await user.click(await screen.findByRole("menuitem", { name: /Add Vocal 2/i }));
    await waitFor(() => expect(mockAddTeamSchedulePositionSlot).toHaveBeenCalledTimes(1));
    // Adding a position slot must not create another assignment write. The
    // first assignment above already persisted once for the previous period.
    expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(1);
    expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(2);
    expect(mockEnsureTeamScheduleForPeriod.mock.invocationCallOrder[1]).toBeLessThan(
      mockAddTeamSchedulePositionSlot.mock.invocationCallOrder[0],
    );
    expect(mockAddTeamSchedulePositionSlot.mock.calls[0][1]).toBe(
      `generated-period-${secondFuturePeriod.start}`,
    );
  });

  it("drops a pending virtual-period assignment after the operator changes periods", async () => {
    const user = userEvent.setup();
    const serviceId = "service-next-period";
    const positionId = "position-vocal";
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [{
              ...mockSharedServices[0],
              id: serviceId,
              serviceId,
              name: "Saturday service",
              reccurence: "weekly",
              dayOfWeek: 6,
              time: "10:00",
              positionRequirements: [{ positionId, count: 1 }],
            }],
          },
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...baseBootstrap,
      positions: [{ positionId, churchId: "church-1", teamId: "team-main", name: "Vocal", icon: "mic" }],
      members: [{
        memberId: "member-morgan", churchId: "church-1", firstName: "Morgan", lastName: "Lee",
        positionIds: [positionId], blockoutDates: [], notes: "",
      }],
      teams: [{ ...baseBootstrap.teams[0], memberIds: ["member-morgan"] }],
      schedules: [],
    }));

    const firstFuturePeriod = shiftRange("upcoming", calendarMonthRange(new Date()), 1);
    const secondFuturePeriod = shiftRange("upcoming", firstFuturePeriod, 1);
    const makeEnsuredSchedule = (
      body: Parameters<typeof ensureTeamScheduleForPeriod>[1],
    ): TeamSchedule => ({
      scheduleId: `generated-period-${body.startDate}`,
      churchId: "church-1",
      name: body.name,
      teamId: body.teamId,
      startDate: body.startDate,
      endDate: body.endDate,
      serviceIds: body.serviceIds,
      occurrences: body.occurrences,
      source: "generated-period",
      generatedPeriodKey: "period-key",
      assignments: {},
    });
    let resolveFirstEnsure: ((
      value: Awaited<ReturnType<typeof ensureTeamScheduleForPeriod>>,
    ) => void) | null = null;
    mockEnsureTeamScheduleForPeriod.mockImplementation(async (_churchId, body) => {
      const schedule = makeEnsuredSchedule(body);
      if (!resolveFirstEnsure) {
        return new Promise((resolve) => {
          resolveFirstEnsure = resolve;
        });
      }
      return { success: true, created: true, schedule };
    });
    mockAddTeamSchedulePositionSlot.mockImplementation(async (_churchId, scheduleId, body) => ({
      success: true,
      schedule: {
        ...makeEnsuredSchedule({
          name: "Next period",
          teamId: "team-main",
          startDate: secondFuturePeriod.start,
          endDate: secondFuturePeriod.end,
          serviceIds: [serviceId],
          occurrences: [],
          timeZone: "UTC",
        }),
        scheduleId,
        additionalPositionSlots: { [body.serviceId]: [body.positionSlotKey] },
      },
    }));

    renderTeams();
    await waitForTeamsBootstrap();
    await user.click(screen.getByRole("button", { name: "Date range" }));
    await user.click(screen.getByRole("button", { name: "Upcoming" }));
    await user.click(screen.getByRole("button", { name: "Next period" }));
    const cell = (await screen.findAllByRole("button", { name: /Vocal, Empty/i }))[0];
    await user.click(cell);
    await screen.findByRole("combobox", { name: /Vocal/i });
    await user.click(await screen.findByRole("button", { name: /Assign Morgan/i }));
    await waitFor(() => expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Next period" }));
    const nextPeriodCell = await screen.findByRole("group", { name: "Team schedule identity" });
    expect(nextPeriodCell).toBeInTheDocument();

    await act(async () => {
      resolveFirstEnsure?.({
        success: true,
        created: true,
        schedule: makeEnsuredSchedule(mockEnsureTeamScheduleForPeriod.mock.calls[0][1]),
      });
    });
    expect(mockUpdateTeamScheduleAssignment).not.toHaveBeenCalled();

    const addPositionButtons = await screen.findAllByRole("button", { name: "Add position" });
    await user.click(addPositionButtons[0]);
    await user.click(await screen.findByRole("menuitem", { name: /Add Vocal 2/i }));
    await waitFor(() => expect(mockAddTeamSchedulePositionSlot).toHaveBeenCalledTimes(1));
    expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(2);
    expect(mockEnsureTeamScheduleForPeriod.mock.calls[1][1].startDate).toBe(secondFuturePeriod.start);
    expect(mockAddTeamSchedulePositionSlot.mock.calls[0][1]).toBe(
      `generated-period-${secondFuturePeriod.start}`,
    );
  });

  it("defaults Schedules to Upcoming and ignores legacy saved range values", async () => {
    const user = userEvent.setup();
    window.matchMedia = makeMatchMedia(true);
    localStorage.setItem("worshipSync:teamsRange:schedules:church-1", JSON.stringify({ preset: "thisQuarter" }));
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    const view = renderTeams();
    await waitForTeamsBootstrap();
    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "This quarter" }));
    view.unmount();

    renderTeams();
    await waitForTeamsBootstrap();
    expect(screen.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps an October 3 assignment visible after reopening Upcoming on September 30", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date(2026, 8, 29, 12));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const serviceId = "service-october-sabbath";
    const positionId = "position-vocal";
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [{
              ...mockSharedServices[0],
              id: serviceId,
              serviceId,
              name: "Saturday service",
              reccurence: "weekly",
              dayOfWeek: 6,
              time: "10:00",
              positionRequirements: [{ positionId, count: 1 }],
            }],
          },
        },
      },
    };
    const bootstrap = {
      ...baseBootstrap,
      positions: [{ positionId, churchId: "church-1", teamId: "team-main", name: "Vocal", icon: "mic" }],
      members: [{
        memberId: "member-morgan", churchId: "church-1", firstName: "Morgan", lastName: "Lee",
        positionIds: [positionId], blockoutDates: [], notes: "",
      }],
      teams: [{ ...baseBootstrap.teams[0], memberIds: ["member-morgan"] }],
      schedules: [] as TeamSchedule[],
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse(bootstrap));
    let persistedSchedule: TeamSchedule | null = null;
    mockEnsureTeamScheduleForPeriod.mockImplementation(async (_churchId, body) => {
      persistedSchedule = {
        scheduleId: "generated_october-continuity",
        churchId: "church-1",
        name: body.name,
        teamId: body.teamId,
        startDate: body.startDate,
        endDate: body.endDate,
        serviceIds: body.serviceIds,
        occurrences: body.occurrences,
        source: "generated-period",
        generatedPeriodKey: "october-continuity",
        assignments: {},
      };
      return { success: true, created: true, schedule: persistedSchedule };
    });
    mockUpdateTeamScheduleAssignment.mockImplementation(async (_churchId, scheduleId, body) => {
      persistedSchedule = {
        ...persistedSchedule!,
        scheduleId,
        assignments: {
          ...persistedSchedule!.assignments,
          [body.serviceId]: {
            [body.positionSlotKey]: { primaryMemberId: body.memberId || "" },
          },
        },
      };
      return { success: true, schedule: persistedSchedule };
    });

    const { unmount } = renderTeams();
    await waitForTeamsBootstrap();
    const [slot] = await screen.findAllByRole("button", { name: /Saturday service Vocal, Empty/i });
    expect(slot).toBeDefined();
    await user.click(slot);
    await screen.findByRole("combobox", { name: /Saturday service Vocal/i });
    await user.click(await screen.findByRole("button", { name: /Assign Morgan/i }));
    await waitFor(() => expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(1));

    expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(1);
    expect(mockEnsureTeamScheduleForPeriod.mock.calls[0][1]).toMatchObject({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      visibleOccurrenceIds: expect.arrayContaining([expect.stringContaining("2026-10-03")]),
    });
    unmount();

    jest.setSystemTime(new Date(2026, 8, 30, 12));
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...bootstrap,
      schedules: [persistedSchedule!],
    }));
    renderTeams();

    expect(await screen.findByRole("button", { name: /Saturday service Vocal, Morgan/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sep 29/i })).not.toBeInTheDocument();
    expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(1);
  });

  it("opens Media's saved five-occurrence October schedule when Setup now generates seven", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    const serviceId = "sabbath-service";
    const cameraId = "position-camera";
    const memberId = "member-media";
    const savedOccurrences = [3, 10, 17, 24, 31].map((day) => {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      return {
        occurrenceId: `${serviceId}@${date}T10:00:00.000Z`,
        serviceId,
        name: "Sabbath Service",
        startsAt: `${date}T10:00:00.000Z`,
        positionRequirements: [{ positionId: cameraId, count: 1 }],
      };
    });
    mockState = {
      undoable: { present: { serviceTimes: { list: [
        {
          ...mockSharedServices[0], id: serviceId, serviceId, name: "Sabbath Service",
          reccurence: "weekly", dayOfWeek: 6, time: "10:00",
          positionRequirements: [{ positionId: cameraId, count: 1 }],
        },
        ...["media-special-a", "media-special-b"].map((id, index) => ({
          id, serviceId: id, name: `Media Special ${index + 1}`,
          reccurence: "one_time", dateTimeISO: `2026-10-${index ? "18" : "04"}T10:00:00.000Z`,
          positionRequirements: [{ positionId: cameraId, count: 1 }],
        })),
      ] } } },
    };
    const savedSchedule: TeamSchedule = {
      scheduleId: "custom-saved-media-october",
      source: "custom",
      churchId: "church-1",
      name: "October 2026",
      teamId: "team-main",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      serviceIds: [serviceId],
      occurrences: savedOccurrences,
      assignments: {
        [savedOccurrences[0].occurrenceId]: {
          [`${cameraId}::0`]: { primaryMemberId: memberId, shadows: [] },
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...baseBootstrap,
      teams: [{ teamId: "team-main", churchId: "church-1", name: "Media", memberIds: [memberId] }],
      positions: [{ positionId: cameraId, churchId: "church-1", teamId: "team-main", name: "Camera" }],
      members: [{ memberId, churchId: "church-1", firstName: "Morgan", lastName: "Lee", positionIds: [cameraId], blockoutDates: [], notes: "" }],
      schedules: [savedSchedule],
    }));

    renderTeams();
    await waitForTeamsBootstrap();

    expect(await screen.findByRole("button", { name: /Sabbath Service Camera, Morgan/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Camera, (?:Morgan|Empty)/i })).toHaveLength(5);
    expect(screen.getByText("Oct 1, 2026 – Oct 31, 2026")).toBeInTheDocument();
    expect(mockEnsureTeamScheduleForPeriod).not.toHaveBeenCalled();
  });

  it("keeps the saved Praise Team 11 AM Worship Experience schedule across Setup drift", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    const worshipId = "worship-experience";
    const vocalId = "position-vocal";
    const memberId = "member-praise";
    const savedOccurrences = [3, 10, 17, 24, 31].map((day) => {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      return {
        occurrenceId: `${worshipId}@${date}T11:00:00.000Z`,
        serviceId: worshipId,
        name: "Worship Experience",
        startsAt: `${date}T11:00:00.000Z`,
        positionRequirements: [{ positionId: vocalId, count: 1 }],
      };
    });
    mockState = {
      undoable: { present: { serviceTimes: { list: [
        {
          ...mockSharedServices[0], id: "sabbath-school", serviceId: "sabbath-school",
          name: "Sabbath School", serviceGroupId: "sabbath-morning",
          reccurence: "weekly", dayOfWeek: 6, time: "10:00", positionRequirements: [],
        },
        {
          ...mockSharedServices[0], id: worshipId, serviceId: worshipId,
          name: "Worship Experience", serviceGroupId: "sabbath-morning",
          reccurence: "weekly", dayOfWeek: 6, time: "11:00",
          positionRequirements: [{ positionId: vocalId, count: 1 }],
        },
      ] } } },
    };
    const savedSchedule: TeamSchedule = {
      scheduleId: "custom-saved-praise-october",
      source: "custom",
      churchId: "church-1",
      name: "October 2026",
      teamId: "team-main",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      serviceIds: [worshipId],
      occurrences: savedOccurrences,
      assignments: {
        [savedOccurrences[0].occurrenceId]: {
          [`${vocalId}::0`]: { primaryMemberId: memberId, shadows: [] },
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...baseBootstrap,
      teams: [{ teamId: "team-main", churchId: "church-1", name: "Praise Team", memberIds: [memberId] }],
      positions: [{ positionId: vocalId, churchId: "church-1", teamId: "team-main", name: "Vocal" }],
      members: [{ memberId, churchId: "church-1", firstName: "Morgan", lastName: "Lee", positionIds: [vocalId], blockoutDates: [], notes: "" }],
      schedules: [savedSchedule],
    }));

    renderTeams();
    await waitForTeamsBootstrap();

    expect(await screen.findByRole("button", { name: /Worship Experience Vocal, Morgan/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Vocal, (?:Morgan|Empty)/i })).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Sabbath School & Worship Experience/i })).not.toBeInTheDocument();
    expect(mockEnsureTeamScheduleForPeriod).not.toHaveBeenCalled();
  });

  it("creates a new period from only the team's relevant grouped services", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const worshipId = "worship-experience";
    const vocalId = "position-vocal";
    const memberId = "member-praise";
    mockState = {
      undoable: { present: { serviceTimes: { list: [
        {
          ...mockSharedServices[0], id: "sabbath-school", serviceId: "sabbath-school",
          name: "Sabbath School", serviceGroupId: "sabbath-morning",
          reccurence: "weekly", dayOfWeek: 6, time: "10:00", positionRequirements: [],
        },
        {
          ...mockSharedServices[0], id: worshipId, serviceId: worshipId,
          name: "Worship Experience", serviceGroupId: "sabbath-morning",
          reccurence: "weekly", dayOfWeek: 6, time: "11:00",
          positionRequirements: [{ positionId: vocalId, count: 1 }],
        },
      ] } } },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...baseBootstrap,
      teams: [{ teamId: "team-main", churchId: "church-1", name: "Praise Team", memberIds: [memberId] }],
      positions: [{ positionId: vocalId, churchId: "church-1", teamId: "team-main", name: "Vocal" }],
      members: [{ memberId, churchId: "church-1", firstName: "Morgan", lastName: "Lee", positionIds: [vocalId], blockoutDates: [], notes: "" }],
      schedules: [],
    }));
    let generatedSchedule: TeamSchedule | null = null;
    mockEnsureTeamScheduleForPeriod.mockImplementation(async (_churchId, body) => {
      generatedSchedule = {
        scheduleId: "generated_new-praise-period",
        generatedPeriodKey: "new-praise-period",
        source: "generated-period",
        churchId: "church-1",
        name: body.name,
        teamId: body.teamId,
        startDate: body.startDate,
        endDate: body.endDate,
        serviceIds: body.serviceIds,
        occurrences: body.occurrences,
        assignments: {},
      };
      return { success: true, created: true, schedule: generatedSchedule };
    });
    mockUpdateTeamScheduleAssignment.mockImplementation(async (_churchId, scheduleId, body) => {
      generatedSchedule = {
        ...generatedSchedule!,
        scheduleId,
        assignments: {
          [body.serviceId]: {
            [body.positionSlotKey]: { primaryMemberId: body.memberId || "", shadows: [] },
          },
        },
      };
      return { success: true, schedule: generatedSchedule };
    });

    renderTeams();
    await waitForTeamsBootstrap();
    const emptyCells = await screen.findAllByRole("button", { name: /Worship Experience Vocal, Empty/i });
    expect(emptyCells).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Sabbath School & Worship Experience/i })).not.toBeInTheDocument();
    await user.click(emptyCells[0]);
    await screen.findByRole("combobox", { name: /Worship Experience Vocal/i });
    await user.click(await screen.findByRole("button", { name: /Assign Morgan/i }));

    await waitFor(() => expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(1));
    expect(mockEnsureTeamScheduleForPeriod).toHaveBeenCalledTimes(1);
    const ensureBody = mockEnsureTeamScheduleForPeriod.mock.calls[0]?.[1];
    if (!ensureBody) throw new Error("The new schedule period was not requested.");
    expect(ensureBody.serviceIds).toEqual([worshipId]);
    const generatedOccurrences = ensureBody.occurrences;
    if (!generatedOccurrences) throw new Error("The schedule period had no generated occurrences.");
    expect(generatedOccurrences).toHaveLength(5);
    expect(generatedOccurrences.every((occurrence) =>
      occurrence.name === "Worship Experience" && new Date(occurrence.startsAt).getHours() === 11,
    )).toBe(true);
  });

  it("assigns a microphone from the selected team's schedule", async () => {
    const user = userEvent.setup();
    const microphoneSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      microphoneAssignments: {},
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        teams: scheduleBootstrap.teams.map((team) => ({
          ...team,
          usesMicrophoneAssignments: true,
        })),
        schedules: [microphoneSchedule],
      }),
    );
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [
        { id: "mic-lead", name: "Lead vocal", type: "Handheld", color: "#22d3ee" },
      ],
      audiences: [],
    });
    mockUpdateTeamScheduleAssignmentMicrophones.mockResolvedValue({
      success: true,
      schedule: {
        ...microphoneSchedule,
        microphoneAssignments: {
          [sundayOccurrenceId]: { "position-keys::0": ["mic-lead"] },
        },
      },
    } satisfies UpdateTeamScheduleAssignmentMicrophonesResponse);

    renderTeams();
    await waitForScheduleGrid();

    const microphoneSelect = await screen.findByRole("combobox", {
      name: /Microphone for Avery \(Keys\)/i,
    });
    await user.click(microphoneSelect);
    await user.click(await screen.findByRole("option", { name: /Lead vocal/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentMicrophones).toHaveBeenCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-keys::0",
          microphoneIds: ["mic-lead"],
        },
      );
    });
  });

  it("queues microphone assignment after a newly added schedule slot is saved", async () => {
    const user = userEvent.setup();
    const microphoneSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      microphoneAssignments: {},
    };
    const addedSchedule = {
      ...microphoneSchedule,
      additionalPositionSlots: { [sundayOccurrenceId]: ["position-vocal::1"] },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...scheduleBootstrap,
      teams: scheduleBootstrap.teams.map((team) => ({ ...team, usesMicrophoneAssignments: true })),
      schedules: [microphoneSchedule],
    }));
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [{ id: "mic-lead", name: "Lead vocal", type: "Handheld", color: "#22d3ee" }],
      audiences: [],
    });
    let resolveAddSlot!: (value: Awaited<ReturnType<typeof addTeamSchedulePositionSlot>>) => void;
    mockAddTeamSchedulePositionSlot.mockImplementationOnce(() => new Promise((resolve) => { resolveAddSlot = resolve; }));
    mockUpdateTeamScheduleAssignmentMicrophones.mockResolvedValue({
      success: true,
      schedule: { ...addedSchedule, microphoneAssignments: { [sundayOccurrenceId]: { "position-vocal::1": ["mic-lead"] } } },
    } satisfies UpdateTeamScheduleAssignmentMicrophonesResponse);

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /Add position/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Add Vocal 2/i }));
    await waitFor(() => expect(mockAddTeamSchedulePositionSlot).toHaveBeenCalledTimes(1));

    const microphoneSelect = await screen.findByRole("combobox", { name: /Microphone for Empty \(Vocal 2\)/i });
    await user.click(microphoneSelect);
    await user.click(await screen.findByRole("option", { name: /Lead vocal/i }));
    expect(mockUpdateTeamScheduleAssignmentMicrophones).not.toHaveBeenCalled();

    await act(async () => resolveAddSlot({ success: true, schedule: addedSchedule }));
    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentMicrophones).toHaveBeenCalledWith(
      "church-1",
      "schedule-july",
      { serviceId: sundayOccurrenceId, positionSlotKey: "position-vocal::1", microphoneIds: ["mic-lead"] },
    ));
  });

  it("queues IEM assignment after a newly added schedule slot is saved", async () => {
    const user = userEvent.setup();
    const iemSchedule: TeamSchedule = { ...scheduleBootstrap.schedules[0], iemAssignments: {} };
    const addedSchedule = {
      ...iemSchedule,
      additionalPositionSlots: { [sundayOccurrenceId]: ["position-vocal::1"] },
    };
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse({
      ...scheduleBootstrap,
      teams: scheduleBootstrap.teams.map((team) => ({ ...team, usesIemAssignments: true })),
      schedules: [iemSchedule],
    }));
    mockGetServiceEquipment.mockResolvedValue({
      success: true,
      equipment: [{ id: "iem-pack", category: "iem", name: "Stage pack", subtype: "wireless-beltpack" }],
    });
    let resolveAddSlot!: (value: Awaited<ReturnType<typeof addTeamSchedulePositionSlot>>) => void;
    mockAddTeamSchedulePositionSlot.mockImplementationOnce(() => new Promise((resolve) => { resolveAddSlot = resolve; }));
    mockUpdateTeamScheduleAssignmentIems.mockResolvedValue({
      success: true,
      schedule: { ...addedSchedule, iemAssignments: { [sundayOccurrenceId]: { "position-vocal::1": ["iem-pack"] } } },
    } satisfies UpdateTeamScheduleAssignmentIemsResponse);

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /Add position/i }));
    await user.click(await screen.findByRole("menuitem", { name: /Add Vocal 2/i }));
    await waitFor(() => expect(mockAddTeamSchedulePositionSlot).toHaveBeenCalledTimes(1));

    const iemSelect = await screen.findByRole("combobox", { name: /Microphone for Empty \(Vocal 2\) IEM/i });
    await user.click(iemSelect);
    await user.click(await screen.findByRole("option", { name: /Stage pack/i }));
    expect(mockUpdateTeamScheduleAssignmentIems).not.toHaveBeenCalled();

    await act(async () => resolveAddSlot({ success: true, schedule: addedSchedule }));
    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentIems).toHaveBeenCalledWith(
      "church-1",
      "schedule-july",
      { serviceId: sundayOccurrenceId, positionSlotKey: "position-vocal::1", iemIds: ["iem-pack"] },
    ));
  });

  it("keeps a newer microphone choice when an earlier save responds", async () => {
    const user = userEvent.setup();
    const microphoneSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      microphoneAssignments: {
        [sundayOccurrenceId]: {
          "position-vocal::0": ["mic-vocal"],
          "position-keys::0": ["mic-keys"],
        },
      },
    };
    const afterKeysCleared: TeamSchedule = {
      ...microphoneSchedule,
      microphoneAssignments: {
        [sundayOccurrenceId]: {
          "position-vocal::0": ["mic-vocal"],
        },
      },
    };
    const afterVocalChanged: TeamSchedule = {
      ...afterKeysCleared,
      microphoneAssignments: {
        [sundayOccurrenceId]: {
          "position-vocal::0": ["mic-lead"],
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        teams: scheduleBootstrap.teams.map((team) => ({
          ...team,
          usesMicrophoneAssignments: true,
        })),
        schedules: [microphoneSchedule],
      }),
    );
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [
        { id: "mic-vocal", name: "Vocal mic", type: "Handheld", color: "#22d3ee" },
        { id: "mic-keys", name: "Keys mic", type: "Handheld", color: "#f59e0b" },
        { id: "mic-lead", name: "Lead vocal", type: "Lapel", color: "#a855f7" },
      ],
      audiences: [],
    });
    let resolveFirstSave: (value: UpdateTeamScheduleAssignmentMicrophonesResponse) => void =
      () => undefined;
    let resolveSecondSave: (value: UpdateTeamScheduleAssignmentMicrophonesResponse) => void =
      () => undefined;
    mockUpdateTeamScheduleAssignmentMicrophones
      .mockImplementationOnce(
        () =>
          new Promise<UpdateTeamScheduleAssignmentMicrophonesResponse>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<UpdateTeamScheduleAssignmentMicrophonesResponse>((resolve) => {
            resolveSecondSave = resolve;
          }),
      );

    renderTeams();
    await waitForScheduleGrid();

    const keysMicrophone = await screen.findByRole("combobox", {
      name: /Microphone for Avery \(Keys\)/i,
    });
    await user.click(keysMicrophone);
    await user.click(await screen.findByRole("option", { name: /^No microphone$/i }));
    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentMicrophones).toHaveBeenCalledTimes(1);
    });

    const vocalMicrophone = await screen.findByRole("combobox", {
      name: /Microphone for Empty \(Vocal\)/i,
    });
    await user.click(vocalMicrophone);
    await user.click(await screen.findByRole("option", { name: /^Lead vocal$/i }));

    await act(async () => {
      resolveFirstSave({ success: true, schedule: afterKeysCleared });
    });
    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentMicrophones).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByRole("combobox", {
        name: /Microphone for Empty \(Vocal\)/i,
      }),
    ).toHaveTextContent("Lead vocal");

    await act(async () => {
      resolveSecondSave({ success: true, schedule: afterVocalChanged });
    });
  });

  it("keeps a cleared microphone cleared after a bootstrap summary refresh", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const microphoneSchedule: TeamSchedule = {
        ...scheduleBootstrap.schedules[0],
        microphoneAssignments: {
          [sundayOccurrenceId]: {
            "position-keys::0": ["mic-lead"],
          },
        },
      };
      const afterCleared: TeamSchedule = {
        ...microphoneSchedule,
        microphoneAssignments: {},
      };
      const {
        assignments: _assignments,
        microphoneAssignments: _mics,
        additionalPositionSlots: _slots,
        ...summaryBase
      } = afterCleared;
      const summaryRefresh = {
        ...scheduleBootstrap,
        teams: scheduleBootstrap.teams.map((team) => ({
          ...team,
          usesMicrophoneAssignments: true,
        })),
        schedules: [
          {
            ...summaryBase,
            assignmentsOmitted: true,
          },
        ],
      };
      mockGetTeamsBootstrap.mockResolvedValue(
        asTeamsBootstrapResponse({
          ...scheduleBootstrap,
          teams: scheduleBootstrap.teams.map((team) => ({
            ...team,
            usesMicrophoneAssignments: true,
          })),
          schedules: [microphoneSchedule],
        }),
      );
      mockGetServicePlanMicrophones.mockResolvedValue({
        success: true,
        microphones: [
          {
            id: "mic-lead",
            name: "Lead vocal",
            type: "Handheld",
            color: "#22d3ee",
          },
        ],
        audiences: [],
      });
      mockUpdateTeamScheduleAssignmentMicrophones.mockResolvedValue({
        success: true,
        schedule: afterCleared,
      } satisfies UpdateTeamScheduleAssignmentMicrophonesResponse);

      renderTeams();
      await waitForScheduleGrid();

      const microphoneSelect = await screen.findByRole("combobox", {
        name: /Microphone for Avery \(Keys\)/i,
      });
      await user.click(microphoneSelect);
      await user.click(
        await screen.findByRole("option", { name: /^No microphone$/i }),
      );

      await waitFor(() => {
        expect(mockUpdateTeamScheduleAssignmentMicrophones).toHaveBeenCalledWith(
          "church-1",
          "schedule-july",
          {
            serviceId: sundayOccurrenceId,
            positionSlotKey: "position-keys::0",
            microphoneIds: [],
          },
        );
      });
      await waitFor(() => {
        expect(
          screen.getByRole("combobox", {
            name: /Microphone for Avery \(Keys\)/i,
          }),
        ).toHaveTextContent("No microphone");
      });

      // A stale-on-focus bootstrap often returns this schedule as a summary (maps omitted).
      // Retained hydration must reuse the cleared maps from the local save — not
      // the pre-clear snapshot that was retained when the grid first opened.
      mockGetTeamsBootstrap.mockResolvedValue(
        asTeamsBootstrapResponse(summaryRefresh as unknown as TestTeamsBootstrap),
      );
      await act(async () => {
        jest.advanceTimersByTime(5 * 60 * 1000 + 3500);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => {
        expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
      });
      expect(
        screen.getByRole("combobox", {
          name: /Microphone for Avery \(Keys\)/i,
        }),
      ).toHaveTextContent("No microphone");
    } finally {
      jest.useRealTimers();
    }
  });

  it("hydrates a schedule explicitly opened from history after its summary arrives", async () => {
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
    mockGetTeamsBootstrap.mockResolvedValue({
      ...scheduleBootstrap,
      schedules: [summary],
    } as TeamsBootstrapResponse);
    mockGetTeamScheduleDetail.mockResolvedValue({
      success: true,
      schedule: hydrated,
      relatedSchedules: [],
    });

    const user = userEvent.setup();
    renderTeams();
    await waitForTeamsBootstrap();
    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    await user.click(screen.getByRole("menuitem", { name: "Schedule history" }));
    const historySchedule = await screen.findByRole("button", { name: /June/i });
    expect(historySchedule).toHaveClass("cursor-pointer");
    await user.click(historySchedule);

    await waitFor(() => {
      expect(mockGetTeamScheduleDetail).toHaveBeenCalledWith("church-1", scheduleId);
    });
    expect(
      await screen.findByRole("button", { name: /Sunday Vocal/i }, { timeout: 8_000 }),
    ).toBeInTheDocument();
  });

  it("saves custom-schedule auto-fill as one targeted assignment batch", async () => {
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
    let resolveSave: (value: UpdateTeamScheduleAssignmentsBatchResponse) => void = () => undefined;
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
    mockUpdateTeamScheduleAssignmentsBatch.mockImplementationOnce(
      () =>
        new Promise<UpdateTeamScheduleAssignmentsBatchResponse>((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateTeamScheduleAssignment).not.toHaveBeenCalled();
    expect(mockUpdateTeamSchedule).not.toHaveBeenCalled();
    expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledWith(
      "church-1",
      "schedule-july",
      expect.objectContaining({
        changes: expect.arrayContaining([
          expect.objectContaining({
            serviceId: sundayOccurrenceId,
            positionSlotKey: "position-vocal::0",
            expectedCell: "",
            assignment: { primaryMemberId: expect.any(String) },
          }),
          expect.objectContaining({
            serviceId: sundayOccurrenceId,
            positionSlotKey: "position-keys::0",
            expectedCell: "",
            assignment: { primaryMemberId: expect.any(String) },
          }),
        ]),
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
        assignments: {
          [sundayOccurrenceId]: Object.fromEntries(
            mockUpdateTeamScheduleAssignmentsBatch.mock.calls[0][2].changes.map(
              (change) => [change.positionSlotKey, change.assignment],
            ),
          ) as NonNullable<TeamSchedule["assignments"]>[string],
        },
      },
      accepted: [
        { serviceId: sundayOccurrenceId, positionSlotKey: "position-vocal::0" },
        { serviceId: sundayOccurrenceId, positionSlotKey: "position-keys::0" },
      ],
      skipped: [],
    });
    await user.click(screen.getByRole("button", { name: /^Stay$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Auto-filled 2 of 2 open slots/i)).toBeInTheDocument();
    });

  });

  it("keeps Auto Fill as one undo and redo assignment operation", async () => {
    const user = userEvent.setup();
    const autoFillSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      assignments: {},
      occurrences: [
        {
          ...scheduleBootstrap.schedules[0].occurrences![0],
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
    let persistedSchedule = autoFillSchedule;
    mockUpdateTeamScheduleAssignmentsBatch.mockImplementation(async (_churchId, _scheduleId, body) => {
      const assignments = { ...(persistedSchedule.assignments || {}) };
      body.changes.forEach((change) => {
        const row = { ...(assignments[change.serviceId] || {}) };
        if (change.assignment) row[change.positionSlotKey] = change.assignment;
        else delete row[change.positionSlotKey];
        if (Object.keys(row).length) assignments[change.serviceId] = row;
        else delete assignments[change.serviceId];
      });
      persistedSchedule = { ...persistedSchedule, assignments };
      return {
        success: true,
        schedule: persistedSchedule,
        accepted: body.changes.map(({ serviceId, positionSlotKey }) => ({ serviceId, positionSlotKey })),
        skipped: [],
      };
    });

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));
    await screen.findByText(/Auto-filled 2 of 2 open slots/i);

    const undoButton = screen.getByRole("button", { name: /Undo auto-fill 2 slots/i });
    await waitFor(() => expect(undoButton).toBeEnabled());
    await user.click(undoButton);
    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(2));
    expect(mockUpdateTeamScheduleAssignmentsBatch.mock.calls[1][2].changes).toHaveLength(2);

    const redoButton = screen.getByRole("button", { name: /Redo auto-fill 2 slots/i });
    await waitFor(() => expect(redoButton).toBeEnabled());
    await user.click(redoButton);
    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(3));
    expect(mockUpdateTeamScheduleAssignmentsBatch.mock.calls[2][2].changes).toHaveLength(2);
  });

  it("auto-fills generated schedules without changing hidden occurrence identity or assignments", async () => {
    const user = userEvent.setup();
    const hiddenOccurrenceId = "service-hidden@2026-07-12T10:00:00.000Z";
    const hiddenAssignments = {
      [hiddenOccurrenceId]: {
        "position-vocal::0": { primaryMemberId: "member-avery" },
      },
    };
    const generatedSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      scheduleId: "generated_0123456789abcdef",
      source: "generated-period",
      generatedPeriodKey: "july-2026-key",
      assignments: hiddenAssignments,
      occurrences: [
        {
          ...scheduleBootstrap.schedules[0].occurrences![0],
          positionRequirements: [
            { positionId: "position-vocal", count: 1 },
            { positionId: "position-keys", count: 1 },
          ],
        },
        {
          occurrenceId: hiddenOccurrenceId,
          serviceId: "service-hidden",
          name: "Hidden service",
          startsAt: "2026-07-12T10:00:00.000Z",
          // This persisted service has no position on the selected team, so it
          // has no assignment cells in the Auto Fill plan.
          positionRequirements: [{ positionId: "position-hidden", count: 1 }],
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
        schedules: [generatedSchedule],
      }),
    );
    mockUpdateTeamScheduleAssignmentsBatch.mockImplementationOnce(async (_churchId, _scheduleId, body) => {
      const assignments = { ...generatedSchedule.assignments };
      body.changes.forEach((change) => {
        assignments[change.serviceId] = {
          ...(assignments[change.serviceId] || {}),
          ...(change.assignment
            ? { [change.positionSlotKey]: change.assignment }
            : {}),
        };
      });
      return {
        success: true,
        schedule: {
          ...generatedSchedule,
          assignments: assignments as NonNullable<TeamSchedule["assignments"]>,
        },
        accepted: body.changes.map(({ serviceId, positionSlotKey }) => ({ serviceId, positionSlotKey })),
        skipped: [],
      };
    });

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Auto-filled 2 of 2 open slots/i)).toBeInTheDocument();
    const [, scheduleId, body] = mockUpdateTeamScheduleAssignmentsBatch.mock.calls[0];
    expect(scheduleId).toBe("generated_0123456789abcdef");
    expect(body.changes).toHaveLength(2);
    expect(body.changes.every((change) => change.serviceId === sundayOccurrenceId)).toBe(true);
    expect(body).not.toHaveProperty("occurrences");
    expect(body).not.toHaveProperty("assignments");
    expect(mockUpdateTeamSchedule).not.toHaveBeenCalled();
    expect(mockUpdateTeamScheduleAssignment).not.toHaveBeenCalled();
  });

  it("retries Auto Fill after cross-team conflict confirmation with the server fingerprint", async () => {
    const user = userEvent.setup();
    const autoFillSchedule: TeamSchedule = {
      ...scheduleBootstrap.schedules[0],
      assignments: {},
      occurrences: [
        {
          ...scheduleBootstrap.schedules[0].occurrences![0],
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
    mockUpdateTeamScheduleAssignmentsBatch.mockRejectedValueOnce(
      Object.assign(new Error("Schedule conflict"), {
        status: 409,
        details: {
          conflictFingerprint: "auto-fill-conflict-v1",
          occurrenceConflicts: [{
            memberId: "member-avery",
            scheduleId: "other-schedule",
            scheduleName: "Production",
            teamId: "team-production",
            occurrenceId: sundayOccurrenceId,
            conflictingOccurrenceId: sundayOccurrenceId,
            cellKeys: ["position-camera::0"],
          }],
        },
      }),
    );

    renderTeams();
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /More schedule actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /^Auto-fill$/i }));
    await user.click(await screen.findByRole("button", { name: /^Continue$/i }));

    expect(
      await screen.findByRole("heading", { name: /Schedule conflict/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Schedule anyway/i }));
    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(2);
    });
    expect(mockUpdateTeamScheduleAssignmentsBatch.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        confirmedOccurrenceConflictFingerprint: "auto-fill-conflict-v1",
      }),
    );
    expect(await screen.findByText(/Auto-filled 2 of 2 open slots/i)).toBeInTheDocument();
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
    mockUpdateTeamScheduleAssignmentsBatch.mockImplementationOnce(
      () =>
        new Promise<UpdateTeamScheduleAssignmentsBatchResponse>((_resolve, reject) => {
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
          ...scheduleBootstrap.schedules[0].occurrences![0],
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

    await openTeamsNavigationIfNeeded(user);

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

    await openTeamsNavigationIfNeeded(user);
    const membersLink = screen.getByRole("link", { name: /^Members$/i });
    await user.click(membersLink);
    await waitFor(() => {
      expect(membersLink).toHaveAttribute("aria-current", "page");
    }, { timeout: 8_000 });
    expect(
      (await screen.findAllByRole("button", { name: /Create member/i }, { timeout: 8_000 }))[0],
    ).toBeInTheDocument();

    await openTeamsNavigationIfNeeded(user);
    const positionsLink = screen.getByRole("link", { name: /^Positions$/i });
    await user.click(positionsLink);
    await waitFor(() => {
      expect(positionsLink).toHaveAttribute("aria-current", "page");
    }, { timeout: 8_000 });
    expect(
      (await screen.findAllByRole("button", { name: /Create position/i }, { timeout: 8_000 }))[0],
    ).toBeInTheDocument();

    await openTeamsNavigationIfNeeded(user);
    const teamsLink = screen.getByRole("link", { name: /^Teams$/i });
    await user.click(teamsLink);
    await waitFor(() => {
      expect(teamsLink).toHaveAttribute("aria-current", "page");
    }, { timeout: 8_000 });
    expect(
      (await screen.findAllByRole("button", { name: /Create team/i }, { timeout: 8_000 }))[0],
    ).toBeInTheDocument();

    await openTeamsNavigationIfNeeded(user);
    const schedulesLink = screen.getByRole("link", { name: /^Schedules$/i });
    await user.click(schedulesLink);
    await waitFor(() => {
      expect(schedulesLink).toHaveAttribute("aria-current", "page");
    }, { timeout: 8_000 });
    expect(
      await screen.findByRole("heading", { name: /^Schedules$/i }, { timeout: 8_000 }),
    ).toBeInTheDocument();
  });

  it("contains a crash inside the active Teams section", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    renderTeams("/teams-and-services/forms");

    expect(
      await screen.findByRole("heading", { name: /Teams and Services/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /This section could not load/i,
    );
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it("creates a position with a Tabler icon and its selected color", async () => {
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
    await screen.findAllByRole("button", { name: /Create position/i });

    // Create form is gated: it is rendered but inert until "Create position" is clicked.
    const createRolePanel = screen.getByRole("region", {
      name: /Create position/i,
      hidden: true,
    });
    expect(createRolePanel).toHaveAttribute("inert");
    await user.click(screen.getAllByRole("button", { name: /Create position/i })[0]);
    expect(createRolePanel).not.toHaveAttribute("inert");

    await user.type(screen.getByLabelText(/^Name/i), "Vocal");
    await user.click(screen.getByRole("button", { name: /Icon picker/i }));
    await user.click(screen.getByRole("tab", { name: /^All icons$/i }));
    await user.type(screen.getByPlaceholderText("Search icons…"), "video");
    const videoButtons = await screen.findAllByRole("button", { name: "Video" });
    await user.click(videoButtons[videoButtons.length - 1]);
    await user.click(screen.getByRole("button", { name: "Choose custom icon color" }));
    await user.click(screen.getByRole("button", { name: "Color #22C55E" }));
    await user.click(screen.getAllByRole("button", { name: /Create position/i })[1]);

    await waitFor(() => {
      expect(mockCreateTeamPosition).toHaveBeenCalledWith("church-1", {
        name: "Vocal",
        description: "",
        icon: { source: "tabler", name: "video", color: "#22C55E" },
        teamId: "team-main",
      });
    });
  });

  it("sets a default microphone for a mic-enabled position", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        teams: scheduleBootstrap.teams.map((team) => ({
          ...team,
          usesMicrophoneAssignments: true,
        })),
      }),
    );
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [
        { id: "mic-lead", name: "Lead vocal", type: "Handheld", color: "#22d3ee" },
      ],
      audiences: [],
    });
    mockCreateTeamPosition.mockResolvedValue({
      success: true,
      position: {
        positionId: "position-lead",
        churchId: "church-1",
        teamId: "team-main",
        name: "Lead",
        defaultMicrophoneId: "mic-lead",
      },
    } satisfies CreateTeamPositionResponse);

    renderTeams("/teams-and-services/positions");
    await screen.findAllByRole("button", { name: /Create position/i });
    await user.click(screen.getAllByRole("button", { name: /Create position/i })[0]);
    await user.type(screen.getByLabelText(/^Name/i), "Lead");
    await user.click(await screen.findByLabelText(/^Default microphone/i));
    await user.click(await screen.findByRole("option", { name: "Lead vocal" }));
    await user.click(screen.getAllByRole("button", { name: /Create position/i })[1]);

    await waitFor(() => {
      expect(mockCreateTeamPosition).toHaveBeenCalledWith(
        "church-1",
        expect.objectContaining({
          name: "Lead",
          defaultMicrophoneId: "mic-lead",
          teamId: "team-main",
        }),
      );
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

  it("keeps the team editor open after saving on narrow screens", async () => {
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

    await user.type(screen.getByLabelText(/^Name/i), " Updated");
    await user.click(screen.getByRole("button", { name: /Save team/i }));

    await waitFor(() => {
      expect(mockUpdateTeam).toHaveBeenCalled();
    });
    // Saving commits the team and leaves the editor open on every width.
    // Back or Cancel is what returns to the list.
    expect(screen.getByRole("heading", { name: /Edit team/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("shows Close for an unchanged team and Cancel after an edit", async () => {
    const user = userEvent.setup();

    renderTeams("/teams-and-services/groups");
    await user.click(await screen.findByRole("button", { name: /Edit Main Team/i }));

    expect(
      within(screen.getByRole("region", { name: "Edit team" })).getByRole(
        "button",
        { name: "Close" },
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Use microphone assignments/i }));

    expect(
      within(screen.getByRole("region", { name: "Edit team" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    ).toBeInTheDocument();
  });

  it("confirms before leaving a team with unsaved changes", async () => {
    const user = userEvent.setup();

    renderTeams("/teams-and-services/groups");
    await user.click(await screen.findByRole("button", { name: /Edit Main Team/i }));
    await user.type(screen.getByLabelText(/^Name/i), " updated");

    await openTeamsNavigationIfNeeded(user);
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
    const createMemberButtons = await screen.findAllByRole("button", { name: "Create member" });
    expect(createMemberButtons.some((button) => !button.hasAttribute("disabled"))).toBe(true);
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
    await screen.findAllByRole("button", { name: /Create position/i });
    await user.click(screen.getAllByRole("button", { name: /Create position/i })[0]);
    await user.type(screen.getByLabelText(/^Name/i), "Vocal");

    const saveButton = screen.getAllByRole("button", { name: /Create position/i })[1];
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
    await waitFor(() => expect(mockGetNotificationIntents).toHaveBeenCalledTimes(1));

    expect(await screen.findByRole("button", { name: /Assign Morgan/i })).toBeEnabled();
    expect(
      screen.queryByRole("group", { name: /^Recommended$/i }),
    ).not.toBeInTheDocument();
    const averyOption = await screen.findByRole("option", {
      name: /Avery.*Will move from Keys/i,
    });
    expect(averyOption).not.toBeDisabled();

    await user.click(averyOption);
    await user.click(await screen.findByRole("button", { name: /Move anyway/i }));
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
    expect(
      await screen.findByRole("button", { name: /Sunday Vocal, Avery/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Sunday Keys, Empty/i }),
    ).toBeInTheDocument();
  });

  it("keeps an undo entry after conflict cancellation and retries the whole move atomically", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse(scheduleBootstrap));
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: scheduleBootstrap.schedules[0],
    } satisfies UpdateTeamScheduleAssignmentResponse);
    mockUpdateTeamScheduleAssignmentsBatch.mockRejectedValueOnce(
      Object.assign(new Error("Schedule conflict"), {
        status: 409,
        details: {
          conflictFingerprint: "undo-conflict-v1",
          occurrenceConflicts: [{
            memberId: "member-avery",
            scheduleId: "other-schedule",
            scheduleName: "Production",
            teamId: "team-production",
            occurrenceId: sundayOccurrenceId,
            conflictingOccurrenceId: sundayOccurrenceId,
            cellKeys: ["position-camera::0"],
          }],
        },
      }),
    );

    renderTeams();
    await openVocalSlot(user);
    await user.click(await screen.findByRole("option", { name: /Avery.*Will move from Keys/i }));
    await user.click(await screen.findByRole("button", { name: /Move anyway/i }));
    await user.click(await screen.findByRole("button", { name: /Undo move Avery/i }));

    expect(await screen.findByRole("heading", { name: /Schedule conflict/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(await screen.findByRole("button", { name: /Sunday Vocal, Avery/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Sunday Keys, Empty/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Undo move Avery/i }));
    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(2));
    expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenLastCalledWith(
      "church-1",
      "schedule-july",
      expect.objectContaining({ skipChangedCells: true }),
    );
  });

  it("retries a conflicting undo once with the server fingerprint", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse(scheduleBootstrap));
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: scheduleBootstrap.schedules[0],
    } satisfies UpdateTeamScheduleAssignmentResponse);
    mockUpdateTeamScheduleAssignmentsBatch.mockRejectedValueOnce(
      Object.assign(new Error("Schedule conflict"), {
        status: 409,
        details: {
          conflictFingerprint: "undo-confirmed-v1",
          occurrenceConflicts: [{
            memberId: "member-avery",
            scheduleId: "other-schedule",
            scheduleName: "Production",
            teamId: "team-production",
            occurrenceId: sundayOccurrenceId,
            conflictingOccurrenceId: sundayOccurrenceId,
            cellKeys: ["position-camera::0"],
          }],
        },
      }),
    );

    renderTeams();
    await openVocalSlot(user);
    await user.click(await screen.findByRole("option", { name: /Avery/i }));
    await user.click(await screen.findByRole("button", { name: /Move anyway/i }));
    await user.click(await screen.findByRole("button", { name: /Undo move Avery/i }));
    await user.click(await screen.findByRole("button", { name: /Schedule anyway/i }));

    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(2));
    expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenLastCalledWith(
      "church-1",
      "schedule-july",
      expect.objectContaining({
        skipChangedCells: true,
        confirmedOccurrenceConflictFingerprint: "undo-confirmed-v1",
      }),
    );
    expect(screen.queryByRole("heading", { name: /Schedule conflict/i })).not.toBeInTheDocument();
  });

  it("retries a conflicting redo atomically with the server fingerprint", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse(scheduleBootstrap));
    mockUpdateTeamScheduleAssignment.mockResolvedValue({
      success: true,
      schedule: scheduleBootstrap.schedules[0],
    } satisfies UpdateTeamScheduleAssignmentResponse);
    mockUpdateTeamScheduleAssignmentsBatch.mockImplementationOnce(async (_churchId, _scheduleId, body) => ({
      success: true,
      schedule: {
        ...scheduleBootstrap.schedules[0],
        assignments: Object.fromEntries(body.changes.reduce((rows, change) => {
          const row = rows.get(change.serviceId) || {};
          if (change.assignment) row[change.positionSlotKey] = change.assignment;
          else delete row[change.positionSlotKey];
          rows.set(change.serviceId, row);
          return rows;
        }, new Map<string, Record<string, unknown>>())) as TeamSchedule["assignments"],
      },
      accepted: body.changes.map(({ serviceId, positionSlotKey }) => ({ serviceId, positionSlotKey })),
      skipped: [],
    }));
    mockUpdateTeamScheduleAssignmentsBatch.mockRejectedValueOnce(
      Object.assign(new Error("Schedule conflict"), {
        status: 409,
        details: {
          conflictFingerprint: "redo-confirmed-v1",
          occurrenceConflicts: [{
            memberId: "member-avery",
            scheduleId: "other-schedule",
            scheduleName: "Production",
            teamId: "team-production",
            occurrenceId: sundayOccurrenceId,
            conflictingOccurrenceId: sundayOccurrenceId,
            cellKeys: ["position-camera::0"],
          }],
        },
      }),
    );

    renderTeams();
    await openVocalSlot(user);
    await user.click(await screen.findByRole("option", { name: /Avery.*Will move from Keys/i }));
    await user.click(await screen.findByRole("button", { name: /Move anyway/i }));
    await user.click(await screen.findByRole("button", { name: /Undo move Avery/i }));
    await user.click(await screen.findByRole("button", { name: /Redo move Avery/i }));

    expect(await screen.findByRole("heading", { name: /Schedule conflict/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Schedule anyway/i }));

    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenCalledTimes(3));
    expect(mockUpdateTeamScheduleAssignmentsBatch).toHaveBeenLastCalledWith(
      "church-1",
      "schedule-july",
      expect.objectContaining({
        skipChangedCells: true,
        confirmedOccurrenceConflictFingerprint: "redo-confirmed-v1",
        changes: expect.arrayContaining([
          expect.objectContaining({ serviceId: sundayOccurrenceId, positionSlotKey: "position-vocal::0" }),
          expect.objectContaining({ serviceId: sundayOccurrenceId, positionSlotKey: "position-keys::0" }),
        ]),
      }),
    );
    expect(screen.queryByRole("heading", { name: /Schedule conflict/i })).not.toBeInTheDocument();
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
    expect(mockGetNotificationIntents).toHaveBeenCalledTimes(1);
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
    // More options keeps shadow-only candidates in the list (Find a sub would
    // hide them). Recommendations still exclude anyone who cannot take the seat.
    await openVocalSlot(user, /Sunday Vocal, Avery/i, "More options");

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
    mockUpdateTeamScheduleAssignmentSwap
      .mockRejectedValueOnce(
        Object.assign(new Error("Schedule conflict"), {
          status: 409,
          details: {
            conflictFingerprint: "swap-conflict-v1",
            occurrenceConflicts: [{
              memberId: "member-jordan",
              scheduleId: "other-schedule",
              scheduleName: "Production July",
              teamId: "team-production",
              occurrenceId: sundayOccurrenceId,
              conflictingOccurrenceId: sundayOccurrenceId,
              cellKeys: ["position-camera::0"],
            }],
          },
        }),
      )
      .mockResolvedValueOnce({
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
    await waitFor(() => expect(mockUpdateTeamScheduleAssignmentSwap).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /Schedule conflict/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Move anyway/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignmentSwap).toHaveBeenCalledTimes(2);
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
        confirmedOccurrenceConflictFingerprint: "swap-conflict-v1",
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

    await user.click(screen.getByRole("button", { name: /Create schedule/i }));
    const conflictDialogPromise = screen.findByRole(
      "dialog",
      { name: /Schedule conflict/i },
      { timeout: 1_000 },
    );
    const conflictDialog = await conflictDialogPromise.catch(() => null);
    if (conflictDialog) {
      await user.click(
        within(conflictDialog).getByRole("button", { name: /Save anyway/i }),
      );
    }

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
    const user = userEvent.setup();
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
      screen.queryByRole("button", { name: /Create schedule/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /More schedule options/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    expect(screen.getByRole("menuitem", { name: "Schedule history" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Create schedule" })).not.toBeInTheDocument();
  });

  it("keeps Messages in schedule overflow and opens Members beside the workspace on narrow layouts", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );
    window.matchMedia = makeMatchMedia(true);

    renderTeams();
    await waitForScheduleGrid();

    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    expect(screen.getByRole("menuitem", { name: "Create schedule" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Schedule history" }));
    await user.click(await screen.findByRole("button", { name: /July/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "All schedules" })).not.toBeInTheDocument());
    await waitForScheduleGrid();

    await screen.findByRole("button", { name: /Sunday Vocal/i });
    expect(screen.queryByRole("heading", { name: "Schedule messages" })).not.toBeInTheDocument();
    const identity = screen.getByRole("group", { name: "Team schedule identity" });
    const controls = screen.getByRole("group", { name: "Team schedule controls" });
    expect(within(identity).getByRole("heading", { name: "Team schedule" })).toBeInTheDocument();
    expect(screen.getByText("Main Team")).toBeInTheDocument();
    expect(within(identity).queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: "Members" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    await user.click(screen.getByRole("menuitem", { name: /Messages/i }));
    expect(await screen.findByText("No assignment messages for this schedule.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sunday Vocal/i, hidden: true })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("No assignment messages for this schedule.")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /More schedule options/i })).toHaveFocus();
    expect(screen.getByRole("button", { name: /Sunday Vocal/i })).toBeInTheDocument();

    const membersToggle = within(controls).getByRole("button", { name: "Members" });
    expect(membersToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(membersToggle);
    expect(membersToggle).toHaveAttribute("aria-expanded", "true");
    const membersDrawer = await screen.findByRole("dialog", { name: "Members" });
    expect(within(membersDrawer).getByPlaceholderText("Search members…")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Schedule messages" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sunday Vocal/i, hidden: true })).toBeInTheDocument();
    await user.type(within(membersDrawer).getByPlaceholderText("Search members…"), "Morgan");
    expect(within(membersDrawer).getByRole("button", { name: /Highlight Morgan on the grid/i })).toBeInTheDocument();
    expect(within(membersDrawer).queryByRole("button", { name: /Highlight Avery on the grid/i })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(membersToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(membersToggle);
    const reopenedMembersDrawer = await screen.findByRole("dialog", { name: "Members" });
    expect(within(reopenedMembersDrawer).getByPlaceholderText("Search members…")).toHaveValue("Morgan");
  });

  it("uses only the inline panel arrow to toggle Members on wide layouts", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await waitForScheduleGrid();

    const identity = screen.getByRole("group", { name: "Team schedule identity" });
    const controls = screen.getByRole("group", { name: "Team schedule controls" });
    expect(within(identity).getByRole("heading", { name: "Team schedule" })).toBeInTheDocument();
    expect(screen.getByText("Main Team")).toBeInTheDocument();
    expect(within(identity).queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(within(controls).queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    const inlinePanel = screen.getByRole("complementary", { name: "Members" });
    expect(inlinePanel).toBeInTheDocument();
    const panelArrow = within(inlinePanel).getByRole("button", { name: "Hide members" });
    expect(panelArrow).toHaveAttribute("aria-expanded", "true");

    await user.click(panelArrow);
    expect(panelArrow).toHaveAttribute("aria-expanded", "false");
    await user.click(within(inlinePanel).getByRole("button", { name: "Show members" }));
    expect(panelArrow).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps schedule staffing status separate from the navigable date range", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await waitForScheduleGrid();

    expect(screen.getByText("Jul 1, 2026 – Jul 31, 2026")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/1 service · .*positions filled/);
    expect(
      screen.queryByText(/Jul 1, 2026 – Jul 31, 2026 · .*positions filled/),
    ).not.toBeInTheDocument();
  });

  it("keeps New schedule and Send schedule actions available with send confirmation", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    renderTeams();
    await waitForScheduleGrid();

    expect(screen.getByRole("button", { name: /Send schedule/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    const scheduleActionItems = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(scheduleActionItems.slice(0, 2)).toEqual([
      "Import CSV…",
      "Export CSVAll schedules",
    ]);
    expect(screen.getByRole("menuitem", { name: "Create schedule" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Schedule history" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Create schedule" }));
    expect(await screen.findByRole("heading", { name: "New schedule" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitForScheduleGrid();
    await user.click(screen.getByRole("button", { name: /Send schedule/i }));
    expect(await screen.findByText(/Email 1 person on this schedule\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockSendTeamSchedule).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    await user.click(screen.getByRole("menuitem", { name: "Create schedule" }));
    expect(await screen.findByRole("heading", { name: "New schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Start date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/End date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Services" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: /^Name:?$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitForScheduleGrid();
    expect(screen.getByRole("button", { name: /Sunday Vocal/i })).toBeInTheDocument();
    expect(screen.getByText("Main Team")).toBeInTheDocument();
  });

  it("opens Members in assignment mode when a schedule slot is active", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
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
    window.matchMedia = makeMatchMedia(true);

    renderTeams();
    await openVocalSlot(user, /Sunday Vocal, Avery/i, "Find a sub");
    await user.click(screen.getByRole("button", { name: /^Members$/i }));

    const membersDrawer = await screen.findByRole("dialog", { name: "Members" });
    expect(within(membersDrawer).getByText("Assigning")).toBeInTheDocument();
    expect(within(membersDrawer).getByText(/Vocal.*Jul 5, 2026/i)).toBeInTheDocument();
  });

  it("shows unique message attention counts and delivery status in the toolbar", async () => {
    const user = userEvent.setup();
    const baseIntent: NotificationIntent = {
      intentId: "intent-pending",
      churchId: "church-1",
      intentType: "assignment_notification",
      sourceType: "team_schedule",
      sourceId: "schedule-july",
      sourceVersion: "version-1",
      memberId: "member-avery",
      occurrenceId: sundayOccurrenceId,
      cellKey: "position-keys::0",
      channel: "sms",
      status: "ready",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      messagePreview: "You are scheduled.",
      previewEligible: true,
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );
    mockGetNotificationIntents.mockResolvedValue({
      success: true,
      intents: [
        baseIntent,
        {
          ...baseIntent,
          intentId: "intent-uncertain",
          status: "unknown",
          attemptStatus: "failed",
          attemptOutcome: "unknown",
        },
        {
          ...baseIntent,
          intentId: "intent-delivered",
          status: "sent",
          attemptStatus: "delivered",
        },
      ],
      nextCursor: "",
      limit: 20,
    });

    renderTeams();
    await waitForScheduleGrid();

    await user.click(screen.getByRole("button", { name: /More schedule options/i }));
    expect(screen.getByRole("menuitem", { name: /Messages 2.*1 pending · 1 delivered · 1 failed/i })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Messages/i }));
    expect(await screen.findByText("Uncertain 1")).toBeInTheDocument();
    expect(screen.getByText("Delivery: failed · Volunteer: waiting")).toBeInTheDocument();
    expect(screen.getByText(/Provider outcome uncertain/)).toBeInTheDocument();
  });

  it("keeps the saved schedule name when a cached edit draft is blank", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <ScheduleEditForm
              mode="edit"
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
              seedSchedules={scheduleBootstrap.schedules as TeamSchedule[]}
              churchId="church-1"
              canEdit
              onDraftChange={jest.fn()}
              onDraftFlush={jest.fn()}
              onDraftClear={jest.fn()}
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

  it("shows last served in the roster and historical count in member details", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse(scheduleBootstrap),
    );

    const user = userEvent.setup();
    renderTeams();
    await waitForScheduleGrid();

    expect(screen.getByText("Last served July 05, 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show details for Avery" }));
    expect(
      within(screen.getByRole("group", { name: /Avery, assigned/i })).getByText(
        "Served 0 times in the last month",
      ),
    ).toBeInTheDocument();
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
    await openVocalSlot(user, /Sunday Vocal/i, "Add shadow");
    await user.click(screen.getByRole("option", { name: /^Jordan$/i }));

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
    await user.click(await screen.findByRole("option", { name: /Avery/i }));

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
    expect(mockGetNotificationIntents).toHaveBeenCalledTimes(1);
  });

  it("confirms a hydrated conflict only once using the server fingerprint", async () => {
    const user = userEvent.setup();
    const scheduleWithoutAssignments = {
      ...scheduleBootstrap.schedules[0],
      assignments: {},
    };
    const hydratedConflictSchedule = {
      ...scheduleWithoutAssignments,
      scheduleId: "schedule-production-july",
      name: "Production July",
      teamId: "team-production",
      assignments: {
        [sundayOccurrenceId]: {
          "position-camera::0": { primaryMemberId: "member-avery" },
        },
      },
    };
    mockGetTeamsBootstrap.mockResolvedValue(
      asTeamsBootstrapResponse({
        ...scheduleBootstrap,
        schedules: [scheduleWithoutAssignments, hydratedConflictSchedule],
      }),
    );
    mockUpdateTeamScheduleAssignment
      .mockRejectedValueOnce(
        Object.assign(new Error("Schedule conflict"), {
          status: 409,
          details: {
            conflictFingerprint: "conflict-v1",
            occurrenceConflicts: [{
              memberId: "member-avery",
              scheduleId: "other-schedule",
              scheduleName: "Worship",
              teamId: "team-main",
              occurrenceId: sundayOccurrenceId,
              conflictingOccurrenceId: sundayOccurrenceId,
              cellKeys: ["position-keys::0"],
            }],
          },
        }),
      )
      .mockResolvedValueOnce({
        success: true,
        schedule: {
          ...scheduleWithoutAssignments,
          assignments: {
            [sundayOccurrenceId]: {
              "position-vocal::0": { primaryMemberId: "member-avery" },
            },
          },
        },
      } satisfies UpdateTeamScheduleAssignmentResponse);

    renderTeams();
    await openVocalSlot(user);
    await user.click(await screen.findByRole("option", { name: /Avery/i }));

    expect(
      await screen.findByRole("heading", { name: /Schedule conflict/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: /Schedule conflict/i })).toHaveLength(1);
    expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Schedule anyway/i }));

    await waitFor(() => {
      expect(mockUpdateTeamScheduleAssignment).toHaveBeenLastCalledWith(
        "church-1",
        "schedule-july",
        {
          serviceId: sundayOccurrenceId,
          positionSlotKey: "position-vocal::0",
          memberId: "member-avery",
          serviceDate: "2026-07-05",
          confirmedOccurrenceConflictFingerprint: "conflict-v1",
        },
      );
    });
    expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(2);
  });

  it("shows the updated conflict set when a confirmed fingerprint becomes stale", async () => {
    const user = userEvent.setup();
    mockGetTeamsBootstrap.mockResolvedValue(asTeamsBootstrapResponse(scheduleBootstrap));
    const conflict = (fingerprint: string, scheduleName: string) => Object.assign(
      new Error("Schedule conflict"),
      {
        status: 409,
        details: {
          conflictFingerprint: fingerprint,
          occurrenceConflicts: [{
            memberId: "member-avery",
            scheduleId: "other-schedule",
            scheduleName,
            teamId: "team-production",
            occurrenceId: sundayOccurrenceId,
            conflictingOccurrenceId: sundayOccurrenceId,
            cellKeys: ["position-camera::0"],
          }],
        },
      },
    );
    mockUpdateTeamScheduleAssignment
      .mockRejectedValueOnce(conflict("old-fingerprint", "Production"))
      .mockRejectedValueOnce(conflict("new-fingerprint", "Streaming"))
      .mockResolvedValueOnce({
        success: true,
        schedule: {
          ...scheduleBootstrap.schedules[0],
          assignments: { [sundayOccurrenceId]: { "position-vocal::0": { primaryMemberId: "member-avery" } } },
        },
      } satisfies UpdateTeamScheduleAssignmentResponse);

    renderTeams();
    await openVocalSlot(user);
    await user.click(await screen.findByRole("option", { name: /Avery.*Will move from Keys/i }));
    await user.click(await screen.findByRole("button", { name: /Move anyway/i }));
    expect(await screen.findByText(/Production/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Move anyway/i }));
    expect(await screen.findByText(/Streaming/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Move anyway/i }));

    await waitFor(() => expect(mockUpdateTeamScheduleAssignment).toHaveBeenCalledTimes(3));
    expect(mockUpdateTeamScheduleAssignment.mock.calls[1][2]).toEqual(expect.objectContaining({
      confirmedOccurrenceConflictFingerprint: "old-fingerprint",
    }));
    expect(mockUpdateTeamScheduleAssignment.mock.calls[2][2]).toEqual(expect.objectContaining({
      confirmedOccurrenceConflictFingerprint: "new-fingerprint",
    }));
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
