import { act, renderHook, waitFor } from "@testing-library/react";
import { useBoardPresentationFontScale } from "./useBoardPresentationFontScale";
import { getBoardAlias, updateBoardPresentationFontScale } from "./api";
import type { BoardStreamEvent } from "./useBoardEventStream";

jest.mock("./api", () => ({
  getBoardAlias: jest.fn(),
  updateBoardPresentationFontScale: jest.fn(),
}));

// Capture the stream subscription so tests can push events and assert gating.
let streamAliasId: string | null | undefined;
let streamHandler: ((event: BoardStreamEvent) => void) | null = null;
jest.mock("./useBoardEventStream", () => ({
  useBoardEventStream: (
    aliasId: string | null | undefined,
    onMessage: (event: BoardStreamEvent) => void,
  ) => {
    streamAliasId = aliasId;
    streamHandler = onMessage;
  },
}));

const mockGetBoardAlias = getBoardAlias as jest.Mock;
const mockUpdateFontScale = updateBoardPresentationFontScale as jest.Mock;

beforeEach(() => {
  mockGetBoardAlias.mockReset();
  mockUpdateFontScale.mockReset();
  mockUpdateFontScale.mockResolvedValue({ alias: {} });
  streamAliasId = undefined;
  streamHandler = null;
});

describe("useBoardPresentationFontScale", () => {
  it("loads the alias's current scale", async () => {
    mockGetBoardAlias.mockResolvedValue({
      alias: { aliasId: "sunday", presentationFontScale: 1.3 },
    });

    const { result } = renderHook(() =>
      useBoardPresentationFontScale("sunday"),
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.fontScale).toBe(1.3);
    expect(mockGetBoardAlias).toHaveBeenCalledWith("sunday");
  });

  it("applies a change optimistically and persists it", async () => {
    mockGetBoardAlias.mockResolvedValue({
      alias: { aliasId: "sunday", presentationFontScale: 1 },
    });

    const { result } = renderHook(() =>
      useBoardPresentationFontScale("sunday"),
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => result.current.changeFontScale(1.2));

    expect(result.current.fontScale).toBe(1.2);
    expect(mockUpdateFontScale).toHaveBeenCalledWith("sunday", 1.2);
  });

  it("rolls back the scale when the write fails", async () => {
    mockGetBoardAlias.mockResolvedValue({
      alias: { aliasId: "sunday", presentationFontScale: 1 },
    });
    mockUpdateFontScale.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() =>
      useBoardPresentationFontScale("sunday"),
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => result.current.changeFontScale(1.2));
    expect(result.current.fontScale).toBe(1.2);

    await waitFor(() => expect(result.current.fontScale).toBe(1));
  });

  it("syncs the scale from board presentation stream events", async () => {
    mockGetBoardAlias.mockResolvedValue({
      alias: { aliasId: "sunday", presentationFontScale: 1 },
    });

    const { result } = renderHook(() =>
      useBoardPresentationFontScale("sunday"),
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() =>
      streamHandler?.({
        type: "board-presentation-updated",
        presentationFontScale: 1.5,
      }),
    );

    expect(result.current.fontScale).toBe(1.5);
  });

  it("stays idle when disabled — no fetch, no stream", () => {
    renderHook(() =>
      useBoardPresentationFontScale("sunday", { enabled: false }),
    );

    expect(mockGetBoardAlias).not.toHaveBeenCalled();
    // A null alias tells useBoardEventStream to open no connection.
    expect(streamAliasId).toBeNull();
  });
});
