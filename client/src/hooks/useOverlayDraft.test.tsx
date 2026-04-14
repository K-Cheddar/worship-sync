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
});
