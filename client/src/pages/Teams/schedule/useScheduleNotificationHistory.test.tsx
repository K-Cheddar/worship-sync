import { act, renderHook, waitFor } from "@testing-library/react";
import { getNotificationIntents } from "../../../api/auth";
import type { NotificationIntent } from "../../../api/authTypes";
import { useScheduleNotificationHistory } from "./useScheduleNotificationHistory";

jest.mock("../../../api/auth", () => ({
  AuthApiError: class AuthApiError extends Error {},
  getNotificationIntents: jest.fn(),
}));

const mockGetNotificationIntents = jest.mocked(getNotificationIntents);
const showToast = jest.fn();
const notification = (intentId: string) => ({ intentId } as NotificationIntent);
const page = (intentIds: string[], nextCursor = "") => ({
  success: true,
  intents: intentIds.map(notification),
  nextCursor,
  limit: 25,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("useScheduleNotificationHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    showToast.mockReset();
  });

  it("skips virtual history and loads persisted history, refresh, and older pages", async () => {
    mockGetNotificationIntents
      .mockResolvedValueOnce(page(["first"], "older-cursor"))
      .mockResolvedValueOnce(page(["older"]))
      .mockResolvedValueOnce(page(["first", "refreshed"]));
    const { result, rerender } = renderHook(
      ({ scheduleId }) => useScheduleNotificationHistory({
        churchId: "church-1", scheduleId, canEdit: true, showToast,
      }),
      { initialProps: { scheduleId: "virtual:team:2026-11-01:2026-11-30" } },
    );

    expect(mockGetNotificationIntents).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ intents: [], nextCursor: "", loading: false });
    await act(async () => {
      await result.current.refresh("virtual:team:2026-11-01:2026-11-30");
      await result.current.loadOlder();
    });
    expect(mockGetNotificationIntents).not.toHaveBeenCalled();

    rerender({ scheduleId: "saved-november" });
    await waitFor(() => expect(result.current.intents.map(({ intentId }) => intentId)).toEqual(["first"]));
    expect(mockGetNotificationIntents).toHaveBeenNthCalledWith(1, "church-1", { scheduleId: "saved-november" });
    expect(result.current.nextCursor).toBe("older-cursor");

    await act(async () => { await result.current.loadOlder(); });
    expect(mockGetNotificationIntents).toHaveBeenNthCalledWith(2, "church-1", {
      scheduleId: "saved-november", cursor: "older-cursor",
    });
    expect(result.current.intents.map(({ intentId }) => intentId)).toEqual(["older", "first"]);

    await act(async () => { await result.current.refresh("saved-november"); });
    expect(mockGetNotificationIntents).toHaveBeenNthCalledWith(3, "church-1", { scheduleId: "saved-november" });
    expect(result.current.intents.map(({ intentId }) => intentId)).toEqual(["first", "refreshed", "older"]);
  });

  it("clears history on schedule changes and ignores a late response from the prior schedule", async () => {
    const prior = deferred<Awaited<ReturnType<typeof getNotificationIntents>>>();
    mockGetNotificationIntents
      .mockReturnValueOnce(prior.promise)
      .mockResolvedValueOnce(page(["current"], "current-cursor"));
    const { result, rerender } = renderHook(
      ({ scheduleId }) => useScheduleNotificationHistory({
        churchId: "church-1", scheduleId, canEdit: true, showToast,
      }),
      { initialProps: { scheduleId: "saved-october" } },
    );
    await waitFor(() => expect(mockGetNotificationIntents).toHaveBeenCalledTimes(1));

    rerender({ scheduleId: "saved-november" });
    expect(result.current).toMatchObject({ intents: [], nextCursor: "", loading: true });
    await waitFor(() => expect(mockGetNotificationIntents).toHaveBeenCalledTimes(2));
    await act(async () => { prior.resolve(page(["stale"], "stale-cursor")); });
    await waitFor(() => expect(result.current.intents.map(({ intentId }) => intentId)).toEqual(["current"]));
    expect(result.current.nextCursor).toBe("current-cursor");

    rerender({ scheduleId: "virtual:team:2026-11-01:2026-11-30" });
    expect(result.current).toMatchObject({ intents: [], nextCursor: "", loading: false });
    await act(async () => {
      await result.current.refresh("saved-november");
      await result.current.loadOlder();
    });
    expect(mockGetNotificationIntents).toHaveBeenCalledTimes(2);
  });

  it("ignores an older-page response after switching away from its schedule", async () => {
    const olderPage = deferred<Awaited<ReturnType<typeof getNotificationIntents>>>();
    mockGetNotificationIntents
      .mockResolvedValueOnce(page(["current"], "older-cursor"))
      .mockReturnValueOnce(olderPage.promise);
    const { result, rerender } = renderHook(
      ({ scheduleId }) => useScheduleNotificationHistory({
        churchId: "church-1", scheduleId, canEdit: true, showToast,
      }),
      { initialProps: { scheduleId: "saved-november" } },
    );
    await waitFor(() => expect(result.current.nextCursor).toBe("older-cursor"));

    let loadPromise: Promise<void> = Promise.resolve();
    act(() => { loadPromise = result.current.loadOlder(); });
    await waitFor(() => expect(mockGetNotificationIntents).toHaveBeenCalledTimes(2));
    rerender({ scheduleId: "virtual:team:2026-11-01:2026-11-30" });
    expect(result.current).toMatchObject({ intents: [], nextCursor: "", loading: false });

    await act(async () => {
      olderPage.resolve(page(["late-older"], "late-cursor"));
      await loadPromise;
    });
    expect(result.current).toMatchObject({ intents: [], nextCursor: "", loading: false });
  });
});
