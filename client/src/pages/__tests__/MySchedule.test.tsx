import { act, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../../store/store";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import MySchedule from "../MySchedule";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  getMyTeamAssignments,
  respondToMyAssignment,
  updateMyBlockoutDates,
} from "../../api/auth";
import { usePublicServiceFlow } from "../../services/usePublicServiceFlow";

jest.mock("../../api/auth", () => ({
  getMyTeamAssignments: jest.fn(),
  updateMyBlockoutDates: jest.fn(),
  respondToMyAssignment: jest.fn(),
  // showApiErrorToast narrows with `instanceof`, so the error path needs a real
  // class here rather than an undefined export.
  AuthApiError: class AuthApiError extends Error {
    status?: number;
    isReachabilityError = false;
  },
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
const mockRespondToMyAssignment = jest.mocked(respondToMyAssignment);
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

/** The write stamp the blockout save must echo back as its precondition. */
const STAMP = "2099-01-01T00:00:00.000Z";

const respond = (
  occurrences: unknown[],
  member: unknown = { memberId: "m1", updatedAt: STAMP },
) =>
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
    expect(
      screen.getByRole("navigation", { name: /My schedule service view/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Service plan" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /Schedule layout/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By position" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: /^Service plan$/i }));

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
    await user.click(screen.getByRole("tab", { name: /^Service plan$/i }));

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
      respond([occurrence()], {
        memberId: "m1",
        updatedAt: STAMP,
        blockoutDates: [away, second],
      });
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

      expect(mockUpdateMyBlockoutDates).toHaveBeenCalledWith(
        "church-1",
        [second],
        STAMP,
      );
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
      respond([occurrence()], {
        memberId: "m1",
        updatedAt: STAMP,
        blockoutDates: [over, ahead],
      });
      mockUpdateMyBlockoutDates.mockResolvedValue({
        success: true,
        member: { memberId: "m1", blockoutDates: [over] },
      } as unknown as Awaited<ReturnType<typeof updateMyBlockoutDates>>);
      renderPage();

      // The header counts what is ahead, not the whole history.
      expect(await screen.findByText("1 upcoming")).toBeInTheDocument();

      await expandTimeOff(user);

      // One editable row, for the upcoming trip only.
      const removeButtons = screen.getAllByRole("button", {
        name: /Remove blockout/i,
      });
      expect(removeButtons).toHaveLength(1);

      await user.click(removeButtons[0]);
      await user.click(screen.getByRole("button", { name: /Save time off/i }));

      expect(mockUpdateMyBlockoutDates).toHaveBeenCalledWith(
        "church-1",
        [over],
        STAMP,
      );
    });

    // Time off is collapsed by default, so without this the page contradicts
    // itself: the schedule shows you serving and nothing says you are away.
    it("marks a scheduled service the member has blocked out", async () => {
      const user = userEvent.setup();
      respond([occurrence()], { memberId: "m1", blockoutDates: [away] });
      renderPage();

      expect(
        await screen.findByRole("button", {
          name: /Open Sunday Gathering.*blocked out/i,
        }),
      ).toBeInTheDocument();

      // Opening the tile must not drop the warning it carried.
      await openFirstService(user);
      expect(
        screen.getByText(/marked yourself away/i),
      ).toBeInTheDocument();
    });

    it("leaves services outside a blockout unmarked", async () => {
      respond([occurrence()], {
        memberId: "m1",
        blockoutDates: [{ startDate: "2099-10-01", endDate: "2099-10-05" }],
      });
      renderPage();

      await screen.findByRole("button", { name: /Open Sunday Gathering/i });
      expect(
        screen.queryByRole("button", { name: /blocked out/i }),
      ).not.toBeInTheDocument();
    });

    // The write replaces the whole array, so a save built on a stale page would
    // silently discard whatever changed underneath it.
    it("pulls in the current record when a save is rejected as stale", async () => {
      const user = userEvent.setup();
      respond([occurrence()], {
        memberId: "m1",
        updatedAt: STAMP,
        blockoutDates: [away],
      });
      const conflict = Object.assign(new Error("Your time off changed"), {
        status: 409,
      });
      mockUpdateMyBlockoutDates.mockRejectedValue(conflict);
      renderPage();

      await expandTimeOff(user);
      await user.click(
        screen.getAllByRole("button", { name: /Remove blockout/i })[0],
      );
      await user.click(screen.getByRole("button", { name: /Save time off/i }));

      // Refetched so the reader is comparing against what is actually stored.
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
      // The draft survives — discarding an edit to report a conflict would
      // trade one kind of loss for another.
      expect(
        screen.getByRole("button", { name: /Save time off/i }),
      ).toBeEnabled();
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

  // Catching up on return rather than staying live: nobody watches this page,
  // but a PWA resumed days later would otherwise read a stale snapshot.
  describe("refresh on return", () => {
    const returnToPage = async (awayMs: number) => {
      const hidden = jest
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      hidden.mockReturnValue("visible");
      jest.setSystemTime(Date.now() + awayMs);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      hidden.mockRestore();
    };

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["performance"] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("refetches after a long absence but not a quick tab switch", async () => {
      respond([occurrence()]);
      renderPage();
      await screen.findByRole("button", { name: /Open Sunday Gathering/i });
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);

      await returnToPage(2_000);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);

      await returnToPage(60_000);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
    });

    // The editor stays mounted across a refresh. If its draft kept the old
    // snapshot it would read as edited, freeze further refreshes, and — worst —
    // save the stale dates back over the newer ones carrying the refreshed
    // write stamp, which the server's 409 guard would have no reason to reject.
    it("adopts refreshed blockouts instead of inventing an edit", async () => {
      const first = { startDate: "2099-09-06", endDate: "2099-09-06" };
      const second = { startDate: "2099-11-20", endDate: "2099-11-22" };
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP, blockoutDates: [first] },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValue({
          success: true,
          member: {
            memberId: "m1",
            updatedAt: "2099-02-02T00:00:00.000Z",
            blockoutDates: [first, second],
          },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      renderPage();

      expect(await screen.findByText("1 upcoming")).toBeInTheDocument();

      await returnToPage(60_000);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await user.click(screen.getByRole("button", { name: /Time off/i }));

      // The editor shows what came back, not the snapshot it opened with.
      expect(
        screen.getAllByRole("button", { name: /Remove blockout/i }),
      ).toHaveLength(2);
      // No user edit happened, so there is nothing to save.
      expect(screen.getByRole("button", { name: /Save time off/i })).toBeDisabled();

      // And the refresh is not frozen by a phantom dirty flag.
      await returnToPage(60_000);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(3);
    });

    it("leaves an open time off edit alone", async () => {
      respond([occurrence()], {
        memberId: "m1",
        updatedAt: STAMP,
        blockoutDates: [{ startDate: "2099-09-06", endDate: "2099-09-06" }],
      });
      renderPage();

      // userEvent needs the fake-timer advance function to resolve its waits.
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      await user.click(await screen.findByRole("button", { name: /Time off/i }));
      await user.click(
        screen.getAllByRole("button", { name: /Remove blockout/i })[0],
      );
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);

      await returnToPage(60_000);

      // Refetching would replace the draft with server state and lose the edit.
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);
    });
  });

  describe("accept and decline", () => {
    it("offers a response for an upcoming assignment and posts the answer", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockResolvedValue({
        success: true,
        response: "accepted",
      } as unknown as Awaited<ReturnType<typeof respondToMyAssignment>>);
      renderPage();

      await openFirstService(user);
      expect(screen.getByText("Needs your response")).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /Accept Director . Media/i }),
      );

      expect(mockRespondToMyAssignment).toHaveBeenCalledWith("church-1", {
        scheduleId: "sched-1",
        occurrenceId: `service-1@${FUTURE}`,
        cellKey: "pos-director::0",
        response: "accepted",
      });
      // Applied optimistically, so the tap reads as done straight away.
      expect(await screen.findByText("You accepted")).toBeInTheDocument();
    });

    it("shows an existing answer and still allows changing it", async () => {
      const user = userEvent.setup();
      respond([occurrence({ serving: [me({ response: "declined" }), other()] })]);
      mockRespondToMyAssignment.mockResolvedValue({
        success: true,
        response: "accepted",
      } as unknown as Awaited<ReturnType<typeof respondToMyAssignment>>);
      renderPage();

      await openFirstService(user);
      expect(screen.getByText("You declined")).toBeInTheDocument();

      // Answered rows state the decision rather than leaving two equal buttons,
      // which would read as though nothing had been recorded.
      expect(
        screen.queryByRole("button", { name: /Accept Director . Media/i }),
      ).not.toBeInTheDocument();

      // Changing your mind is normal and stays one click away; the alternative
      // is emailing the worship leader, which is what this replaces.
      await user.click(
        screen.getByRole("button", { name: /Change your response/i }),
      );
      await user.click(
        screen.getByRole("button", { name: /Accept Director . Media/i }),
      );

      expect(await screen.findByText("You accepted")).toBeInTheDocument();
      // And it collapses back rather than leaving the picker open.
      expect(
        screen.queryByRole("button", { name: /Accept Director . Media/i }),
      ).not.toBeInTheDocument();
    });

    it("refetches when the answer is rejected rather than reverting blindly", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockRejectedValue(
        Object.assign(new Error("That assignment changed"), { status: 409 }),
      );
      renderPage();

      await openFirstService(user);
      await user.click(
        screen.getByRole("button", { name: /Decline Director . Media/i }),
      );

      // The common failure is the slot moving to someone else, so the old
      // value is not the truth to go back to — the server is.
      await screen.findByText("Needs your response");
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
    });

    it("does not offer a response on a past service", async () => {
      const user = userEvent.setup();
      respond([
        occurrence({
          occurrenceId: `service-1@${PAST}`,
          date: PAST.slice(0, 10),
          startsAt: PAST,
          name: "Old Service",
        }),
      ]);
      renderPage();

      await user.click(
        await screen.findByRole("button", { name: /Show 1 past service/ }),
      );
      await user.click(screen.getByRole("button", { name: /Open Old Service/i }));

      expect(
        screen.queryByRole("button", { name: /^Accept/i }),
      ).not.toBeInTheDocument();
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
