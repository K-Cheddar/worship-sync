/* eslint-disable testing-library/no-node-access -- Compare the decorative icon SVG directly to verify its identity. */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../../store/store";
import userEvent from "@testing-library/user-event";
import type { ContextType } from "react";
import { PAGE_APPEARANCES } from "../pageAppearances";
import { getLucideIconInnerMarkup } from "../../test/lucideIconTestUtils";
import MySchedule from "../MySchedule";
import type { MyScheduleOperations, PersonalScheduleAccess } from "../myScheduleOperations";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  acceptPendingMyAssignments,
  getMyTeamAssignments,
  getMyVolunteerAvailability,
  respondToMyAssignment,
  updateMyBlockoutDates,
} from "../../api/auth";
import { usePublicServiceFlow } from "../../services/usePublicServiceFlow";

jest.mock("../../api/auth", () => ({
  acceptPendingMyAssignments: jest.fn(),
  getMyTeamAssignments: jest.fn(),
  updateMyBlockoutDates: jest.fn(),
  respondToMyAssignment: jest.fn(),
  acceptMyUnansweredAssignments: jest.fn(),
  getMyVolunteerAvailability: jest.fn().mockResolvedValue({ success: true, requests: [] }),
  submitMyVolunteerAvailability: jest.fn(),
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
const mockAcceptPendingMyAssignments = jest.mocked(acceptPendingMyAssignments);
const mockUpdateMyBlockoutDates = jest.mocked(updateMyBlockoutDates);
const mockRespondToMyAssignment = jest.mocked(respondToMyAssignment);
const mockGetMyVolunteerAvailability = jest.mocked(getMyVolunteerAvailability);
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

const deferred = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (error: unknown) => reject?.(error),
  };
};

// AppPageShell reads the scrollbar-width preference and renders the app menu,
// so the page needs the store and a router the way the real app provides them.
const pageElement = (role = "member", churchId = "church-1") => (
  <Provider store={store}>
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={
          {
            churchId,
            churchName: "Northside",
            role,
          } as ContextType<typeof GlobalInfoContext>
        }
      >
        <MySchedule />
      </GlobalInfoContext.Provider>
    </MemoryRouter>
  </Provider>
);

const renderPage = (role = "member", churchId = "church-1") =>
  render(pageElement(role, churchId));

const renderPersonalPage = (operations: MyScheduleOperations) =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <MySchedule access={{ churchId: "church-1", memberId: "m1", operations }} />
      </MemoryRouter>
    </Provider>,
  );

const openFirstService = async (user: ReturnType<typeof userEvent.setup>) => {
  const tile = await screen.findByRole("button", {
    name: /Open Sunday Gathering/i,
  });
  await user.click(tile);
};

it("retires pending bulk work when church changes with the same member and schedule IDs", async () => {
  const user = userEvent.setup();
  let finish!: (value: { success: boolean; results: [] }) => void;
  const pending = new Promise<{ success: boolean; results: [] }>((resolve) => { finish = resolve; });
  const makeAccess = (churchId: string): PersonalScheduleAccess => ({
    churchId, memberId: "m1", operations: {
      load: jest.fn().mockResolvedValue({ success: true, member: { memberId: "m1", updatedAt: STAMP },
        occurrences: [occurrence({ serving: [me({ response: "pending" })] })] }),
      respond: jest.fn(), saveBlockouts: jest.fn(),
      acceptUnanswered: jest.fn().mockReturnValue(pending),
    },
  });
  const first = makeAccess("church-a");
  const second = makeAccess("church-b");
  const view = (access: PersonalScheduleAccess) => <Provider store={store}><MemoryRouter><MySchedule access={access} /></MemoryRouter></Provider>;
  const { rerender } = render(view(first));
  await user.click(await screen.findByRole("button", { name: "Accept remaining assignments" }));
  expect(screen.getByRole("button", { name: /Accepting/i })).toBeDisabled();
  rerender(view(second));
  expect(await screen.findByRole("button", { name: "Accept remaining assignments" })).toBeEnabled();
  await act(async () => { finish({ success: true, results: [] }); });
  expect(first.operations.load).toHaveBeenCalledTimes(1);
  expect(second.operations.load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Accept remaining assignments" })).toBeEnabled();
});

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

  it("uses the shared schedule identity in its page header", () => {
    respond([]);
    renderPage();

    const title = screen.getByRole("heading", { name: "My schedule" });
    const titleIcon = title.querySelector("svg");
    expect(titleIcon?.innerHTML).toBe(
      getLucideIconInnerMarkup(PAGE_APPEARANCES.mySchedule.icon),
    );
    expect(titleIcon?.parentElement).toHaveClass(
      PAGE_APPEARANCES.mySchedule.iconColorClass,
    );
  });

  it("shows a schedule-shaped skeleton while the initial assignments load", async () => {
    const request = deferred<Awaited<ReturnType<typeof getMyTeamAssignments>>>();
    mockGetMyTeamAssignments.mockReturnValue(request.promise);
    renderPage();

    expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Loading your schedule" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getAllByTestId("my-schedule-loading-card")).toHaveLength(3);

    await act(async () => {
      request.resolve({
        success: true,
        member: { memberId: "m1", updatedAt: STAMP },
        occurrences: [occurrence()],
      } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      await request.promise;
    });

    expect(await screen.findByRole("button", { name: /Open Sunday Gathering/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading your schedule" })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("my-schedule-loading-card")).toHaveLength(0);
  });

  it("lists services as tiles with role and opens a detail view", async () => {
    const user = userEvent.setup();
    respond([occurrence()]);
    renderPage();

    expect(await screen.findByText("Director")).toBeInTheDocument();
    expect(screen.getByText("Media")).toHaveClass("text-[10px]");
    await openFirstService(user);

    expect(screen.getByRole("heading", { name: "Sunday Gathering" })).toBeInTheDocument();
    expect(screen.getAllByText("Director")).toHaveLength(2);
    expect(screen.getAllByText("Media").some((element) => element.classList.contains("text-[10px]"))).toBe(true);
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

  describe("accept pending", () => {
    const result = (overrides = {}) => ({
      success: true,
      newlyAccepted: 1,
      alreadyAccepted: 1,
      alreadyDeclined: 1,
      skipped: 0,
      failedScheduleCount: 0,
      schedules: [],
      authorizationChanged: false,
      hasMore: false,
      nextCursor: null,
      ...overrides,
    });

    it("counts only upcoming primary pending assignments and waits for the server before refreshing", async () => {
      const user = userEvent.setup();
      const assigned = occurrence({
        serving: [
          me(),
          me({ columnKey: "pos-director::1", response: "accepted" }),
          me({ columnKey: "pos-director::2", response: "declined" }),
          me({ columnKey: "pos-director::3", isPrimary: false }),
        ],
      });
      const accepted = occurrence({
        serving: [
          me({ response: "accepted" }),
          me({ columnKey: "pos-director::1", response: "accepted" }),
          me({ columnKey: "pos-director::2", response: "declined" }),
          me({ columnKey: "pos-director::3", isPrimary: false }),
        ],
      });
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [assigned],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [accepted],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      let resolveRequest: ((value: Awaited<ReturnType<typeof acceptPendingMyAssignments>>) => void) | undefined;
      mockAcceptPendingMyAssignments.mockReturnValue(
        new Promise((resolve) => { resolveRequest = resolve; }),
      );
      renderPage();

      expect(await screen.findByText("You have 1 assignment waiting for a response.")).toBeInTheDocument();
      const acceptAll = screen.getByRole("button", { name: /Accept remaining assignments/i });
      await user.click(acceptAll);

      expect(acceptAll).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent(/Accepting your pending assignments/i);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);
      await openFirstService(user);
      expect(screen.getByText("Needs your response")).toBeInTheDocument();
      expect(screen.getAllByText("Accepted")).toHaveLength(1);

      await act(async () => {
        resolveRequest?.(result() as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      });

      expect(await screen.findAllByText("Accepted")).toHaveLength(2);
      expect(mockAcceptPendingMyAssignments).toHaveBeenCalledWith("church-1", undefined);
    });

    it("continues paging when a background refresh runs during acceptance", async () => {
      jest.useFakeTimers({ doNotFake: ["performance"] });
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const accepted = occurrence({ serving: [me({ response: "accepted" }), other()] });
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [accepted],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      const firstPage = deferred<Awaited<ReturnType<typeof acceptPendingMyAssignments>>>();
      const secondPage = deferred<Awaited<ReturnType<typeof acceptPendingMyAssignments>>>();
      mockAcceptPendingMyAssignments
        .mockReturnValueOnce(firstPage.promise)
        .mockReturnValueOnce(secondPage.promise);
      renderPage();

      await screen.findByText("You have 1 assignment waiting for a response.");
      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));
      expect(mockAcceptPendingMyAssignments).toHaveBeenCalledTimes(1);

      const visibility = jest
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      visibility.mockReturnValue("visible");
      jest.advanceTimersByTime(60_000);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      visibility.mockRestore();

      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: /Accepting/i })).toBeDisabled();

      await act(async () => {
        firstPage.resolve(result({
          newlyAccepted: 1,
          hasMore: true,
          nextCursor: "schedule-2",
        }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      });
      expect(mockAcceptPendingMyAssignments).toHaveBeenNthCalledWith(
        2,
        "church-1",
        "schedule-2",
      );

      await act(async () => {
        secondPage.resolve(result({ newlyAccepted: 1 }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      });
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Accepted 2 assignments.",
      );
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });

    it("retires old acceptance UI on a church switch without blocking the new church", async () => {
      const user = userEvent.setup();
      const churchARequest = deferred<Awaited<ReturnType<typeof acceptPendingMyAssignments>>>();
      const churchBRequest = deferred<Awaited<ReturnType<typeof acceptPendingMyAssignments>>>();
      const churchAAssignments = occurrence();
      const churchBAssignments = occurrence({
        occurrenceId: `church-b@${FUTURE}`,
        name: "Church B Gathering",
      });
      const churchBAccepted = occurrence({
        occurrenceId: `church-b@${FUTURE}`,
        name: "Church B Gathering",
        serving: [me({ response: "accepted" }), other()],
      });
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [churchAAssignments],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m2", updatedAt: STAMP },
          occurrences: [churchBAssignments],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m2", updatedAt: STAMP },
          occurrences: [churchBAccepted],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      mockAcceptPendingMyAssignments
        .mockReturnValueOnce(churchARequest.promise)
        .mockReturnValueOnce(churchBRequest.promise);
      const view = renderPage();

      await screen.findByText("You have 1 assignment waiting for a response.");
      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));
      view.rerender(pageElement("member", "church-2"));

      await screen.findByRole("button", { name: /Open Church B Gathering/i });
      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));
      expect(mockAcceptPendingMyAssignments).toHaveBeenNthCalledWith(
        2,
        "church-2",
        undefined,
      );

      await act(async () => {
        churchARequest.resolve(result({ newlyAccepted: 99 }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      });
      expect(screen.getByRole("status")).toHaveTextContent(/Accepting your pending assignments/i);
      expect(screen.queryByText(/Accepted 99 assignments/)).not.toBeInTheDocument();

      await act(async () => {
        churchBRequest.resolve(result({ newlyAccepted: 1 }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      });

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Accepted 1 assignment.",
      );
      await waitFor(() =>
        expect(screen.queryByText(/Accepting your pending assignments/i)).not.toBeInTheDocument(),
      );
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(3);
    });

    it("keeps completed pages visible after a later page fails and retries from pending work", async () => {
      const user = userEvent.setup();
      const assigned = occurrence();
      const accepted = occurrence({ serving: [me({ response: "accepted" }), other()] });
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [assigned],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [assigned],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP },
          occurrences: [accepted],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      mockAcceptPendingMyAssignments
        .mockResolvedValueOnce(result({
          newlyAccepted: 1,
          hasMore: true,
          nextCursor: "schedule-2",
        }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>)
        .mockRejectedValueOnce(new Error("network interrupted"))
        .mockResolvedValueOnce(result({ newlyAccepted: 1 }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      renderPage();

      await screen.findByText("You have 1 assignment waiting for a response.");
      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        /Accepted 1 assignment.*Could not confirm the remaining assignments/,
      );
      await waitFor(() =>
        expect(screen.queryByText(/Accepting your pending assignments/i)).not.toBeInTheDocument(),
      );
      expect(mockAcceptPendingMyAssignments.mock.calls).toEqual([
        ["church-1", undefined],
        ["church-1", "schedule-2"],
      ]);

      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));
      expect(mockAcceptPendingMyAssignments).toHaveBeenNthCalledWith(
        3,
        "church-1",
        undefined,
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Accepted 1 assignment.",
      );
      await waitFor(() =>
        expect(screen.queryByText(/Accepting your pending assignments/i)).not.toBeInTheDocument(),
      );
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(3);
    });

    it("does not request later pages after the page unmounts", async () => {
      const user = userEvent.setup();
      const firstPage = deferred<Awaited<ReturnType<typeof acceptPendingMyAssignments>>>();
      respond([occurrence()]);
      mockAcceptPendingMyAssignments.mockReturnValue(firstPage.promise);
      const view = renderPage();

      await screen.findByText("You have 1 assignment waiting for a response.");
      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));
      view.unmount();

      await act(async () => {
        firstPage.resolve(result({
          newlyAccepted: 1,
          hasMore: true,
          nextCursor: "schedule-2",
        }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      });
      expect(mockAcceptPendingMyAssignments).toHaveBeenCalledTimes(1);
    });

    it("keeps the global action independent of search filters and summarizes partial completion", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      mockAcceptPendingMyAssignments.mockResolvedValue(result({
        newlyAccepted: 1,
        alreadyAccepted: 1,
        alreadyDeclined: 1,
        skipped: 1,
        failedScheduleCount: 1,
      }) as Awaited<ReturnType<typeof acceptPendingMyAssignments>>);
      renderPage();

      expect(await screen.findByText("You have 1 assignment waiting for a response.")).toBeInTheDocument();
      await user.type(screen.getByLabelText(/Search/i), "not a service");
      expect(screen.queryByRole("button", { name: /Open Sunday Gathering/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));

      expect(mockAcceptPendingMyAssignments).toHaveBeenCalledWith("church-1", undefined);
      expect(await screen.findByRole("status")).toHaveTextContent(/Some assignments couldn't be processed/i);
      expect(screen.getByRole("status")).toHaveTextContent(/already accepted/i);
      expect(screen.getByRole("status")).toHaveTextContent(/declined and left unchanged/i);
      expect(screen.getByRole("status")).toHaveTextContent(/retry/i);
    });

    it("does not show the bulk action for past, answered, or shadow-only slots", async () => {
      respond([
        occurrence({
          serving: [
            me({ response: "accepted" }),
            me({ columnKey: "shadow", isPrimary: false }),
          ],
        }),
        occurrence({
          occurrenceId: `service-1@${PAST}`,
          startsAt: PAST,
          date: PAST.slice(0, 10),
        }),
      ]);
      renderPage();

      await screen.findByRole("button", { name: /Open Sunday Gathering/i });
      expect(screen.queryByRole("button", { name: /Accept remaining assignments/i })).not.toBeInTheDocument();
      expect(mockAcceptPendingMyAssignments).not.toHaveBeenCalled();
    });

    it("preserves an open time-off edit while refreshing assignments after acceptance", async () => {
      const user = userEvent.setup();
      const existing = { startDate: "2099-09-06", endDate: "2099-09-06", notes: "Existing" };
      const serverUpdate = {
        startDate: "2099-11-20",
        endDate: "2099-11-20",
        notes: "Added elsewhere",
      };
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: STAMP, blockoutDates: [existing] },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: { memberId: "m1", updatedAt: "newer", blockoutDates: [existing, serverUpdate] },
          occurrences: [occurrence({ serving: [me({ response: "accepted" }), other()] })],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      mockAcceptPendingMyAssignments.mockResolvedValue(result());
      renderPage();

      await user.click(await screen.findByRole("button", { name: /Time off/i }));
      await user.click(screen.getByRole("button", { name: /Remove blockout/i }));
      expect(screen.getByRole("button", { name: /Save time off/i })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: /Accept remaining assignments/i }));

      expect(await screen.findByText(/Accepted 1 assignment/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Save time off/i })).toBeDisabled();
      expect(screen.getByText(/Your saved information changed elsewhere/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Remove blockout/i })).not.toBeInTheDocument();
    });
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

  it("lets a volunteer choose each saved plan for one combined service occurrence", async () => {
    const user = userEvent.setup();
    const plans = [
      {
        planId: "plan-worship",
        serviceId: "worship",
        name: "Worship plan",
        published: false,
        sections: [{ name: "Songs", elements: [{ type: "song", title: "First service song", startTime: "", durationSeconds: 180 }] }],
      },
      {
        planId: "plan-evening",
        serviceId: "evening",
        name: "Evening plan",
        published: true,
        publicUrls: { team: "https://example.test/#/services/evening-token" },
        sections: [{ name: "Response", elements: [{ type: "song", title: "Second service song", startTime: "", durationSeconds: 210 }] }],
      },
    ];
    respond([occurrence({
      occurrenceId: "group:combined@2099-09-06",
      serviceIds: ["worship", "evening"],
      plans,
      plan: plans[0],
    })]);
    renderPage();

    expect((await screen.findAllByRole("button", { name: /Open Sunday Gathering/i })).length).toBe(1);
    await openFirstService(user);
    await user.click(screen.getByRole("tab", { name: /^Service plan$/i }));
    expect(screen.getByText("First service song")).toBeInTheDocument();
    expect(mockUsePublicServiceFlow).toHaveBeenLastCalledWith("");

    await user.click(screen.getByRole("combobox", { name: /Service plan/i }));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Evening plan" }));

    expect(screen.getByText("Second service song")).toBeInTheDocument();
    expect(screen.queryByText("First service song")).not.toBeInTheDocument();
    expect(mockUsePublicServiceFlow).toHaveBeenLastCalledWith("evening-token");
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

    it("locks the Time Off draft while its save is pending", async () => {
      const user = userEvent.setup();
      const saveRequest = deferred<Awaited<ReturnType<typeof updateMyBlockoutDates>>>();
      respond([occurrence()], {
        memberId: "m1",
        updatedAt: STAMP,
        blockoutDates: [away],
      });
      mockUpdateMyBlockoutDates.mockReturnValue(saveRequest.promise);
      renderPage();

      await expandTimeOff(user);
      await user.click(screen.getByRole("button", { name: /Remove blockout/i }));
      await user.click(screen.getByRole("button", { name: /Save time off/i }));

      expect(screen.getByRole("button", { name: /Add single day/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Add date range/i })).toBeDisabled();

      await act(async () => {
        saveRequest.resolve({
          success: true,
          member: { memberId: "m1", updatedAt: "2099-02-02T00:00:00.000Z", blockoutDates: [] },
        } as unknown as Awaited<ReturnType<typeof updateMyBlockoutDates>>);
      });
      await screen.findByRole("button", { name: /^Save time off$/i });
      expect(mockUpdateMyBlockoutDates).toHaveBeenCalledTimes(1);
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

    it("lets the member reveal past dates when needed", async () => {
      const user = userEvent.setup();
      const over = { startDate: "2000-01-01", endDate: "2000-01-05" };
      const ahead = { startDate: "2099-10-01", endDate: "2099-10-05" };
      respond([occurrence()], {
        memberId: "m1",
        blockoutDates: [over, ahead],
      });
      renderPage();

      await expandTimeOff(user);
      expect(
        screen.getByRole("button", { name: "Show 1 past date" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: /Remove blockout/i }),
      ).toHaveLength(1);

      await user.click(
        screen.getByRole("button", { name: "Show 1 past date" }),
      );
      expect(
        screen.getAllByRole("button", { name: /Remove blockout/i }),
      ).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Hide past dates" }),
      ).toBeInTheDocument();
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
    it("keeps a dirty draft through a 409 and requires explicit reconciliation", async () => {
      const user = userEvent.setup();
      const otherDraftDate = {
        startDate: "2099-10-01",
        endDate: "2099-10-05",
      };
      const adminDate = {
        startDate: "2099-11-20",
        endDate: "2099-11-20",
        notes: "Added by your team lead",
      };
      const latestStamp = "2099-02-01T00:00:00.000Z";
      const savedStamp = "2099-03-01T00:00:00.000Z";
      mockGetMyTeamAssignments
        .mockResolvedValueOnce({
          success: true,
          member: {
            memberId: "m1",
            updatedAt: STAMP,
            blockoutDates: [away, otherDraftDate],
          },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>)
        .mockResolvedValueOnce({
          success: true,
          member: {
            memberId: "m1",
            updatedAt: latestStamp,
            blockoutDates: [away, otherDraftDate, adminDate],
          },
          occurrences: [occurrence()],
        } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      const conflict = Object.assign(new Error("Your time off changed"), {
        status: 409,
      });
      mockUpdateMyBlockoutDates
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({
          success: true,
          member: {
            memberId: "m1",
            updatedAt: savedStamp,
            blockoutDates: [otherDraftDate],
          },
        } as unknown as Awaited<ReturnType<typeof updateMyBlockoutDates>>)
        .mockResolvedValueOnce({
          success: true,
          member: {
            memberId: "m1",
            updatedAt: "2099-04-01T00:00:00.000Z",
            blockoutDates: [],
          },
        } as unknown as Awaited<ReturnType<typeof updateMyBlockoutDates>>);
      renderPage();

      await expandTimeOff(user);
      await user.click(
        screen.getAllByRole("button", { name: /Remove blockout/i })[0],
      );
      await user.click(screen.getByRole("button", { name: /Save time off/i }));
      await screen.findByRole("alert");

      // Refetched so the reader is comparing against what is actually stored.
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
      // The draft survives — discarding an edit to report a conflict would
      // trade one kind of loss for another.
      expect(
        screen.getByRole("button", { name: /Save time off/i }),
      ).toBeDisabled();

      expect(screen.getByText(/Your unsaved dates are kept/)).toBeInTheDocument();

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
    it("offers a response on the service card and posts the answer without opening details", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockResolvedValue({
        success: true,
        response: "accepted",
      } as unknown as Awaited<ReturnType<typeof respondToMyAssignment>>);
      renderPage();

      await user.click(await screen.findByRole("button", { name: /Accept Director . Media/i }));

      expect(mockRespondToMyAssignment).toHaveBeenCalledWith("church-1", {
        scheduleId: "sched-1",
        occurrenceId: `service-1@${FUTURE}`,
        cellKey: "pos-director::0",
        response: "accepted",
      });
      // The immediate server confirmation closes the response picker.
      expect(await screen.findByText("Accepted")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Sunday Gathering" })).not.toBeInTheDocument();
    });

    it("keeps the persisted answer and pending count unchanged while a response is saving", async () => {
      const user = userEvent.setup();
      const pendingWrite = deferred<Awaited<ReturnType<typeof respondToMyAssignment>>>();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockReturnValueOnce(pendingWrite.promise);
      renderPage();

      await user.click(await screen.findByRole("button", { name: /Accept Director . Media/i }));

      expect(screen.getByRole("status")).toHaveTextContent("Saving");
      expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
      expect(screen.getByText("You have 1 assignment waiting for a response.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Accept remaining assignments/i })).toBeDisabled();
      expect(mockRespondToMyAssignment).toHaveBeenCalledTimes(1);

      await act(async () => {
        pendingWrite.resolve({ success: true, response: "accepted" } as Awaited<ReturnType<typeof respondToMyAssignment>>);
      });

      expect(await screen.findByText("Accepted")).toBeInTheDocument();
      expect(screen.queryByText("You have 1 assignment waiting for a response.")).not.toBeInTheDocument();
    });

    it("keeps an uncertain response separate and retries only the refresh", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockRejectedValueOnce(new Error("The acknowledgement was lost"));
      renderPage();

      const accept = await screen.findByRole("button", { name: /Accept Director . Media/i });
      mockGetMyTeamAssignments.mockRejectedValueOnce(new Error("Schedule refresh failed"));
      await user.click(accept);

      expect(await screen.findByText(/Couldn't confirm your response\. You tried to accept this assignment\./i)).toBeInTheDocument();
      const retry = screen.getByRole("button", { name: /Retry refresh for your response/i });
      expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
      expect(screen.getByText("You have 1 assignment waiting for a response.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Accept remaining assignments/i })).toBeDisabled();
      expect(mockRespondToMyAssignment).toHaveBeenCalledTimes(1);

      await user.click(retry);

      expect(await screen.findByRole("button", { name: /Accept Director . Media/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Retry refresh for your response/i })).not.toBeInTheDocument();
      expect(screen.getByText("You have 1 assignment waiting for a response.")).toBeInTheDocument();
      expect(mockRespondToMyAssignment).toHaveBeenCalledTimes(1);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(3);
    });

    it("treats an unexpected success body as unconfirmed until the schedule is read", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      renderPage();

      const accept = await screen.findByRole("button", { name: /Accept Director . Media/i });
      mockRespondToMyAssignment.mockResolvedValueOnce({
        success: false,
        response: "accepted",
      } as unknown as Awaited<ReturnType<typeof respondToMyAssignment>>);
      mockGetMyTeamAssignments.mockResolvedValueOnce({
        success: true,
        member: { memberId: "m1", updatedAt: STAMP },
        occurrences: [occurrence()],
      } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);

      await user.click(accept);

      expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Accept Director . Media/i })).toBeInTheDocument();
      expect(screen.getByText("You have 1 assignment waiting for a response.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Retry refresh/i })).not.toBeInTheDocument();
      expect(mockRespondToMyAssignment).toHaveBeenCalledTimes(1);
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
    });

    it("confirms a lost acknowledgement from the refreshed schedule without resubmitting", async () => {
      const user = userEvent.setup();
      respond([occurrence()]);
      renderPage();

      const accept = await screen.findByRole("button", { name: /Accept Director . Media/i });
      mockRespondToMyAssignment.mockRejectedValueOnce(new Error("The acknowledgement was lost"));
      mockGetMyTeamAssignments.mockResolvedValueOnce({
        success: true,
        member: { memberId: "m1", updatedAt: STAMP },
        occurrences: [occurrence({ serving: [me({ response: "accepted" }), other()] })],
      } as unknown as Awaited<ReturnType<typeof getMyTeamAssignments>>);
      await user.click(accept);

      expect(await screen.findByText("Accepted")).toBeInTheDocument();
      expect(screen.queryByText("You have 1 assignment waiting for a response.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Retry refresh/i })).not.toBeInTheDocument();
      expect(mockRespondToMyAssignment).toHaveBeenCalledTimes(1);
    });

    it("uses the same lost-ack readback flow for personal-link access", async () => {
      const user = userEvent.setup();
      const personalOperations: MyScheduleOperations = {
        load: jest.fn()
          .mockResolvedValueOnce({ success: true, member: { memberId: "m1", updatedAt: STAMP }, occurrences: [occurrence()] })
          .mockResolvedValueOnce({ success: true, member: { memberId: "m1", updatedAt: STAMP }, occurrences: [occurrence({ serving: [me({ response: "declined" }), other()] })] }),
        respond: jest.fn().mockRejectedValueOnce(new Error("The acknowledgement was lost")),
        saveBlockouts: jest.fn(),
        acceptUnanswered: jest.fn(),
      };
      renderPersonalPage(personalOperations);

      await user.click(await screen.findByRole("button", { name: /Decline Director . Media/i }));

      expect(await screen.findByText("Declined")).toBeInTheDocument();
      expect(personalOperations.respond).toHaveBeenCalledTimes(1);
      expect(personalOperations.load).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("button", { name: /Retry refresh/i })).not.toBeInTheDocument();
    });

    it("does not apply an old church response after the volunteer identity changes", async () => {
      const user = userEvent.setup();
      const pendingWrite = deferred<Awaited<ReturnType<typeof respondToMyAssignment>>>();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockReturnValueOnce(pendingWrite.promise);
      const view = renderPage("member", "church-1");

      await user.click(await screen.findByRole("button", { name: /Accept Director . Media/i }));
      view.rerender(pageElement("member", "church-2"));
      const newChurchAnswer = await screen.findByRole("button", { name: /Accept Director . Media/i });

      await act(async () => {
        pendingWrite.resolve({ success: true, response: "accepted" } as Awaited<ReturnType<typeof respondToMyAssignment>>);
      });

      expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
      expect(newChurchAnswer).toBeInTheDocument();
      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(2);
      expect(mockRespondToMyAssignment).toHaveBeenCalledWith("church-1", expect.objectContaining({ response: "accepted" }));
    });

    it("does not start reconciliation after the schedule view unmounts", async () => {
      const user = userEvent.setup();
      const pendingWrite = deferred<Awaited<ReturnType<typeof respondToMyAssignment>>>();
      respond([occurrence()]);
      mockRespondToMyAssignment.mockReturnValueOnce(pendingWrite.promise);
      const view = renderPage();

      await user.click(await screen.findByRole("button", { name: /Accept Director . Media/i }));
      view.unmount();

      await act(async () => {
        pendingWrite.resolve({ success: true, response: "accepted" } as Awaited<ReturnType<typeof respondToMyAssignment>>);
      });

      expect(mockGetMyTeamAssignments).toHaveBeenCalledTimes(1);
    });

    it("shows only the volunteer's real assigned positions and teams", async () => {
      const user = userEvent.setup();
      const secondAssignment = me({
        scheduleId: "sched-2",
        teamId: "team-audio",
        teamName: "Audio",
        positionId: "pos-audio",
        positionName: "Audio Engineer",
        columnKey: "pos-audio::0",
      });
      const unrelatedAssignment = other({ teamId: "team-worship", teamName: "Worship", positionName: "Singer" });
      respond([occurrence({ serving: [me(), secondAssignment, unrelatedAssignment] })]);
      renderPage();

      expect(await screen.findByText("Media")).toHaveClass("text-[10px]");
      expect(screen.getByText("Director")).toHaveClass("text-[13px]", "sm:text-sm", "font-medium", "whitespace-normal", "break-words");
      const assignmentCard = screen.getByRole("article");
      expect(within(assignmentCard).getByText("Audio")).toHaveClass("text-[10px]");
      expect(within(assignmentCard).getByText("Audio Engineer")).toBeInTheDocument();
      expect(within(assignmentCard).queryByText("Singer")).not.toBeInTheDocument();
      expect(within(assignmentCard).queryByText("Worship")).not.toBeInTheDocument();
      expect(
        within(assignmentCard).getAllByText(/^(Media|Director)$/)
          .map((element) => element.textContent),
      ).toEqual(["Media", "Director"]);
      const openService = screen.getByRole("button", { name: /Open Sunday Gathering/i });
      expect(openService).toHaveClass("items-center", "gap-2", "w-full");
      expect(screen.getByRole("list", { name: "My scheduled services" })).toHaveClass(
        "grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))]",
        "max-w-[90rem]",
      );
      expect(screen.getByText("6")).toHaveClass("text-[21px]");

      mockRespondToMyAssignment.mockResolvedValue({
        success: true,
        response: "accepted",
      } as unknown as Awaited<ReturnType<typeof respondToMyAssignment>>);
      await user.click(screen.getByRole("button", { name: /Accept Audio Engineer . Audio/i }));
      expect(mockRespondToMyAssignment).toHaveBeenCalledWith("church-1", {
        scheduleId: "sched-2",
        occurrenceId: `service-1@${FUTURE}`,
        cellKey: "pos-audio::0",
        response: "accepted",
      });
      expect(await screen.findByText("Accepted")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Accept Director . Media/i })).toBeInTheDocument();

      const teamFilter = screen.getByRole("combobox", { name: /Team/i });
      await user.click(teamFilter);
      expect(screen.getByRole("option", { name: "Media" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Audio" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Worship" })).not.toBeInTheDocument();
      expect(mockGetMyVolunteerAvailability).not.toHaveBeenCalled();
    });

    it("keeps plan availability secondary to volunteer response status", async () => {
      const earlierStartsAt = "2099-09-05T15:00:00.000Z";
      respond([
        occurrence({
          occurrenceId: `earlier@${earlierStartsAt}`,
          name: "Earlier Service",
          date: earlierStartsAt.slice(0, 10),
          startsAt: earlierStartsAt,
        }),
        occurrence({ plan: { planId: "plan-1", name: "Sunday Gathering", sections: [] } }),
      ]);
      renderPage();

      const openService = await screen.findByRole("button", { name: /Open Sunday Gathering.*service plan available/i });
      const card = openService.parentElement;
      expect(card).not.toBeNull();
      expect(card).toHaveClass("border-gray-600/70");
      expect(card).not.toHaveClass("border-emerald-500/30");
      expect(card).toHaveClass(
        "has-[>button:hover]:border-orange-400/35",
        "has-[>button:focus-visible]:border-orange-400/35",
      );
      expect(openService).toHaveAccessibleName(/service plan available/i);
      expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
    });

    it("shows an existing answer and still allows changing it", async () => {
      const user = userEvent.setup();
      respond([occurrence({ serving: [me({ response: "declined" }), other()] })]);
      mockRespondToMyAssignment.mockResolvedValue({
        success: true,
        response: "accepted",
      } as unknown as Awaited<ReturnType<typeof respondToMyAssignment>>);
      renderPage();

      const declined = await screen.findByText("Declined");
      const position = screen.getByText("Director");
      expect(position.parentElement).toHaveClass("flex-nowrap", "items-center");
      expect(position.parentElement).toContainElement(declined);
      expect(declined).toHaveClass("bg-red-800", "text-white");

      // Answered cards state the decision rather than leaving two equal
      // buttons, which would read as though nothing had been recorded.
      expect(
        screen.queryByRole("button", { name: /Accept Director . Media/i }),
      ).not.toBeInTheDocument();

      // Changing your mind is one click away on the card.
      await user.click(
        screen.getByRole("button", { name: /Change your response/i }),
      );
      await user.click(
        screen.getByRole("button", { name: /Accept Director . Media/i }),
      );

      const accepted = await screen.findByText("Accepted");
      expect(position.parentElement).toHaveClass("flex-nowrap", "items-center");
      expect(position.parentElement).toContainElement(accepted);
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
      await user.click(screen.getByRole("button", { name: /Decline Director . Media/i }));

      // The common failure is the slot moving to someone else, so the old
      // value is not the truth to go back to — the server is.
      await screen.findByRole("button", { name: /Accept Director . Media/i });
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
        serving: [me({ response: "declined" }), other()],
        }),
      ]);
      renderPage();

      await user.click(
        await screen.findByRole("button", { name: /Show 1 past service/ }),
      );
      await user.click(screen.getByRole("button", { name: /Open Old Service/i }));

      expect(
        screen.queryByRole("button", { name: /^Accept Director/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Decline Director/i })).not.toBeInTheDocument();
      expect(screen.getByText("Declined")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Change your response/i })).not.toBeInTheDocument();
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
