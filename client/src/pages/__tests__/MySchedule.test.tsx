import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../../store/store";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import MySchedule from "../MySchedule";
import { GlobalInfoContext } from "../../context/globalInfo";
import { getMyTeamAssignments } from "../../api/auth";
import { usePublicServiceFlow } from "../../services/usePublicServiceFlow";

jest.mock("../../api/auth", () => ({
  getMyTeamAssignments: jest.fn(),
}));

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: jest.fn(),
    removeToast: jest.fn(),
  }),
}));

jest.mock("../../services/usePublicServiceFlow", () => ({
  usePublicServiceFlow: jest.fn(),
}));

const mockGetMyTeamAssignments = jest.mocked(getMyTeamAssignments);
const mockUsePublicServiceFlow = jest.mocked(usePublicServiceFlow);

/** Far future/past so these never drift buckets as the clock moves. */
const FUTURE = "2099-09-06T15:00:00.000Z";
const PAST = "2000-09-06T15:00:00.000Z";

const me = (overrides = {}) => ({
  memberId: "m1",
  name: "Kevin Cheddar",
  isMe: true,
  scheduleId: "sched-1",
  teamId: "team-media",
  teamName: "Media",
  positionId: "pos-director",
  positionName: "Director",
  columnKey: "pos-director::0",
  isPrimary: true,
  ...overrides,
});

const other = (overrides = {}) => ({
  memberId: "",
  name: "Ada R.",
  isMe: false,
  scheduleId: "sched-1",
  teamId: "team-media",
  teamName: "Media",
  positionId: "pos-camera",
  positionName: "Camera",
  columnKey: "pos-camera::0",
  isPrimary: true,
  ...overrides,
});

const occurrence = (overrides = {}) => ({
  occurrenceId: `service-1@${FUTURE}`,
  serviceIds: ["service-1"],
  name: "Sunday Gathering",
  date: FUTURE.slice(0, 10),
  startsAt: FUTURE,
  serving: [me(), other()],
  plan: null,
  ...overrides,
});

const respond = (occurrences: unknown[], member: unknown = { memberId: "m1" }) =>
  mockGetMyTeamAssignments.mockResolvedValue({
    success: true,
    member,
    occurrences,
  } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);

// AppPageShell reads the scrollbar-width preference and renders the app menu,
// so the page needs the store and a router the way the real app provides them.
const renderPage = (role = "member") =>
  render(
    <Provider store={store}>
    <MemoryRouter>
    <GlobalInfoContext.Provider
      value={
        {
          churchId: "church-1",
          churchName: "Northside",
          role,
        } as ContextType<typeof GlobalInfoContext>
      }
    >
      <MySchedule />
    </GlobalInfoContext.Provider>
    </MemoryRouter>
    </Provider>,
  );

const openFirstService = async (user: ReturnType<typeof userEvent.setup>) => {
  const tile = await screen.findByRole("button", {
    name: /Open Sunday Gathering/i,
  });
  await user.click(tile);
};

describe("MySchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePublicServiceFlow.mockReturnValue({
      snapshot: null,
      error: "",
      loading: false,
      connection: "failed",
      revoked: false,
      refresh: jest.fn(),
    });
  });

  it("lists services as tiles with role and opens a detail view", async () => {
    const user = userEvent.setup();
    respond([occurrence()]);
    renderPage();

    expect(await screen.findByText("Director · Media")).toBeInTheDocument();
    await openFirstService(user);

    expect(screen.getByRole("heading", { name: "Sunday Gathering" })).toBeInTheDocument();
    expect(screen.getByText("Director · Media")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Schedule or service plan/i })).toBeInTheDocument();
  });

  it("shows the public schedule table with the viewer highlighted", async () => {
    const user = userEvent.setup();
    respond([occurrence()]);
    renderPage();

    await openFirstService(user);

    expect(screen.getByText("Kevin Cheddar")).toBeInTheDocument();
    expect(screen.getByText("Ada R.")).toBeInTheDocument();
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText("Camera")).toBeInTheDocument();
  });

  it("opens the service plan tab with the public service plan chrome", async () => {
    const user = userEvent.setup();
    respond([
      occurrence({
        plan: {
          planId: "plan-1",
          name: "Sunday Gathering",
          published: false,
          sections: [
            {
              name: "Worship",
              elements: [
                {
                  type: "song",
                  title: "Great Is Thy Faithfulness",
                  startTime: "",
                  durationSeconds: 300,
                },
              ],
            },
          ],
        },
      }),
    ]);
    renderPage();

    await openFirstService(user);
    await user.click(screen.getByRole("button", { name: /^Service plan$/i }));

    expect(screen.getByText("Great Is Thy Faithfulness")).toBeInTheDocument();
    expect(screen.getByText("Worship")).toBeInTheDocument();
  });

  it("offers view and copy for a published public service plan", async () => {
    const user = userEvent.setup();
    respond([
      occurrence({
        plan: {
          planId: "plan-1",
          name: "Sunday Gathering",
          published: true,
          publicUrls: {
            team: "https://example.test/#/services/team-token",
            general: "https://example.test/#/services/general-token",
          },
          sections: [
            {
              name: "Worship",
              elements: [
                {
                  type: "song",
                  title: "Amazing Grace",
                  startTime: "",
                  durationSeconds: 0,
                },
              ],
            },
          ],
        },
      }),
    ]);
    renderPage();

    await openFirstService(user);
    await user.click(screen.getByRole("button", { name: /^Service plan$/i }));

    expect(
      screen.getByRole("button", { name: /Copy detailed view link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /View detailed view/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copy simple view link/i }),
    ).toBeInTheDocument();
  });

  it("navigates between services with previous and next", async () => {
    const user = userEvent.setup();
    const later = "2099-09-13T15:00:00.000Z";
    respond([
      occurrence(),
      occurrence({
        occurrenceId: `service-2@${later}`,
        serviceIds: ["service-2"],
        name: "Evening Service",
        date: later.slice(0, 10),
        startsAt: later,
        serving: [me({ positionName: "Camera - Roving" })],
      }),
    ]);
    renderPage();

    await openFirstService(user);
    expect(screen.getByRole("heading", { name: "Sunday Gathering" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next service/i }));
    expect(screen.getByRole("heading", { name: "Evening Service" })).toBeInTheDocument();
    expect(screen.getByText("Camera - Roving · Media")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Previous service/i }));
    expect(screen.getByRole("heading", { name: "Sunday Gathering" })).toBeInTheDocument();
  });

  it("searches across people, positions, and plan items", async () => {
    const user = userEvent.setup();
    respond([
      occurrence({
        plan: {
          planId: "plan-1",
          name: "Sunday",
          sections: [
            {
              name: "Worship",
              elements: [
                {
                  type: "song",
                  title: "Amazing Grace",
                  startTime: "",
                  durationSeconds: 0,
                },
              ],
            },
          ],
        },
      }),
      occurrence({
        occurrenceId: `service-2@${FUTURE}`,
        serviceIds: ["service-2"],
        name: "Evening Service",
        serving: [me({ positionName: "Camera - Roving" })],
      }),
    ]);
    renderPage();

    await screen.findByRole("button", { name: /Open Sunday Gathering/i });
    await user.type(screen.getByLabelText(/Search/i), "amazing");

    expect(
      screen.getByRole("button", { name: /Open Sunday Gathering/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Evening Service/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps past services behind a toggle so the next one is not buried", async () => {
    respond([
      occurrence({
        occurrenceId: `s@${PAST}`,
        startsAt: PAST,
        name: "Old Service",
      }),
      occurrence(),
    ]);
    renderPage();

    expect(
      await screen.findByRole("button", { name: /Show 1 past service/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open Sunday Gathering/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Old Service/i }),
    ).not.toBeInTheDocument();
  });

  it("explains an unlinked account rather than showing an empty list", async () => {
    respond([], null);
    renderPage();

    expect(
      await screen.findByText(/Ask an admin to link you/),
    ).toBeInTheDocument();
  });

  it("tells an admin to link themselves instead of asking an admin", async () => {
    respond([], null);
    renderPage("admin");

    // "Ask an admin" is useless advice when you are the admin, and linking is
    // something they can do themselves.
    expect(
      await screen.findByText(/Link your account to a member in Teams/),
    ).toBeInTheDocument();
  });

  it("distinguishes an empty search from an empty schedule", async () => {
    const user = userEvent.setup();
    respond([occurrence()]);
    renderPage();

    await screen.findByRole("button", { name: /Open Sunday Gathering/i });
    await user.type(screen.getByLabelText(/Search/i), "zzzz");

    expect(screen.getByText("Nothing matches that search.")).toBeInTheDocument();
  });

  it("surfaces a load failure with a next step", async () => {
    mockGetMyTeamAssignments.mockRejectedValue(new Error("nope"));
    renderPage();

    expect(
      await screen.findByText(/Could not load your schedule/),
    ).toBeInTheDocument();
  });
});
