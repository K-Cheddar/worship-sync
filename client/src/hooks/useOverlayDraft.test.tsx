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

    expect(onDraftPendingChange).toHaveBeenLastCalledWith("overlay-1", true, expect.any(String));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(onDraftPendingChange).toHaveBeenLastCalledWith("overlay-1", false, expect.any(String));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "overlay-1", name: "New local name" }),
    );
  });

  it.each(["overlay-1", "overlay-2"])("keeps the outgoing callback when a new owner selects %s", (id) => {
    const ownerA = {};
    const ownerB = {};
    const saveA = jest.fn();
    const saveB = jest.fn();
    const { result, rerender, unmount } = renderHook(
      ({ overlay, save, owner }) => useOverlayDraft(overlay, save, undefined, owner),
      { initialProps: { overlay: baseOverlay, save: saveA, owner: ownerA } },
    );
    act(() => result.current.patchDraft({ name: "A pending" }));
    rerender({ overlay: { ...baseOverlay, id, name: "B original" }, save: saveB, owner: ownerB });
    expect(saveA).toHaveBeenCalledWith(expect.objectContaining({ id: "overlay-1", name: "A pending" }));
    expect(saveB).not.toHaveBeenCalled();
    expect(result.current.draft.name).toBe("B original");
    act(() => result.current.patchDraft({ name: "B pending" }));
    unmount();
    expect(saveB).toHaveBeenCalledWith(expect.objectContaining({ id, name: "B pending" }));
    expect(saveA).toHaveBeenCalledTimes(1);
  });

  it("gives replacement drafts with the same overlay ID distinct pending identities", () => {
    const ownerA = {};
    const ownerB = {};
    const pendingA = jest.fn();
    const pendingB = jest.fn();
    const { result, rerender } = renderHook(
      ({ owner, pending }) => useOverlayDraft(baseOverlay, jest.fn(), pending, owner),
      { initialProps: { owner: ownerA, pending: pendingA } },
    );

    act(() => result.current.patchDraft({ name: "Outgoing draft" }));
    const oldDraftId = pendingA.mock.calls.find(([, isPending]) => isPending)?.[2];
    expect(oldDraftId).toBeTruthy();

    rerender({ owner: ownerB, pending: pendingB });
    act(() => result.current.patchDraft({ name: "Replacement draft" }));
    const newDraftId = pendingB.mock.calls.find(([, isPending]) => isPending)?.[2];

    expect(newDraftId).toBeTruthy();
    expect(newDraftId).not.toBe(oldDraftId);
    expect(pendingA).toHaveBeenLastCalledWith("overlay-1", false, oldDraftId);
    expect(pendingB).toHaveBeenLastCalledWith("overlay-1", true, newDraftId);
  });

  it("flushes a selection change with the outgoing callback and debounces the next draft", () => {
    const saveA = jest.fn();
    const saveB = jest.fn();
    const { result, rerender } = renderHook(
      ({ overlay, save }) => useOverlayDraft(overlay, save),
      { initialProps: { overlay: baseOverlay, save: saveA } },
    );
    act(() => result.current.patchDraft({ name: "First pending" }));
    rerender({ overlay: { ...baseOverlay, id: "second" }, save: saveB });
    expect(saveA).toHaveBeenCalledWith(expect.objectContaining({ id: "overlay-1", name: "First pending" }));
    expect(saveB).not.toHaveBeenCalled();
    act(() => result.current.patchDraft({ name: "Second pending" }));
    act(() => jest.advanceTimersByTime(300));
    expect(saveB).toHaveBeenCalledWith(expect.objectContaining({ id: "second", name: "Second pending" }));
  });
});
