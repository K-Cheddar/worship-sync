import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ContextType } from "react";
import TeamsPlansPage, { rangeFromPreset } from "./TeamsPlansPage";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import {
  getServicePlan,
  getServicePlanAssignmentHistory,
  getServicePlanMicrophones,
  listServicePlans,
  saveServicePlan,
} from "../../../api/auth";
import type { TeamService } from "../../../api/authTypes";
import { formatPlainDate } from "../../../utils/plainDate";

jest.mock("../../../api/auth", () => ({
  listServicePlans: jest.fn(),
  getServicePlan: jest.fn(),
  getServicePlanAssignmentHistory: jest.fn(),
  saveServicePlan: jest.fn(),
  saveServicePlanAssignmentHistory: jest.fn(),
  // The editor loads the church microphone catalog on mount and chains off the
  // result, so this has to resolve rather than return undefined.
  getServicePlanMicrophones: jest.fn(async () => ({
    success: true,
    microphones: [],
    audiences: [],
  })),
}));

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ allDocs: { allSongDocs: [] } }),
  useDispatch: () => jest.fn(),
}));

const sabbath: TeamService = {
  id: "sabbath",
  serviceId: "sabbath",
  churchId: "church-1",
  name: "Sabbath Service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 6,
  time: "10:00",
};

/** Keep the fixture inside the default current-month range at month boundaries. */
const oneTimeDate = (() => {
  const date = new Date();
  date.setDate(15);
  return date;
})();
const oneTimePlainDate = formatPlainDate(oneTimeDate);

const easterOneTime: TeamService = {
  id: "easter",
  serviceId: "easter",
  churchId: "church-1",
  name: "Easter Sunday",
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO: new Date(`${oneTimePlainDate}T14:00:00`).toISOString(),
};

/** Occurrences for a one-time service are keyed `<serviceId>@<startsAt>`. */
const oneTimeStartsAt = easterOneTime.dateTimeISO as string;
const oneTimeOccurrenceId = `easter@${oneTimeStartsAt}`;

const mockUseTeamsPage = jest.fn();
const mockHydrateSchedules = jest.fn();
jest.mock("../TeamsPageContext", () => ({
  useTeamsPage: () => mockUseTeamsPage(),
}));

const mockGetServicePlan = jest.mocked(getServicePlan);
const mockGetServicePlanMicrophones = jest.mocked(getServicePlanMicrophones);
const mockGetServicePlanAssignmentHistory = jest.mocked(getServicePlanAssignmentHistory);
const mockListServicePlans = jest.mocked(listServicePlans);
const mockSaveServicePlan = jest.mocked(saveServicePlan);

const originalMatchMedia = window.matchMedia;
const makeMatchMedia = (matches: boolean): typeof window.matchMedia =>
  jest.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;

const renderPage = () =>
  render(
    <GlobalInfoContext.Provider
      value={
        createMockGlobalContext({ churchId: "church-1" }) as ContextType<
          typeof GlobalInfoContext
        >
      }
    >
      <ToastProvider>
        <MemoryRouter initialEntries={["/teams-and-services/plans"]}>
          <Routes>
            <Route path="/teams-and-services/plans" element={<TeamsPlansPage />} />
            <Route
              path="/teams-and-services/schedules"
              element={<div>Schedules page</div>}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </GlobalInfoContext.Provider>,
  );

describe("TeamsPlansPage", () => {
  beforeAll(() => {
    window.matchMedia = makeMatchMedia(false);
  });

  afterAll(() => {
    window.matchMedia = originalMatchMedia;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [sabbath, easterOneTime],
        positions: [],
        teams: [],
        schedules: [],
        members: [],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });
    mockListServicePlans.mockResolvedValue({ success: true, servicePlans: [] });
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: null });
    mockGetServicePlanAssignmentHistory.mockResolvedValue({ success: true, values: [] });
    mockSaveServicePlan.mockResolvedValue({
      success: true,
      servicePlan: {} as never,
    });
  });

  it("uses complete calendar months and quarters for range presets", () => {
    const lateQuarterDate = new Date("2026-09-28T12:00:00");

    expect(rangeFromPreset("thisMonth", lateQuarterDate)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(rangeFromPreset("nextMonth", lateQuarterDate)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(rangeFromPreset("thisQuarter", lateQuarterDate)).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
    expect(rangeFromPreset("nextQuarter", lateQuarterDate)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("shows one date-range input for a custom range", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Date range" }));
    await user.click(await screen.findByRole("button", { name: /^Custom$/i }));

    expect(screen.getByRole("textbox", { name: "Date range" })).toBeInTheDocument();
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("To")).not.toBeInTheDocument();
  });

  it("defaults to by-date order with an organize control when multiple services exist", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "All services" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Organize services/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^By date$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Service filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date range" })).toBeInTheDocument();
    expect(screen.queryByText("Add plan")).not.toBeInTheDocument();
    expect(
      (await screen.findAllByRole("button", { name: /Add plan for /i })).length,
    ).toBeGreaterThan(0);
    // Service names land on tiles in date order instead of separate section headers.
    expect(
      screen.getAllByText("Sabbath Service").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Easter Sunday")).toBeInTheDocument();
  });

  it("can switch to by-service cards", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "All services" });
    await user.click(screen.getByRole("button", { name: /^By service$/i }));

    expect(screen.getByRole("heading", { name: "Sabbath Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Easter Sunday" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "All services" })).not.toBeInTheDocument();
  });

  it("lists each service's occurrences as date tiles without repeating Add plan labels", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "All services" });
    await user.click(screen.getByRole("button", { name: /^By service$/i }));

    expect(screen.getByRole("heading", { name: "Sabbath Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Easter Sunday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Service filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date range" })).toBeInTheDocument();
    expect(screen.queryByText("Add plan")).not.toBeInTheDocument();
    expect(
      (await screen.findAllByRole("button", { name: /Add plan for /i })).length,
    ).toBeGreaterThan(0);
  });

  it("shows mild plan-status placeholders until service plans load", async () => {
    let resolvePlans!: (value: {
      success: true;
      servicePlans: [];
    }) => void;
    mockListServicePlans.mockReturnValue(
      new Promise((resolve) => {
        resolvePlans = resolve;
      }),
    );

    renderPage();

    expect(
      await screen.findByRole("status", { name: /Loading plan status/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("None planned")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Plan for /i }).length,
    ).toBeGreaterThan(0);

    await act(async () => {
      resolvePlans({ success: true, servicePlans: [] });
    });

    expect(
      (await screen.findAllByText("None planned")).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByRole("button", { name: /Add plan for /i })).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("status", { name: /Loading plan status/i }),
    ).not.toBeInTheDocument();
  });

  it("marks an occurrence that already has a saved plan as Open plan", async () => {
    mockListServicePlans.mockResolvedValue({
      success: true,
      servicePlans: [
        {
          planKey: `easter@${oneTimePlainDate}`,
          serviceId: "easter",
          date: oneTimePlainDate,
          name: "Easter Sunday",
        },
      ],
    });

    renderPage();

    expect(
      await screen.findByRole("button", { name: /Open plan for /i }),
    ).toBeInTheDocument();
  });

  it("opens the plan editor for a clicked date and can navigate back to the list", async () => {
    const user = userEvent.setup();
    // Only the one-time service, so the single tile below is unambiguously its
    // only occurrence — the weekly Sabbath can land on the same date and render
    // a tile with an identical label.
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [easterOneTime],
        positions: [],
        teams: [],
        schedules: [],
        members: [],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });
    renderPage();

    await screen.findByRole("heading", { name: "Easter Sunday" });
    const addPlanButtons = await screen.findAllByRole("button", {
      name: /Add plan for /i,
    });
    expect(addPlanButtons).toHaveLength(1);
    await user.click(addPlanButtons[0]);

    expect(
      await screen.findByRole("button", { name: /Back to Services/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
    // Mobile keeps the serving roster inside the same four-tab workspace.
    expect(
      screen.getByRole("tab", { name: /Who's serving/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    // One-time Easter has a single occurrence in range — both ends disabled.
    expect(screen.getByRole("button", { name: /Previous plan/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next plan/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Back to Services/i }));
    expect(await screen.findByRole("heading", { name: "Easter Sunday" })).toBeInTheDocument();
  });

  it("navigates to the previous and next plan for the same service from the header", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T12:00:00"));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderPage();
    // Flush listServicePlans microtasks so plan-status setState stays inside act
    // under fake timers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await screen.findByRole("heading", { name: "All services" });
    await user.click(screen.getByRole("button", { name: "Service filter" }));
    await user.click(await screen.findByRole("checkbox", { name: "Sabbath Service" }));

    await screen.findByRole("heading", { name: "Sabbath Service" });
    const sabbathTiles = await screen.findAllByRole("button", {
      name: /Add plan for /i,
    });
    // Second Sabbath tile so both previous and next exist in the window.
    expect(sabbathTiles.length).toBeGreaterThan(2);
    await user.click(sabbathTiles[1]);

    expect(
      await screen.findByRole("heading", { name: "Sabbath Service" }),
    ).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: /Previous plan/i });
    const next = screen.getByRole("button", { name: /Next plan/i });
    expect(previous).toBeEnabled();
    expect(next).toBeEnabled();

    const dateBeforeNext = screen.getByText(/2026/).textContent;
    await user.click(next);
    await waitFor(() => {
      expect(screen.getByText(/2026/).textContent).not.toBe(dateBeforeNext);
    });
    const dateAfterNext = screen.getByText(/2026/).textContent;

    await user.click(screen.getByRole("button", { name: /Previous plan/i }));
    await waitFor(() => {
      expect(screen.getByText(/2026/).textContent).toBe(dateBeforeNext);
    });
    expect(dateAfterNext).not.toBe(dateBeforeNext);

    jest.useRealTimers();
  });

  it("summarizes who's serving with a fill count and links a row into the schedule", async () => {
    const user = userEvent.setup();
    const occurrenceId = oneTimeOccurrenceId;
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [
          {
            ...easterOneTime,
            positionRequirements: [{ positionId: "position-vocal", count: 2 }],
          },
        ],
        positions: [
          {
            positionId: "position-vocal",
            churchId: "church-1",
            teamId: "team-1",
            name: "Vocal",
          },
        ],
        teams: [
          {
            teamId: "team-1",
            churchId: "church-1",
            name: "Worship",
            memberIds: [],
          },
        ],
        members: [
          {
            memberId: "member-1",
            churchId: "church-1",
            firstName: "Avery",
            lastName: "Stone",
            positionIds: [],
            blockoutDates: [],
          },
        ],
        schedules: [
          {
            scheduleId: "schedule-1",
            churchId: "church-1",
            name: "August",
            teamId: "team-1",
            serviceIds: ["easter"],
            occurrences: [
              {
                occurrenceId,
                serviceId: "easter",
                name: "Easter Sunday",
                startsAt: oneTimeStartsAt,
              },
            ],
            assignments: {
              [occurrenceId]: {
                "position-vocal::0": { primaryMemberId: "member-1" },
              },
            },
          },
        ],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });

    renderPage();
    const addPlanButtons = await screen.findAllByRole("button", {
      name: /Add plan for /i,
    });
    await user.click(addPlanButtons[addPlanButtons.length - 1]);

    await user.click(screen.getByRole("tab", { name: /Who's serving/i }));

    const servingSheet = await screen.findByRole("tabpanel", {
      name: /Who's serving/i,
    });
    expect(within(servingSheet).getByText("Avery Stone")).toBeInTheDocument();
    // Both vocal slots are required, only one is filled.
    expect(
      within(servingSheet).getByLabelText("1 of 2 positions filled"),
    ).toBeInTheDocument();

    await user.click(
      within(servingSheet).getByRole("button", {
        name: /Fill 1 open position for Worship/i,
      }),
    );
    expect(await screen.findByText("Schedules page")).toBeInTheDocument();
  });

  // The bootstrap only hydrates schedules around today. A plan outside that
  // window used to render the summary away and show an empty roster, which is
  // indistinguishable from nobody being scheduled.
  it("says who's serving hasn't loaded instead of showing an empty roster", async () => {
    const user = userEvent.setup();
    const summarySchedule = {
      scheduleId: "schedule-1",
      churchId: "church-1",
      name: "August",
      teamId: "team-1",
      serviceIds: ["easter"],
      occurrences: [
        {
          occurrenceId: oneTimeOccurrenceId,
          serviceId: "easter",
          name: "Easter Sunday",
          startsAt: oneTimeStartsAt,
        },
      ],
      // What the bootstrap ships for a schedule outside the hydration window.
      assignmentsOmitted: true,
    };
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [
          {
            ...easterOneTime,
            positionRequirements: [{ positionId: "position-vocal", count: 1 }],
          },
        ],
        positions: [
          {
            positionId: "position-vocal",
            churchId: "church-1",
            teamId: "team-1",
            name: "Vocal",
          },
        ],
        teams: [
          { teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] },
        ],
        members: [],
        schedules: [summarySchedule],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });

    renderPage();
    const addPlanButtons = await screen.findAllByRole("button", {
      name: /Add plan for /i,
    });
    await user.click(addPlanButtons[addPlanButtons.length - 1]);
    await user.click(screen.getByRole("tab", { name: /Who's serving/i }));

    const servingSheet = await screen.findByRole("tabpanel", {
      name: /Who's serving/i,
    });
    expect(
      within(servingSheet).getByText(/hasn't loaded, so names may be missing/i),
    ).toBeInTheDocument();
    // And the missing cells are fetched rather than left as a dead end.
    expect(mockHydrateSchedules).toHaveBeenCalledWith(["schedule-1"]);
  });

  it("names the microphones a scheduled person is holding in Who's serving", async () => {
    const user = userEvent.setup();
    const occurrenceId = oneTimeOccurrenceId;
    mockGetServicePlanMicrophones.mockResolvedValue({
      success: true,
      microphones: [
        { id: "mic-lead", name: "Lead", type: "Handheld", color: "#22d3ee" },
      ],
      audiences: [],
    });
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [
          {
            ...easterOneTime,
            positionRequirements: [{ positionId: "position-vocal", count: 1 }],
          },
        ],
        positions: [
          {
            positionId: "position-vocal",
            churchId: "church-1",
            teamId: "team-1",
            name: "Vocal",
          },
        ],
        teams: [
          {
            teamId: "team-1",
            churchId: "church-1",
            name: "Worship",
            memberIds: [],
            usesMicrophoneAssignments: true,
          },
        ],
        members: [
          {
            memberId: "member-1",
            churchId: "church-1",
            firstName: "Avery",
            lastName: "Stone",
            positionIds: [],
            blockoutDates: [],
          },
        ],
        schedules: [
          {
            scheduleId: "schedule-1",
            churchId: "church-1",
            name: "August",
            teamId: "team-1",
            serviceIds: ["easter"],
            occurrences: [
              {
                occurrenceId,
                serviceId: "easter",
                name: "Easter Sunday",
                startsAt: oneTimeStartsAt,
              },
            ],
            assignments: {
              [occurrenceId]: {
                "position-vocal::0": { primaryMemberId: "member-1" },
              },
            },
            microphoneAssignments: {
              [occurrenceId]: { "position-vocal::0": ["mic-lead"] },
            },
          },
        ],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });

    renderPage();
    const addPlanButtons = await screen.findAllByRole("button", {
      name: /Add plan for /i,
    });
    await user.click(addPlanButtons[addPlanButtons.length - 1]);

    await user.click(screen.getByRole("tab", { name: /Who's serving/i }));

    const servingSheet = await screen.findByRole("tabpanel", {
      name: /Who's serving/i,
    });
    expect(within(servingSheet).getByText("Avery Stone")).toBeInTheDocument();
    expect(within(servingSheet).getByText("Vocal")).toBeInTheDocument();
    expect(within(servingSheet).getByText("Lead")).toBeInTheDocument();
    // Members are read-only; schedule edits go through the team Edit control.
    expect(
      within(servingSheet).getByRole("button", {
        name: /Edit Worship schedule/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(servingSheet).queryByRole("button", {
        name: /Avery Stone on Vocal/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("lists the positions the service needs when no schedule covers the date", async () => {
    const user = userEvent.setup();
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [
          {
            ...easterOneTime,
            positionRequirements: [
              { positionId: "position-vocal", count: 2 },
              { positionId: "position-foh", count: 1 },
            ],
          },
        ],
        positions: [
          {
            positionId: "position-vocal",
            churchId: "church-1",
            teamId: "team-1",
            name: "Vocal",
          },
          {
            positionId: "position-foh",
            churchId: "church-1",
            teamId: "team-2",
            name: "Front of House",
          },
        ],
        teams: [
          { teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [] },
          {
            teamId: "team-2",
            churchId: "church-1",
            name: "Technical",
            memberIds: [],
          },
        ],
        members: [],
        schedules: [],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });

    renderPage();
    const addPlanButtons = await screen.findAllByRole("button", {
      name: /Add plan for /i,
    });
    await user.click(addPlanButtons[addPlanButtons.length - 1]);

    await user.click(screen.getByRole("tab", { name: /Who's serving/i }));

    const servingSheet = await screen.findByRole("tabpanel", {
      name: /Who's serving/i,
    });
    // Requirements are grouped under the team that owns each position.
    expect(within(servingSheet).getByText("Worship")).toBeInTheDocument();
    expect(within(servingSheet).getByText("Technical")).toBeInTheDocument();
    expect(within(servingSheet).getByText("Vocal")).toBeInTheDocument();
    expect(within(servingSheet).getByText("×2")).toBeInTheDocument();
    expect(within(servingSheet).getByText("Front of House")).toBeInTheDocument();
    expect(within(servingSheet).getAllByText("Not scheduled yet")).toHaveLength(2);
    expect(
      within(servingSheet).getByLabelText("0 of 2 positions filled"),
    ).toBeInTheDocument();
    // Nothing to open, so the team header has no Edit control.
    expect(
      within(servingSheet).queryByRole("button", { name: /Edit .+ schedule/i }),
    ).not.toBeInTheDocument();
  });

  it("fetches the plan summary list for the current church on mount", async () => {
    renderPage();
    await waitFor(() => expect(mockListServicePlans).toHaveBeenCalledWith("church-1"));
    expect(
      await screen.findAllByRole("button", { name: /Add plan for /i }),
    ).not.toHaveLength(0);
  });

  it("filters the list to a single service", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "All services" });
    expect(screen.getByText("Easter Sunday")).toBeInTheDocument();
    await screen.findAllByRole("button", { name: /Add plan for /i });
    await user.click(screen.getByRole("button", { name: "Service filter" }));
    await user.click(await screen.findByRole("checkbox", { name: "Sabbath Service" }));

    expect(screen.getByRole("heading", { name: "Sabbath Service" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Easter Sunday" })).not.toBeInTheDocument();
  });

  it("allows multiple services to be selected", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "All services" });
    await user.click(screen.getByRole("button", { name: "Service filter" }));
    await user.click(await screen.findByRole("checkbox", { name: "Sabbath Service" }));
    await user.click(await screen.findByRole("checkbox", { name: "Easter Sunday" }));

    expect(screen.getByRole("heading", { name: "2 services selected" })).toBeInTheDocument();
    expect(
      await screen.findAllByRole("button", { name: /Easter Sunday/i }),
    ).not.toHaveLength(0);
    expect(
      await screen.findAllByRole("button", { name: /Sabbath Service/i }),
    ).not.toHaveLength(0);
  });

  it("marks the soonest upcoming occurrence with an Up next badge", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T12:00:00"));

    renderPage();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText(/Up next/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /up next/i }),
    ).toBeInTheDocument();
    await screen.findAllByRole("button", { name: /Add plan for /i });

    jest.useRealTimers();
  });

  it("excludes a one-time service whose fixed date falls outside the selected range", async () => {
    // Regression test: a one-time service's single occurrence used to always
    // show regardless of the selected Range preset, since only recurring
    // services were filtered by window — long-past one-time services (e.g.
    // old test data) would leak into the selected range forever.
    const longAgoOneTime: TeamService = {
      id: "long-ago",
      serviceId: "long-ago",
      churchId: "church-1",
      name: "Old Test Service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: "2020-01-01T14:00:00.000Z",
    };
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [sabbath, easterOneTime, longAgoOneTime],
        positions: [],
        teams: [],
        schedules: [],
        members: [],
      },
      canEditTeams: true,
      hydrateSchedules: mockHydrateSchedules,
      hydratingScheduleIds: [],
    });

    renderPage();

    await screen.findByRole("heading", { name: "All services" });
    expect(screen.getByText("Easter Sunday")).toBeInTheDocument();
    await screen.findAllByRole("button", { name: /Add plan for /i });
    expect(screen.queryByText("Old Test Service")).not.toBeInTheDocument();
  });
});
