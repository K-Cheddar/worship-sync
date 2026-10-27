import { act, renderHook } from "@testing-library/react";
import { OverlayInfo } from "../types";
import { useOverlayDraft } from "./useOverlayDraft";

const baseOverlay: OverlayInfo = {
  id: "overlay-1",
  type: "participant",
  name: "Local Name",
  title: "",
  event: "",
  duration: 7,
  imageUrl: "",
  heading: "",
  subHeading: "",
  url: "",
  description: "",
  formatting: {},
};

describe("useOverlayDraft", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("drops dirty local draft when replacing with accepted remote overlay", () => {
    const onCommit = jest.fn();
    const remoteOverlay: OverlayInfo = {
      ...baseOverlay,
      name: "Remote Name",
    };

    const { result, rerender } = renderHook(
      ({ selectedOverlay }) => useOverlayDraft(selectedOverlay, onCommit),
      {
        initialProps: { selectedOverlay: baseOverlay },
      },
    );

    act(() => {
      result.current.patchDraft({ name: "Unsaved Local Edit" });
    });

    act(() => {
      result.current.replaceDraft(remoteOverlay);
    });

    rerender({ selectedOverlay: remoteOverlay });

    act(() => {
      jest.advanceTimersByTime(400);
    });

    act(() => {
      result.current.flushDraft();
    });

    expect(result.current.draft.name).toBe("Remote Name");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("marks a draft pending until the debounce commits it", () => {
    const onCommit = jest.fn();
    const onDraftPendingChange = jest.fn();
    const { result } = renderHook(() =>
      useOverlayDraft(baseOverlay, onCommit, onDraftPendingChange),
    );

    act(() => {
      result.current.patchDraft({ name: "New local name" });
    });

    expect(onDraftPendingChange).toHaveBeenLastCalledWith("overlay-1", true);
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(onDraftPendingChange).toHaveBeenLastCalledWith("overlay-1", false);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "overlay-1", name: "New local name" }),
    );
  });
});
