import { act, renderHook, waitFor } from "@testing-library/react";
import { usePublicServiceFlow } from "./usePublicServiceFlow";
import {
  getPublicServiceFlow,
  PublicServiceAccessRevokedError,
} from "./serviceFlowApi";
import type { PublicServiceFlowSnapshot } from "./serviceFlowTypes";

jest.mock("./serviceFlowApi", () => {
  const actual = jest.requireActual("./serviceFlowApi");
  return {
    ...actual,
    getPublicServiceFlow: jest.fn(),
    getPublicServiceFlowStreamUrl: () => "https://example.test/stream",
  };
});

const mockGetPublicServiceFlow = jest.mocked(getPublicServiceFlow);

const snapshot = {
  success: true,
  churchName: "Northside",
  serverNowMs: 1_700_000_000_000,
  service: {
    shareId: "token-1",
    viewMode: "team",
    title: "Sunday Service",
    startsAt: "2026-08-02T14:00:00.000Z",
    timezone: "America/New_York",
    revision: 1,
    sections: [
      {
        id: "section-1",
        title: "Worship",
        items: [
          {
            id: "item-1",
            title: "Living Hope",
            durationSeconds: 300,
            notes: { blocks: [] },
            teamNotes: [{ label: "Band", notes: { blocks: [] } }],
          },
        ],
      },
    ],
    live: { mode: "schedule" },
  },
} as unknown as PublicServiceFlowSnapshot;

describe("usePublicServiceFlow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // EventSource isn't implemented in jsdom; the hook already guards on it
    // being undefined, so leaving it unset exercises the polling path.
    mockGetPublicServiceFlow.mockResolvedValue(snapshot);
  });

  it("exposes the loaded snapshot", async () => {
    const { result } = renderHook(() => usePublicServiceFlow("token-1"));
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(result.current.revoked).toBe(false);
    expect(result.current.connection).toBe("connected");
  });

  it("drops the snapshot when the link is revoked, so team notes stop showing", async () => {
    const { result } = renderHook(() => usePublicServiceFlow("token-1"));
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    // Unpublish/delete makes the next load 404.
    mockGetPublicServiceFlow.mockRejectedValue(
      new PublicServiceAccessRevokedError("Service not found.", 404),
    );
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.snapshot).toBeNull();
    expect(result.current.revoked).toBe(true);
    expect(result.current.connection).toBe("failed");
  });

  it("keeps the last snapshot for a transient failure so a blip doesn't blank the page", async () => {
    const { result } = renderHook(() => usePublicServiceFlow("token-1"));
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    mockGetPublicServiceFlow.mockRejectedValue(new Error("Network down"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.snapshot).toEqual(snapshot);
    expect(result.current.revoked).toBe(false);
    expect(result.current.connection).toBe("reconnecting");
  });

  it("recovers when a revoked service is published again", async () => {
    mockGetPublicServiceFlow.mockRejectedValue(
      new PublicServiceAccessRevokedError("Service not found.", 404),
    );
    const { result } = renderHook(() => usePublicServiceFlow("token-1"));
    await waitFor(() => expect(result.current.revoked).toBe(true));

    mockGetPublicServiceFlow.mockResolvedValue(snapshot);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.snapshot).toEqual(snapshot);
    expect(result.current.revoked).toBe(false);
    expect(result.current.connection).toBe("connected");
  });
});
