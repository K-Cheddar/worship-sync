import React, { type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastContext } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import { getTeamsBootstrap } from "../../../api/auth";
import { useTeamsPageState } from "./useTeamsPageState";

let mockState: unknown;
jest.mock("../../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../../api/auth", () => ({
  getTeamsBootstrap: jest.fn(),
  getTeamScheduleDetail: jest.fn(),
  reorderTeamPositions: jest.fn(),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    public url: string,
    public options?: { withCredentials?: boolean },
  ) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

const emptyBootstrap = {
  success: true,
  members: [],
  positions: [],
  teams: [],
  schedules: [],
};

const mockGetTeamsBootstrap = jest.mocked(getTeamsBootstrap);
const originalEventSource = (global as { EventSource?: unknown }).EventSource;

const emitFocus = () => act(() => window.dispatchEvent(new Event("focus")));
const emitVisibilityChange = () =>
  act(() => document.dispatchEvent(new Event("visibilitychange")));
const flushMicrotasks = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("useTeamsPageState bootstrap recovery", () => {
  let churchId: string;

  const renderPageState = () =>
    renderHook(() => useTeamsPageState(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({ churchId }) as React.ContextType<
              typeof GlobalInfoContext
            >
          }
        >
          <ToastContext.Provider
            value={{
              showToast: jest.fn(() => "toast"),
              updateToast: jest.fn(),
              removeToast: jest.fn(),
            }}
          >
            {children}
          </ToastContext.Provider>
        </GlobalInfoContext.Provider>
      ),
    });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    churchId = "church-1";
    mockState = {
      undoable: { present: { serviceTimes: { list: [] } } },
    };
    MockEventSource.instances = [];
    (global as { EventSource?: unknown }).EventSource =
      MockEventSource as unknown as typeof EventSource;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    mockGetTeamsBootstrap.mockReset();
    mockGetTeamsBootstrap.mockResolvedValue(emptyBootstrap as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    (global as { EventSource?: unknown }).EventSource = originalEventSource;
  });

  it("loads once initially and ignores fresh focus and visibility events", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    act(() => MockEventSource.instances[0].onopen?.());
    emitFocus();
    emitVisibilityChange();
    emitFocus();
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("performs one bootstrap after the five-minute freshness window", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    act(() => MockEventSource.instances[0].onopen?.());
    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));

    emitFocus();
    emitVisibilityChange();
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("counts an unchanged recovery response as a fresh validation", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    const source = MockEventSource.instances[0];
    act(() => source.onopen?.());
    act(() => jest.advanceTimersByTime(4 * 60 * 1000));
    act(() => source.onerror?.());
    act(() => source.onopen?.());
    await flushMicrotasks();

    act(() => jest.advanceTimersByTime(2 * 60 * 1000));
    emitFocus();
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("recovers once after a real disconnect and reconnect, not initial open", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    const source = MockEventSource.instances[0];

    act(() => source.onopen?.());
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    act(() => source.onerror?.());
    act(() => {
      source.onopen?.();
      source.onopen?.();
    });
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("uses stale age rather than every focus when EventSource is unavailable", async () => {
    (global as { EventSource?: unknown }).EventSource = undefined;
    const { unmount } = renderPageState();
    await flushMicrotasks();

    emitFocus();
    emitVisibilityChange();
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    emitFocus();
    emitVisibilityChange();
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("does not mark a failed recovery as a successful validation", async () => {
    const logError = jest.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderPageState();
    await flushMicrotasks();
    act(() => MockEventSource.instances[0].onopen?.());
    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));

    mockGetTeamsBootstrap.mockRejectedValueOnce(new Error("offline"));
    emitFocus();
    await flushMicrotasks();
    emitFocus();
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(3);
    logError.mockRestore();
    unmount();
  });

  it("defers reconnect recovery while a teams save is in flight", async () => {
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    const source = MockEventSource.instances[0];
    act(() => source.onopen?.());
    const localTeam = {
      teamId: "local-team",
      churchId: "church-1",
      name: "Local team",
    };
    act(() => {
      result.current.upsertData("teams", "teamId", localTeam as never);
    });

    let settleSave!: () => void;
    const save = new Promise<void>((resolve) => {
      settleSave = resolve;
    });
    act(() => {
      void result.current.trackTeamsSave(save);
    });
    act(() => source.onerror?.());
    act(() => source.onopen?.());
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleSave();
      await save;
    });
    mockGetTeamsBootstrap.mockResolvedValue({
      ...emptyBootstrap,
      teams: [localTeam],
    } as never);
    act(() => jest.advanceTimersByTime(LOCAL_EDIT_COOLDOWN_MS_FOR_TEST));
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.teams).toEqual([localTeam]);
    unmount();
  });

  it("rejects the prior church response and requests the new church after switching", async () => {
    let resolveFirst!: (value: typeof emptyBootstrap) => void;
    mockGetTeamsBootstrap.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }) as never,
    );
    const { result, rerender, unmount } = renderPageState();

    churchId = "church-2";
    rerender();
    await flushMicrotasks();
    await act(async () => {
      resolveFirst({
        ...emptyBootstrap,
        teams: [{ teamId: "old-team", churchId: "church-1", name: "Old" }],
      } as never);
    });

    act(() => MockEventSource.instances[1].onopen?.());
    emitFocus();
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(mockGetTeamsBootstrap).toHaveBeenCalledWith("church-1");
    expect(mockGetTeamsBootstrap).toHaveBeenCalledWith("church-2");
    expect(result.current.pageData.teams).toEqual([]);
    unmount();
  });
});

const LOCAL_EDIT_COOLDOWN_MS_FOR_TEST = 3000;
