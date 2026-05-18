import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "./useMediaQuery";

const makeMatchMedia = (initialMatches: boolean) => {
  const listeners: Array<() => void> = [];
  const mq = {
    matches: initialMatches,
    addEventListener: jest.fn((_: string, listener: () => void) => {
      listeners.push(listener);
    }),
    removeEventListener: jest.fn((_: string, listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }),
    trigger: (matches: boolean) => {
      mq.matches = matches;
      listeners.forEach((l) => l());
    },
  };
  return mq;
};

describe("useMediaQuery", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns the initial matches value from matchMedia", () => {
    const mq = makeMatchMedia(true);
    window.matchMedia = jest.fn().mockReturnValue(mq);

    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("returns false when the query does not initially match", () => {
    const mq = makeMatchMedia(false);
    window.matchMedia = jest.fn().mockReturnValue(mq);

    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("updates when the media query match changes", () => {
    const mq = makeMatchMedia(false);
    window.matchMedia = jest.fn().mockReturnValue(mq);

    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => {
      mq.trigger(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      mq.trigger(false);
    });
    expect(result.current).toBe(false);
  });

  it("removes the event listener on unmount", () => {
    const mq = makeMatchMedia(true);
    window.matchMedia = jest.fn().mockReturnValue(mq);

    const { unmount } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    unmount();
    expect(mq.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("returns true when matchMedia is not a function (server/test fallback)", () => {
    (window as any).matchMedia = undefined;

    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(true);
  });
});
