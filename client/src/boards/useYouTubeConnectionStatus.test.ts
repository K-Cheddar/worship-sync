import { act, renderHook, waitFor } from "@testing-library/react";
import { getYouTubeStatus } from "./api";
import { useYouTubeConnectionStatus } from "./useYouTubeConnectionStatus";

jest.mock("./api", () => ({
  getYouTubeStatus: jest.fn(),
}));

const mockGetYouTubeStatus = getYouTubeStatus as jest.MockedFunction<
  typeof getYouTubeStatus
>;

describe("useYouTubeConnectionStatus", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetYouTubeStatus.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("trusts Firebase when it already reports connected", () => {
    const { result } = renderHook(() =>
      useYouTubeConnectionStatus("church-1", true, "Church Live", {
        reconcile: true,
      }),
    );

    expect(result.current).toEqual({
      connected: true,
      accountLabel: "Church Live",
    });
    expect(mockGetYouTubeStatus).not.toHaveBeenCalled();
  });

  it("does not call the API when Firebase is disconnected and reconcile is off", () => {
    const { result } = renderHook(() =>
      useYouTubeConnectionStatus("church-1", false, "", { reconcile: false }),
    );

    expect(result.current.connected).toBe(false);
    expect(mockGetYouTubeStatus).not.toHaveBeenCalled();
  });

  it("reconciles from the token API when reconcile evidence is present", async () => {
    mockGetYouTubeStatus.mockResolvedValue({
      oauthConfigured: true,
      enabled: true,
      connected: true,
      accountLabel: "API Channel",
      lastError: "",
    });

    const { result } = renderHook(() =>
      useYouTubeConnectionStatus("church-1", false, "", { reconcile: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
    expect(result.current.accountLabel).toBe("API Channel");
    expect(mockGetYouTubeStatus).toHaveBeenCalledWith("church-1");
  });

  it("retries a short burst then stops while Firebase stays disconnected", async () => {
    mockGetYouTubeStatus
      .mockResolvedValueOnce({
        oauthConfigured: true,
        enabled: false,
        connected: false,
        accountLabel: "",
        lastError: "",
      })
      .mockResolvedValueOnce({
        oauthConfigured: true,
        enabled: true,
        connected: true,
        accountLabel: "Recovered",
        lastError: "",
      })
      .mockResolvedValue({
        oauthConfigured: true,
        enabled: true,
        connected: true,
        accountLabel: "Recovered",
        lastError: "",
      });

    const { result } = renderHook(() =>
      useYouTubeConnectionStatus("church-1", false, "", { reconcile: true }),
    );

    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    await waitFor(() => {
      expect(mockGetYouTubeStatus).toHaveBeenCalledTimes(1);
    });
    expect(result.current.connected).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
    expect(result.current.accountLabel).toBe("Recovered");

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(mockGetYouTubeStatus).toHaveBeenCalledTimes(3);

    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(mockGetYouTubeStatus).toHaveBeenCalledTimes(3);
  });
});
