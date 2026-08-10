import { render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../../store/store";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import MySchedule from "../MySchedule";
import { GlobalInfoContext } from "../../context/globalInfo";
import { getMyTeamAssignments, updateMyBlockoutDates } from "../../api/auth";
import { usePublicServiceFlow } from "../../services/usePublicServiceFlow";

jest.mock("../../api/auth", () => ({
  getMyTeamAssignments: jest.fn(),
  updateMyBlockoutDates: jest.fn(),
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
const mockUpdateMyBlockoutDates = jest.mocked(updateMyBlockoutDates);
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

  it("hides undated legacy assignments so they do not appear as upcoming", async () => {
    respond([
      occurrence({
        occurrenceId: "legacy-service",
        serviceIds: ["legacy-service"],
        name: "Legacy Undated Service",
        date: "2026-06-08",
        startsAt: "",
      }),
      occurrence(),
    ]);
    renderPage();

    expect(
      await screen.findByRole("button", { name: /Open Sunday Gathering/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Legacy Undated Service/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Show .* past service/i }),
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

  describe("time off", () => {
    const away = { startDate: "2099-09-06", endDate: "2099-09-06", notes: "Away" };

    const expandTimeOff = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: /Time off/i }));
    };

    it("stays collapsed until asked for, so the schedule keeps the space", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      renderPage();

      expect(
        screen.queryByRole("button", { name: /Add single day/i }),
      ).not.toBeInTheDocument();

      await expandTimeOff(user);

      expect(
        screen.getByRole("button", { name: /Add single day/i }),
      ).toBeInTheDocument();
    });

    // Blocking a date you are already on is allowed — refusing would leave the
    // owner believing the slot is covered. Both sides see the clash instead.
    it("flags a service the member is already scheduled for", async () => {
      const user = userEvent.setup();
      respond([occurrence()], { memberId: "m1", blockoutDates: [away] });
      renderPage();

      // Visible before expanding: a clash is worth interrupting for.
      expect(await screen.findByText("1 conflict")).toBeInTheDocument();

      await expandTimeOff(user);

      const conflictList = screen.getByRole("list", {
        name: /You are scheduled on some of these dates/i,
      });
      expect(within(conflictList).getByText(/Sunday Gathering/)).toBeInTheDocument();
      expect(screen.getByText(/Your team lead sees the conflict/i)).toBeInTheDocument();
    });

    it("does not flag a blockout that misses every scheduled date", async () => {
      const user = userEvent.setup();
      respond([occurrence()], {
        memberId: "m1",
        blockoutDates: [{ startDate: "2099-10-01", endDate: "2099-10-05" }],
      });
      renderPage();

      await expandTimeOff(user);

      expect(
        screen.queryByText(/You are scheduled on some of these dates/i),
      ).not.toBeInTheDocument();
    });

    it("saves an edit and keeps what the server normalized", async () => {
      const user = userEvent.setup();
      const second = { startDate: "2099-10-01", endDate: "2099-10-05" };
      respond([occurrence()], { memberId: "m1", blockoutDates: [away, second] });
      mockUpdateMyBlockoutDates.mockResolvedValue({
        success: true,
        member: { memberId: "m1", blockoutDates: [second] },
      } as unknown as Awaited<ReturnType<typeof updateMyBlockoutDates>>);
      renderPage();

      await expandTimeOff(user);
      const save = screen.getByRole("button", { name: /Save time off/i });
      expect(save).toBeDisabled();

      const removeButtons = screen.getAllByRole("button", {
        name: /Remove blockout/i,
      });
      await user.click(removeButtons[0]);
      expect(save).toBeEnabled();

      await user.click(save);

      expect(mockUpdateMyBlockoutDates).toHaveBeenCalledWith("church-1", [
        second,
      ]);
      // The conflicting entry is gone, so the header count clears.
      expect(screen.queryByText("1 conflict")).not.toBeInTheDocument();
    });

    // A volunteer of several years would otherwise scroll past dozens of dead
    // trips to reach next summer. Hidden is not deleted: the entries go back to
    // the server untouched on the next save.
    it("hides finished trips from the editor but still saves them", async () => {
      const user = userEvent.setup();
      const over = { startDate: "2000-01-01", endDate: "2000-01-05" };
      const ahead = { startDate: "2099-10-01", endDate: "2099-10-05" };
      respond([occurrence()], { memberId: "m1", blockoutDates: [over, ahead] });
      mockUpdateMyBlockoutDates.mockResolvedValue({
        success: true,
        member: { memberId: "m1", blockoutDates: [over] },
      } as unknown as Awaited<ReturnType<typeof updateMyBlockoutDates>>);
      renderPage();

      // The header counts what is ahead, not the whole history.
      expect(await screen.findByText("1 upcoming")).toBeInTheDocument();

      await expandTimeOff(user);
      expect(
        screen.getByText(/1 is kept on your record for a year/i),
      ).toBeInTheDocument();

      // One editable row, for the upcoming trip only.
      const removeButtons = screen.getAllByRole("button", {
        name: /Remove blockout/i,
      });
      expect(removeButtons).toHaveLength(1);

      await user.click(removeButtons[0]);
      await user.click(screen.getByRole("button", { name: /Save time off/i }));

      expect(mockUpdateMyBlockoutDates).toHaveBeenCalledWith("church-1", [over]);
    });

    it("offers time off even when nothing is scheduled yet", async () => {
      respond([]);
      renderPage();

      expect(
        await screen.findByRole("button", { name: /Time off/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("You are not scheduled for anything coming up."),
      ).toBeInTheDocument();
    });
  });

  it("surfaces a load failure with a next step", async () => {
    mockGetMyTeamAssignments.mockRejectedValue(new Error("nope"));
    renderPage();

    expect(
      await screen.findByText(/Could not load your schedule/),
    ).toBeInTheDocument();
  });
});
