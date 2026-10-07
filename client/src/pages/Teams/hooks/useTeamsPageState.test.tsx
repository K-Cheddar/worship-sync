import React, { type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastContext } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import { getTeamScheduleDetail, getTeamsBootstrap, reorderTeamPositions } from "../../../api/auth";
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
const mockGetTeamScheduleDetail = jest.mocked(getTeamScheduleDetail);
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
  let canUseTeamsLiveSync: boolean;

  const renderPageState = (
    onTemplateEvent?: Parameters<typeof useTeamsPageState>[0],
    onReconnect?: Parameters<typeof useTeamsPageState>[1],
    contextOverrides: Record<string, unknown> = {},
  ) =>
    renderHook(() => useTeamsPageState(onTemplateEvent, onReconnect), {
      wrapper: ({ children }: PropsWithChildren) => (
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({ churchId, canUseTeamsLiveSync, ...contextOverrides }) as React.ContextType<
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
    canUseTeamsLiveSync = true;
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
    mockGetTeamScheduleDetail.mockReset();
    mockGetTeamsBootstrap.mockResolvedValue(emptyBootstrap as never);
    window.localStorage.clear();
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

  it("reconciles a removed sole-Team member and clears editability through the authoritative bootstrap", async () => {
    const kevin = {
      memberId: "kevin", churchId: "church-1", firstName: "Kevin", lastName: "Singer",
      email: "kevin-private@example.test", phoneNumber: "+15555550123", notes: "private",
      positionIds: ["worship-position"], blockoutDates: [],
    };
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        editableMemberIds: ["kevin"],
        members: [kevin],
        teams: [{ teamId: "worship", name: "Worship", memberIds: ["kevin"] }],
      } as never)
      .mockResolvedValueOnce({ ...emptyBootstrap, editableMemberIds: [], teams: [] } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    expect(result.current.pageData.members[0].email).toBe("kevin-private@example.test");
    expect(result.current.editableMemberIds.has("kevin")).toBe(true);

    act(() => {
      result.current.removeData("members", "memberId", "kevin");
      result.current.invalidateMemberEditability("kevin");
    });
    expect(result.current.pageData.members).toEqual([]);
    expect(result.current.editableMemberIds.has("kevin")).toBe(false);

    await act(async () => result.current.reconcileTeamsProjection());
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.members).toEqual([]);
    expect(result.current.editableMemberIds.has("kevin")).toBe(false);
    unmount();
  });

  it("keeps a shared member visible as read-only after removing the editable Team", async () => {
    const kevin = {
      memberId: "kevin", churchId: "church-1", firstName: "Kevin", lastName: "Singer",
      email: "kevin-private@example.test", notes: "Worship only private metadata",
      positionIds: ["worship-position", "av-position"], blockoutDates: [],
    };
    const safeKevin = { memberId: "kevin", churchId: "church-1", firstName: "Kevin", lastName: "Singer", positionIds: [], blockoutDates: [] };
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        editableMemberIds: ["kevin"], members: [kevin],
        teams: [
          { teamId: "worship", name: "Worship", memberIds: ["kevin"] },
          { teamId: "av", name: "AV", memberIds: ["kevin"] },
        ],
      } as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        editableMemberIds: [], members: [{ ...safeKevin, positionIds: ["av-position"] }],
        teams: [{ teamId: "av", name: "AV", memberIds: ["kevin"] }],
      } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();

    act(() => {
      result.current.upsertData("teams", "teamId", { teamId: "worship", name: "Worship", memberIds: [] } as never);
      result.current.upsertData("members", "memberId", safeKevin as never);
      result.current.invalidateMemberEditability("kevin");
    });
    expect(result.current.pageData.members[0].email).toBeUndefined();
    expect(result.current.editableMemberIds.has("kevin")).toBe(false);

    await act(async () => result.current.reconcileTeamsProjection());
    expect(result.current.pageData.teams.map(({ teamId }) => teamId)).toEqual(["av"]);
    expect(result.current.pageData.members[0]).toEqual(expect.objectContaining({
      memberId: "kevin", positionIds: ["av-position"],
    }));
    expect(result.current.pageData.members[0].email).toBeUndefined();
    expect(result.current.editableMemberIds.has("kevin")).toBe(false);
    unmount();
  });

  it("upgrades a newly added member only when the server bootstrap marks them editable", async () => {
    const safeDavid = { memberId: "david", churchId: "church-1", firstName: "David", lastName: "Lee", positionIds: [], blockoutDates: [] };
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({ ...emptyBootstrap, editableMemberIds: [], teams: [{ teamId: "worship", name: "Worship", memberIds: [] }] } as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        editableMemberIds: ["david"],
        members: [{ ...safeDavid, email: "david@example.test", notes: "server projected" }],
        teams: [{ teamId: "worship", name: "Worship", memberIds: ["david"] }],
      } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    act(() => {
      result.current.upsertData("teams", "teamId", { teamId: "worship", name: "Worship", memberIds: ["david"] } as never);
      result.current.upsertData("members", "memberId", safeDavid as never);
      result.current.invalidateMemberEditability("david");
    });
    expect(result.current.pageData.members[0].email).toBeUndefined();
    expect(result.current.editableMemberIds.has("david")).toBe(false);

    await act(async () => result.current.reconcileTeamsProjection());
    expect(result.current.pageData.members[0].email).toBe("david@example.test");
    expect(result.current.pageData.members[0].notes).toBe("server projected");
    expect(result.current.editableMemberIds.has("david")).toBe(true);
    unmount();
  });

  it("uses bounded REST refresh without EventSource for scoped/member access", async () => {
    canUseTeamsLiveSync = false;
    const { unmount } = renderPageState();
    await flushMicrotasks();
    expect(MockEventSource.instances).toHaveLength(0);
    emitFocus();
    emitVisibilityChange();
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(0);
    unmount();
  });

  it("allows position reorder only for a team the scoped manager can edit", async () => {
    mockGetTeamsBootstrap.mockResolvedValueOnce({
      ...emptyBootstrap,
      teams: [{ teamId: "worship", name: "Worship" }, { teamId: "av", name: "AV" }],
      positions: [
        { churchId: "church-1", positionId: "worship-position", teamId: "worship", name: "Keys" },
        { churchId: "church-1", positionId: "av-position", teamId: "av", name: "Camera" },
      ],
    } as never);
    jest.mocked(reorderTeamPositions).mockResolvedValue({ success: true, positions: [] } as never);
    const { result, unmount } = renderPageState(undefined, undefined, {
      role: "member",
      canEditTeams: false,
      permissions: { teams: "none", teamScopes: { worship: "edit" } },
      canEditTeam: (teamId: string) => teamId === "worship",
    });
    await flushMicrotasks();

    await act(async () => {
      await result.current.reorderPositions("av", ["av-position"]);
    });
    expect(reorderTeamPositions).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.reorderPositions("worship", ["worship-position"]);
    });
    expect(reorderTeamPositions).toHaveBeenCalledWith("church-1", {
      teamId: "worship",
      positionIds: ["worship-position"],
    });
    unmount();
  });

  it("clears a previously authorized projection after a bootstrap 403 and stops retrying", async () => {
    canUseTeamsLiveSync = false;
    mockGetTeamsBootstrap.mockResolvedValueOnce({
      ...emptyBootstrap,
      editableMemberIds: [],
      members: [{ memberId: "worship-member", firstName: "Sam" }],
      teams: [{ teamId: "worship", name: "Worship" }],
      schedules: [{ scheduleId: "worship-schedule", teamId: "worship" }],
    } as never);
    const { result, unmount } = renderPageState(undefined, undefined, {
      access: "member",
      role: "member",
      permissions: { teams: "none", services: "none" },
      canViewTeams: false,
      canViewServices: false,
      hasBroadTeamsReadAccess: false,
      canEditTeams: false,
    });
    await flushMicrotasks();

    expect(result.current.pageData.teams).toEqual([
      expect.objectContaining({ teamId: "worship" }),
    ]);
    expect(result.current.hasTeamsWorkspaceAccess).toBe(true);
    expect(result.current.editableMemberIds).toEqual(new Set());

    mockGetTeamsBootstrap.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();

    expect(result.current.accessDenied).toBe(true);
    expect(result.current.pageData.teams).toEqual([]);
    expect(result.current.pageData.members).toEqual([]);
    expect(result.current.pageData.schedules).toEqual([]);
    expect(result.current.editableMemberIds).toEqual(new Set());
    act(() => jest.advanceTimersByTime(10 * 60 * 1000));
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("forwards template events from the existing Teams stream", async () => {
    const onTemplateEvent = jest.fn();
    const { unmount } = renderPageState(onTemplateEvent);
    await flushMicrotasks();

    const source = MockEventSource.instances[0];
    act(() => source.onmessage?.({
      data: JSON.stringify({
        type: "service-plan-template-updated",
        template: { templateId: "template-1" },
      }),
    }));
    act(() => source.onmessage?.({
      data: JSON.stringify({
        type: "service-plan-template-removed",
        templateId: "template-1",
      }),
    }));

    expect(onTemplateEvent).toHaveBeenNthCalledWith(1, {
      type: "service-plan-template-updated",
      template: { templateId: "template-1" },
    });
    expect(onTemplateEvent).toHaveBeenNthCalledWith(2, {
      type: "service-plan-template-removed",
      templateId: "template-1",
    });
    unmount();
  });

  it("notifies template recovery only after the existing Teams stream reconnects", async () => {
    const onReconnect = jest.fn();
    const { unmount } = renderPageState(undefined, onReconnect);
    await flushMicrotasks();
    expect(onReconnect).not.toHaveBeenCalled();

    const source = MockEventSource.instances[0];
    act(() => source.onopen?.());
    act(() => source.onerror?.());
    act(() => source.onopen?.());
    await flushMicrotasks();

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
    jest.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
    emitFocus();
    await flushMicrotasks();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not restore or hydrate the last locally selected schedule on normal entry", async () => {
    window.localStorage.setItem("teams:selected-schedule:church-1", "old-schedule");
    mockGetTeamsBootstrap.mockResolvedValue({
      ...emptyBootstrap,
      schedules: [{
        scheduleId: "old-schedule",
        churchId: "church-1",
        name: "Old schedule",
        teamId: "team-1",
        startDate: "2025-01-01",
        endDate: "2025-01-31",
        serviceIds: [],
      }],
    } as never);

    const { result, unmount } = renderPageState();
    await flushMicrotasks();

    expect(result.current.selectedScheduleId).toBe("");
    expect(mockGetTeamScheduleDetail).not.toHaveBeenCalled();
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

  it("revalidates uncovered Teams data on a bounded interval while connected", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    act(() => MockEventSource.instances[0].onopen?.());

    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("skips interval reads while hidden and recovers when the page returns", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    act(() => MockEventSource.instances[0].onopen?.());
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
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
    mockGetTeamsBootstrap.mockRejectedValueOnce(new Error("offline"));
    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();

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
