import React, { type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastContext } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import { getTeamScheduleDetail, getTeamsBootstrap, reorderTeamPositions } from "../../../api/auth";
import type { AuthenticatedSseHandlers } from "../../../utils/authenticatedSse";
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

const mockConnections: Array<{
  path: string;
  handlers: AuthenticatedSseHandlers;
  close: jest.Mock;
}> = [];

const mockConnectAuthenticatedSse = jest.fn(
  (path: string, handlers: AuthenticatedSseHandlers) => {
    const close = jest.fn();
    mockConnections.push({ path, handlers, close });
    return close;
  },
);

jest.mock("../../../utils/authenticatedSse", () => ({
  connectAuthenticatedSse: (...args: unknown[]) =>
    mockConnectAuthenticatedSse(...(args as [string, AuthenticatedSseHandlers])),
}));

const emptyBootstrap = {
  success: true,
  members: [],
  positions: [],
  teams: [],
  schedules: [],
};

const mockGetTeamsBootstrap = jest.mocked(getTeamsBootstrap);
const mockGetTeamScheduleDetail = jest.mocked(getTeamScheduleDetail);

const emitFocus = () => act(() => window.dispatchEvent(new Event("focus")));
const emitVisibilityChange = () =>
  act(() => document.dispatchEvent(new Event("visibilitychange")));
const flushMicrotasks = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makePositionBootstrap = () => ({
  ...emptyBootstrap,
  teams: [
    { teamId: "worship", churchId: "church-1", name: "Worship" },
    { teamId: "av", churchId: "church-1", name: "AV" },
  ],
  positions: [
    { churchId: "church-1", positionId: "worship-a", teamId: "worship", name: "Keys", order: 0 },
    { churchId: "church-1", positionId: "worship-b", teamId: "worship", name: "Vocals", order: 1 },
    { churchId: "church-1", positionId: "av-a", teamId: "av", name: "Camera", order: 0 },
    { churchId: "church-1", positionId: "av-b", teamId: "av", name: "Audio", order: 1 },
  ],
});

const positionsResponse = (teamId: string, positionIds: string[]) => ({
  success: true,
  positions: positionIds.map((positionId, order) => ({
    churchId: "church-1",
    positionId,
    teamId,
    name: positionId,
    order,
  })),
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
    mockConnections.length = 0;
    mockConnectAuthenticatedSse.mockClear();
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
  });

  it("loads once initially and ignores fresh focus and visibility events", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    act(() => mockConnections[0].handlers.onOpen());
    emitFocus();
    emitVisibilityChange();
    emitFocus();
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("reconciles linked, unlinked, and relinked self identity from the bootstrap", async () => {
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({ ...emptyBootstrap, selfMemberId: "member-self" } as never)
      .mockResolvedValueOnce({ ...emptyBootstrap, selfMemberId: null } as never)
      .mockResolvedValueOnce({ ...emptyBootstrap, selfMemberId: "member-self-again" } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    expect(result.current.selfMemberId).toBe("member-self");

    await act(async () => result.current.reconcileTeamsProjection());
    expect(result.current.selfMemberId).toBeNull();

    await act(async () => result.current.reconcileTeamsProjection());
    expect(result.current.selfMemberId).toBe("member-self-again");
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("fetches a post-link identity after an older bootstrap already started", async () => {
    const olderBootstrap = deferred<typeof emptyBootstrap & { selfMemberId: string | null }>();
    mockGetTeamsBootstrap
      .mockReturnValueOnce(olderBootstrap.promise as never)
      .mockResolvedValueOnce({ ...emptyBootstrap, selfMemberId: "member-self" } as never);
    const { result, unmount } = renderPageState(undefined, undefined, {
      sessionKind: "human",
      userId: "user-1",
    });
    await waitFor(() => expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1));

    let reconciliation: Promise<void> = Promise.resolve();
    act(() => {
      reconciliation = result.current.reconcileTeamsProjection();
    });
    await act(async () => {
      olderBootstrap.resolve({ ...emptyBootstrap, selfMemberId: null });
      await reconciliation;
    });

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.selfMemberId).toBe("member-self");
    unmount();
  });

  it("clears self identity immediately on church or account changes and ignores a stale bootstrap", async () => {
    const oldChurchBootstrap = deferred<typeof emptyBootstrap & { selfMemberId: string }>();
    mockGetTeamsBootstrap
      .mockImplementationOnce(() => oldChurchBootstrap.promise as never)
      .mockResolvedValueOnce({ ...emptyBootstrap, selfMemberId: "church-2-member" } as never)
      .mockResolvedValue({ ...emptyBootstrap, selfMemberId: null } as never);
    const contextOverrides: Record<string, unknown> = {
      sessionKind: "human",
      userId: "user-1",
    };
    const { result, rerender, unmount } = renderPageState(undefined, undefined, contextOverrides);
    expect(result.current.selfMemberId).toBeNull();

    churchId = "church-2";
    rerender();
    expect(result.current.selfMemberId).toBeNull();
    await act(async () => oldChurchBootstrap.resolve({
      ...emptyBootstrap,
      selfMemberId: "stale-church-1-member",
    }));
    await waitFor(() => expect(result.current.selfMemberId).toBe("church-2-member"));
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);

    const oldAccountBootstrap = deferred<typeof emptyBootstrap & { selfMemberId: string }>();
    mockGetTeamsBootstrap.mockImplementationOnce(() => oldAccountBootstrap.promise as never);
    contextOverrides.userId = "user-2";
    rerender();
    expect(result.current.selfMemberId).toBeNull();
    contextOverrides.sessionKind = null;
    contextOverrides.userId = "";
    rerender();
    expect(result.current.selfMemberId).toBeNull();
    await act(async () => oldAccountBootstrap.resolve({
      ...emptyBootstrap,
      selfMemberId: "stale-user-2-member",
    }));
    expect(result.current.selfMemberId).toBeNull();
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

  it("refreshes only the saved member's phone eligibility from an authoritative bootstrap", async () => {
    const noPhone = {
      memberId: "member-sms", churchId: "church-1", firstName: "Rae", lastName: "Kim",
      phoneNumber: "", positionIds: [], blockoutDates: [],
    };
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [noPhone],
        smsEligibilityByMemberId: {
          [noPhone.memberId]: { status: "no_mobile", eligible: false, phoneNumber: "" },
        },
      } as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [{ ...noPhone, phoneNumber: "+19545551234" }],
        smsEligibilityByMemberId: {
          [noPhone.memberId]: { status: "consent_needed", eligible: false, phoneNumber: "+19545551234" },
        },
      } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    expect(result.current.pageData.smsEligibilityByMemberId?.[noPhone.memberId]?.status).toBe("no_mobile");

    act(() => result.current.upsertData("members", "memberId", {
      ...noPhone, phoneNumber: "+19545551234",
    } as never));
    await act(async () => {
      await result.current.refreshMemberSmsEligibility(noPhone.memberId, "+19545551234", "");
    });

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.members[0].phoneNumber).toBe("+19545551234");
    expect(result.current.pageData.smsEligibilityByMemberId?.[noPhone.memberId]).toEqual({
      status: "consent_needed", eligible: false, phoneNumber: "+19545551234",
    });
    unmount();
  });

  it("waits for an older bootstrap, then restores the confirmed phone with its matching eligibility", async () => {
    const noPhone = {
      memberId: "member-sms", churchId: "church-1", firstName: "Rae", lastName: "Kim",
      phoneNumber: "", positionIds: [], blockoutDates: [],
    };
    const oldBootstrap = deferred<unknown>();
    mockGetTeamsBootstrap
      .mockReturnValueOnce(oldBootstrap.promise as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [{ ...noPhone, phoneNumber: "+19545551234" }],
        smsEligibilityByMemberId: {
          [noPhone.memberId]: { status: "consent_needed", eligible: false, phoneNumber: "+19545551234" },
        },
      } as never);
    const { result, unmount } = renderPageState();
    await waitFor(() => expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1));

    act(() => result.current.upsertData("members", "memberId", {
      ...noPhone, phoneNumber: "+19545551234",
    } as never));
    let reconciliation: Promise<void> = Promise.resolve();
    act(() => {
      reconciliation = result.current.refreshMemberSmsEligibility(noPhone.memberId, "+19545551234", "");
    });
    await act(async () => {
      oldBootstrap.resolve({
        ...emptyBootstrap,
        members: [noPhone],
        smsEligibilityByMemberId: {
          [noPhone.memberId]: { status: "no_mobile", eligible: false, phoneNumber: "" },
        },
      });
      await reconciliation;
    });

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.members[0].phoneNumber).toBe("+19545551234");
    expect(result.current.pageData.smsEligibilityByMemberId?.[noPhone.memberId]?.status).toBe("consent_needed");
    unmount();
  });

  it("refreshes to no-mobile eligibility after the saved phone is removed", async () => {
    const member = {
      memberId: "member-sms", churchId: "church-1", firstName: "Rae", lastName: "Kim",
      phoneNumber: "+19545550111", positionIds: [], blockoutDates: [],
    };
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "opted_out", eligible: false, phoneNumber: member.phoneNumber },
        },
      } as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [{ ...member, phoneNumber: "" }],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "no_mobile", eligible: false, phoneNumber: "" },
        },
      } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    act(() => result.current.upsertData("members", "memberId", { ...member, phoneNumber: "" } as never));
    await act(async () => {
      await result.current.refreshMemberSmsEligibility(member.memberId, "", member.phoneNumber);
    });

    expect(result.current.pageData.smsEligibilityByMemberId?.[member.memberId]).toEqual({
      status: "no_mobile", eligible: false, phoneNumber: "",
    });
    unmount();
  });

  it("does not let a delayed response for an earlier phone replace newer eligibility", async () => {
    const member = {
      memberId: "member-sms", churchId: "church-1", firstName: "Rae", lastName: "Kim",
      phoneNumber: "+19545550111", positionIds: [], blockoutDates: [],
    };
    mockGetTeamsBootstrap.mockResolvedValueOnce({
      ...emptyBootstrap,
      members: [member],
      smsEligibilityByMemberId: {
        [member.memberId]: { status: "enabled", eligible: true, phoneNumber: member.phoneNumber },
      },
    } as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    const earlierResponse = deferred<unknown>();
    mockGetTeamsBootstrap
      .mockReturnValueOnce(earlierResponse.promise as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [{ ...member, phoneNumber: "+19545550222" }],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "consent_needed", eligible: false, phoneNumber: "+19545550222" },
        },
      } as never);
    let earlier: Promise<void> = Promise.resolve();
    act(() => {
      earlier = result.current.refreshMemberSmsEligibility(member.memberId, "+19545550111", "");
    });
    await waitFor(() => expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2));

    act(() => result.current.upsertData("members", "memberId", {
      ...member, phoneNumber: "+19545550222",
    } as never));
    await act(async () => {
      await result.current.refreshMemberSmsEligibility(member.memberId, "+19545550222", "+19545550111");
    });
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(3);
    expect(result.current.pageData.smsEligibilityByMemberId?.[member.memberId]).toEqual({
      status: "consent_needed", eligible: false, phoneNumber: "+19545550222",
    });
    await act(async () => {
      earlierResponse.resolve({
        ...emptyBootstrap,
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "enabled", eligible: true, phoneNumber: member.phoneNumber },
        },
      });
      await earlier;
    });
    expect(result.current.pageData.members[0].phoneNumber).toBe("+19545550222");
    expect(result.current.pageData.smsEligibilityByMemberId?.[member.memberId]?.phoneNumber).toBe("+19545550222");
    unmount();
  });

  it("ignores a pending eligibility response after the active church changes", async () => {
    const member = {
      memberId: "member-sms", churchId: "church-1", firstName: "Rae", lastName: "Kim",
      phoneNumber: "+19545550111", positionIds: [], blockoutDates: [],
    };
    const oldEligibilityResponse = deferred<unknown>();
    mockGetTeamsBootstrap
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "consent_needed", eligible: false, phoneNumber: member.phoneNumber },
        },
      } as never)
      .mockReturnValueOnce(oldEligibilityResponse.promise as never)
      .mockResolvedValueOnce({
        ...emptyBootstrap,
        members: [{ ...member, churchId: "church-2" }],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "opted_out", eligible: false, phoneNumber: member.phoneNumber },
        },
      } as never);
    const { result, rerender, unmount } = renderPageState();
    await flushMicrotasks();
    let oldRequest: Promise<void> = Promise.resolve();
    act(() => {
      oldRequest = result.current.refreshMemberSmsEligibility(member.memberId, member.phoneNumber, "");
    });
    await waitFor(() => expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2));

    churchId = "church-2";
    rerender();
    await flushMicrotasks();
    await act(async () => {
      oldEligibilityResponse.resolve({
        ...emptyBootstrap,
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "enabled", eligible: true, phoneNumber: member.phoneNumber },
        },
      });
      await oldRequest;
    });

    expect(result.current.pageData.smsEligibilityByMemberId?.[member.memberId]?.status).toBe("opted_out");
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

  it("uses bounded REST refresh without a live stream for scoped/member access", async () => {
    canUseTeamsLiveSync = false;
    const { unmount } = renderPageState();
    await flushMicrotasks();
    expect(mockConnections).toHaveLength(0);
    emitFocus();
    emitVisibilityChange();
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(mockConnections).toHaveLength(0);
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

  it("serializes rapid reorders for one team and persists the latest selected order", async () => {
    const bootstrap = makePositionBootstrap();
    mockGetTeamsBootstrap.mockResolvedValue(bootstrap as never);
    const firstSave = deferred<ReturnType<typeof positionsResponse>>();
    const secondSave = deferred<ReturnType<typeof positionsResponse>>();
    const reorderMock = jest.mocked(reorderTeamPositions);
    reorderMock.mockReset();
    reorderMock
      .mockReturnValueOnce(firstSave.promise as never)
      .mockReturnValueOnce(secondSave.promise as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.reorderPositions("worship", ["worship-b", "worship-a"]);
    });
    await flushMicrotasks();
    expect(reorderMock).toHaveBeenCalledTimes(1);
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-b", "worship-a"]);

    act(() => {
      secondRequest = result.current.reorderPositions("worship", ["worship-a", "worship-b"]);
    });
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-a", "worship-b"]);
    expect(reorderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve(positionsResponse("worship", ["worship-b", "worship-a"]));
      await firstRequest;
    });
    await flushMicrotasks();
    expect(reorderMock).toHaveBeenCalledTimes(2);
    expect(reorderMock).toHaveBeenNthCalledWith(2, "church-1", {
      teamId: "worship",
      positionIds: ["worship-a", "worship-b"],
    });

    await act(async () => {
      secondSave.resolve(positionsResponse("worship", ["worship-a", "worship-b"]));
      await secondRequest;
    });
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-a", "worship-b"]);
    unmount();
  });

  it("keeps a newer reorder when an earlier save fails", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(makePositionBootstrap() as never);
    const failedSave = deferred<ReturnType<typeof positionsResponse>>();
    const latestSave = deferred<ReturnType<typeof positionsResponse>>();
    const reorderMock = jest.mocked(reorderTeamPositions);
    reorderMock.mockReset();
    reorderMock
      .mockReturnValueOnce(failedSave.promise as never)
      .mockReturnValueOnce(latestSave.promise as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();

    let earlierRequest!: Promise<void>;
    let latestRequest!: Promise<void>;
    act(() => {
      earlierRequest = result.current.reorderPositions("worship", ["worship-b", "worship-a"]);
      latestRequest = result.current.reorderPositions("worship", ["worship-a", "worship-b"]);
    });
    await flushMicrotasks();
    await act(async () => {
      failedSave.reject(new Error("network error"));
      await earlierRequest;
    });
    await flushMicrotasks();
    expect(reorderMock).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-a", "worship-b"]);

    await act(async () => {
      latestSave.resolve(positionsResponse("worship", ["worship-a", "worship-b"]));
      await latestRequest;
    });
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-a", "worship-b"]);
    unmount();
  });

  it("reorders different teams independently when responses resolve in the opposite order", async () => {
    mockGetTeamsBootstrap.mockResolvedValue(makePositionBootstrap() as never);
    const worshipSave = deferred<ReturnType<typeof positionsResponse>>();
    const avSave = deferred<ReturnType<typeof positionsResponse>>();
    const reorderMock = jest.mocked(reorderTeamPositions);
    reorderMock.mockReset();
    reorderMock
      .mockReturnValueOnce(worshipSave.promise as never)
      .mockReturnValueOnce(avSave.promise as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();

    let worshipRequest!: Promise<void>;
    let avRequest!: Promise<void>;
    act(() => {
      worshipRequest = result.current.reorderPositions("worship", ["worship-b", "worship-a"]);
      avRequest = result.current.reorderPositions("av", ["av-b", "av-a"]);
    });
    await flushMicrotasks();
    expect(reorderMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      avSave.resolve(positionsResponse("av", ["av-b", "av-a"]));
      await avRequest;
    });
    await act(async () => {
      worshipSave.resolve(positionsResponse("worship", ["worship-b", "worship-a"]));
      await worshipRequest;
    });
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-b", "worship-a"]);
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "av")
      .map((position) => position.positionId)).toEqual(["av-b", "av-a"]);
    unmount();
  });

  it("restores the authoritative team order when the latest reorder fails", async () => {
    const bootstrap = makePositionBootstrap();
    mockGetTeamsBootstrap.mockResolvedValue(bootstrap as never);
    const failedSave = deferred<ReturnType<typeof positionsResponse>>();
    const reorderMock = jest.mocked(reorderTeamPositions);
    reorderMock.mockReset().mockReturnValueOnce(failedSave.promise as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();

    let request!: Promise<void>;
    act(() => {
      request = result.current.reorderPositions("worship", ["worship-b", "worship-a"]);
    });
    await flushMicrotasks();
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-b", "worship-a"]);

    await act(async () => {
      failedSave.reject(new Error("network error"));
      await request;
    });
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-a", "worship-b"]);
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
    expect(result.current.pageData.schedules).toEqual([
      expect.objectContaining({ scheduleId: "worship-schedule" }),
    ]);
    expect(result.current.hasTeamsWorkspaceAccess).toBe(true);
    expect(result.current.availableNavSections.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "/teams-and-services/schedules",
        "/teams-and-services/groups",
      ]),
    );
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

    const handlers = mockConnections[0].handlers;
    act(() =>
      handlers.onMessage(
        JSON.stringify({
          type: "service-plan-template-updated",
          templateId: "template-1",
        }),
      ),
    );
    act(() =>
      handlers.onMessage(
        JSON.stringify({
          type: "service-plan-template-removed",
          templateId: "template-1",
        }),
      ),
    );

    expect(onTemplateEvent).toHaveBeenNthCalledWith(1, {
      type: "service-plan-template-updated",
      templateId: "template-1",
    });
    expect(onTemplateEvent).toHaveBeenNthCalledWith(2, {
      type: "service-plan-template-removed",
      templateId: "template-1",
    });
    unmount();
  });

  it("refreshes position order after a reorder from another editor", async () => {
    const initial = makePositionBootstrap();
    const reordered = {
      ...initial,
      positions: initial.positions.map((position) => ({
        ...position,
        order: position.positionId === "worship-a" ? 1 :
          position.positionId === "worship-b" ? 0 : position.order,
      })),
    };
    mockGetTeamsBootstrap
      .mockResolvedValueOnce(initial as never)
      .mockResolvedValueOnce(reordered as never);
    const { result, unmount } = renderPageState();
    await flushMicrotasks();
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-a", "worship-b"]);

    act(() => mockConnections[0].handlers.onMessage(
      JSON.stringify({ type: "team-positions-reordered" }),
    ));
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.pageData.positions
      .filter((position) => position.teamId === "worship")
      .map((position) => position.positionId)).toEqual(["worship-b", "worship-a"]);
    unmount();
  });

  it("notifies template recovery only after the existing Teams stream reconnects", async () => {
    const onReconnect = jest.fn();
    const { unmount } = renderPageState(undefined, onReconnect);
    await flushMicrotasks();
    expect(onReconnect).not.toHaveBeenCalled();

    const handlers = mockConnections[0].handlers;
    act(() => handlers.onOpen());
    act(() => handlers.onError({ kind: "interrupted" }));
    act(() => handlers.onOpen());
    await flushMicrotasks();

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(mockConnections).toHaveLength(1);
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
    act(() => mockConnections[0].handlers.onOpen());
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
    act(() => mockConnections[0].handlers.onOpen());

    act(() => jest.advanceTimersByTime(5 * 60 * 1000 + 1));
    await flushMicrotasks();

    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("skips interval reads while hidden and recovers when the page returns", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    act(() => mockConnections[0].handlers.onOpen());
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
    const handlers = mockConnections[0].handlers;
    act(() => handlers.onOpen());
    act(() => jest.advanceTimersByTime(4 * 60 * 1000));
    act(() => handlers.onError({ kind: "interrupted" }));
    act(() => handlers.onOpen());
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
    const handlers = mockConnections[0].handlers;

    act(() => handlers.onOpen());
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(1);

    act(() => handlers.onError({ kind: "interrupted" }));
    act(() => {
      handlers.onOpen();
      handlers.onOpen();
    });
    await flushMicrotasks();
    expect(mockGetTeamsBootstrap).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("uses stale age rather than every focus when authentication rejects the stream", async () => {
    const { unmount } = renderPageState();
    await flushMicrotasks();
    act(() =>
      mockConnections[0].handlers.onError({
        kind: "authentication",
        status: 401,
      }),
    );

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
    act(() => mockConnections[0].handlers.onOpen());
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
    const handlers = mockConnections[0].handlers;
    act(() => handlers.onOpen());
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
    act(() => handlers.onError({ kind: "interrupted" }));
    act(() => handlers.onOpen());
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

    act(() => mockConnections[1].handlers.onOpen());
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
