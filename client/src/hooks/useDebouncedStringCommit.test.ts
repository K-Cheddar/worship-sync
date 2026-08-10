import { act, renderHook } from "@testing-library/react";
import useDebouncedStringCommit, {
  DEBOUNCED_STRING_COMMIT_MS,
} from "./useDebouncedStringCommit";

describe("useDebouncedStringCommit", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("updates locally immediately and commits only the latest value after the delay", () => {
    const onCommit = jest.fn();
    const { result } = renderHook(() =>
      useDebouncedStringCommit("Opening", onCommit),
    );

    act(() => {
      result.current.setDraftValue("Opening p");
      result.current.setDraftValue("Opening prayer");
    });

    expect(result.current.draftValue).toBe("Opening prayer");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(DEBOUNCED_STRING_COMMIT_MS - 1);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Opening prayer");
  });

  it("flushes a pending value immediately", () => {
    const onCommit = jest.fn();
    const { result } = renderHook(() =>
      useDebouncedStringCommit("Worship", onCommit),
    );

    act(() => {
      result.current.setDraftValue("Songs");
      result.current.flush();
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Songs");
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("syncs clean external values without replacing a dirty local draft", () => {
    const onCommit = jest.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedStringCommit(value, onCommit),
      { initialProps: { value: "Original" } },
    );

    rerender({ value: "Remote clean value" });
    expect(result.current.draftValue).toBe("Remote clean value");

    act(() => {
      result.current.setDraftValue("Local typing");
    });
    rerender({ value: "Remote while typing" });
    expect(result.current.draftValue).toBe("Local typing");

    act(() => {
      jest.advanceTimersByTime(DEBOUNCED_STRING_COMMIT_MS);
    });
    expect(onCommit).toHaveBeenCalledWith("Local typing");
  });

  it("flushes pending text when the field unmounts", () => {
    const onCommit = jest.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedStringCommit("Assigned", onCommit),
    );

    act(() => {
      result.current.setDraftValue("Assigned person");
    });
    unmount();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Assigned person");
  });
});
