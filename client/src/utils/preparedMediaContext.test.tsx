import { act, renderHook } from "@testing-library/react";
import {
  subscribePreparedMediaContextRequests,
  usePreparedMediaContext,
  type PreparedMediaContext,
} from "./preparedMediaContext";

const mockChannel = {
  postMessage: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

jest.mock("../context/controllerInfo", () => ({
  get globalBroadcastRef() {
    return mockChannel;
  },
}));

jest.mock("../context/globalInfo", () => ({ globalHostId: "output-window" }));

const fallback: PreparedMediaContext = {
  controllerProfileId: "presentation",
  controllerProfileName: "Presentation",
  outlineScope: "presentation",
  outlineId: "persisted-outline",
  outlineName: "Persisted Outline",
  contextSource: "persisted ItemLists fallback",
};

describe("usePreparedMediaContext", () => {
  beforeEach(() => {
    mockChannel.postMessage.mockClear();
    mockChannel.addEventListener.mockClear();
    mockChannel.removeEventListener.mockClear();
  });

  it("requests the live owner context on mount so a late output can catch up", () => {
    renderHook(() => usePreparedMediaContext(fallback));

    expect(mockChannel.postMessage).toHaveBeenCalledWith({
      type: "prepared-media-context-request",
      hostId: "output-window",
      controllerProfileId: "presentation",
      outlineScope: "presentation",
    });
  });

  it("subscribes again when its local controller database becomes ready", () => {
    const { rerender } = renderHook(
      ({ db }: { db?: object }) => usePreparedMediaContext(fallback, db),
      { initialProps: { db: undefined } },
    );
    rerender({ db: {} });

    expect(mockChannel.postMessage).toHaveBeenCalledTimes(2);
  });

  it("answers a late output with the current matching controller context", () => {
    const selected: PreparedMediaContext = {
      ...fallback,
      outlineId: "Item List 28",
      outlineName: "Sabbath Service",
      contextSource: "local runtime selection",
    };
    const unsubscribe = subscribePreparedMediaContextRequests(() => [selected]);
    const listener = mockChannel.addEventListener.mock.calls[0][1] as (
      event: MessageEvent,
    ) => void;

    listener({
      data: {
        type: "prepared-media-context-request",
        hostId: "new-projector-window",
        controllerProfileId: "presentation",
        outlineScope: "presentation",
      },
    } as MessageEvent);

    expect(mockChannel.postMessage).toHaveBeenCalledWith({
      type: "prepared-media-context",
      hostId: "output-window",
      data: selected,
    });
    unsubscribe();
  });

  it("adopts matching runtime selection while isolating other controller scopes", () => {
    const { result } = renderHook(() => usePreparedMediaContext(fallback));
    const selected: PreparedMediaContext = {
      ...fallback,
      outlineId: "runtime-outline",
      outlineName: "Runtime Outline",
      contextSource: "local runtime selection",
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worshipsync-prepared-media-context", {
          detail: {
            ...selected,
            controllerProfileId: "auxiliary",
            outlineScope: "auxiliary",
          },
        }),
      );
    });
    expect(result.current).toEqual(fallback);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worshipsync-prepared-media-context", {
          detail: selected,
        }),
      );
    });
    expect(result.current).toEqual(selected);
    expect(mockChannel.postMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects Presentation context when the renderer belongs to Aux", () => {
    const auxFallback: PreparedMediaContext = {
      controllerProfileId: "aux",
      controllerProfileName: "Lobby",
      outlineScope: "aux",
      outlineId: "lobby-outline",
      outlineName: "Lobby Service",
      contextSource: "persisted ItemLists fallback",
    };
    const { result } = renderHook(() => usePreparedMediaContext(auxFallback));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worshipsync-prepared-media-context", {
          detail: {
            ...fallback,
            outlineId: "presentation-outline",
            contextSource: "local runtime selection",
          },
        }),
      );
    });

    expect(result.current).toEqual(auxFallback);
  });
});
