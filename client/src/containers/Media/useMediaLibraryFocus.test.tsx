import { act, renderHook } from "@testing-library/react";
import type { MediaType } from "../../types";
import type { AppDispatch } from "../../store/store";
import { useMediaLibraryFocus } from "./useMediaLibraryFocus";
import type { VirtualMediaGridHandle } from "./VirtualMediaGrid";
import { MEDIA_LIBRARY_ROOT_VIEW } from "../../utils/mediaFolderMutations";

const target = {
  id: "target-media",
  name: "Target",
  type: "image",
  folderId: null,
} as MediaType;
const other = {
  id: "other-media",
  name: "Other",
  type: "image",
  folderId: null,
} as MediaType;
const folderTarget = { ...target, folderId: "folder-1" } as MediaType;

type FocusProps = Parameters<typeof useMediaLibraryFocus>[0];

const createProps = (
  overrides: Partial<FocusProps> = {},
): FocusProps => {
  const list = overrides.list ?? [target, other];
  return {
    dispatch: jest.fn() as unknown as AppDispatch,
    focusMediaId: "target-media",
    list,
    filteredList: overrides.filteredList ?? list,
    isMediaLoading: false,
    isMediaExpanded: true,
    selectedLibraryFilter: MEDIA_LIBRARY_ROOT_VIEW,
    pendingDeletionIds: new Set(),
    deviceId: "device-1",
    routeKey: "controller-default",
    mediaGridRef: { current: null },
    setSearchTerm: jest.fn(),
    setOriginFilter: jest.fn(),
    setTypeFilter: jest.fn(),
    setShowOtherDeviceLocalMedia: jest.fn(),
    setSelectedMedia: jest.fn(),
    setSelectedMediaIds: jest.fn(),
    setPreviewMedia: jest.fn(),
    ...overrides,
  };
};

describe("useMediaLibraryFocus", () => {
  let frameCallbacks: Array<FrameRequestCallback>;
  let requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;

  beforeEach(() => {
    frameCallbacks = [];
    requestAnimationFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });
    cancelAnimationFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  const flushFrame = async () => {
    const callback = frameCallbacks.shift();
    await act(async () => {
      callback?.(0);
      await Promise.resolve();
    });
  };

  const successGrid = (): React.RefObject<VirtualMediaGridHandle | null> => ({
    current: {
      scrollToMediaId: jest.fn(() => Promise.resolve({ status: "success" })),
    },
  });

  it("scrolls when the right panel and media library are already open", async () => {
    const mediaGridRef = successGrid();
    const props = createProps({ mediaGridRef });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    rerender({ ...props, focusMediaId: null });
    await act(async () => undefined);

    expect(mediaGridRef.current!.scrollToMediaId).toHaveBeenCalledWith(
      "target-media",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("retains focus while the right panel opens from an initially closed viewport", async () => {
    const statuses: Array<"not-ready" | "success"> = ["not-ready", "success"];
    const scrollToMediaId = jest.fn(() =>
      Promise.resolve({ status: statuses.shift() ?? "success" }),
    );
    const mediaGridRef = {
      current: { scrollToMediaId },
    } as React.RefObject<VirtualMediaGridHandle | null>;
    const props = createProps({ mediaGridRef });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    rerender({ ...props, focusMediaId: null });
    await act(async () => undefined);
    await flushFrame();

    expect(scrollToMediaId).toHaveBeenCalledTimes(2);
  });

  it("waits for a collapsed media library to expand", async () => {
    const mediaGridRef = successGrid();
    const props = createProps({ mediaGridRef, isMediaExpanded: false });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    expect(mediaGridRef.current!.scrollToMediaId).not.toHaveBeenCalled();

    rerender({ ...props, focusMediaId: null, isMediaExpanded: true });
    await act(async () => undefined);

    expect(mediaGridRef.current!.scrollToMediaId).toHaveBeenCalledTimes(1);
  });

  it("waits for folder navigation before attempting the scroll", async () => {
    const mediaGridRef = successGrid();
    const props = createProps({
      list: [folderTarget],
      filteredList: [folderTarget],
      mediaGridRef,
    });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    expect(mediaGridRef.current!.scrollToMediaId).not.toHaveBeenCalled();

    rerender({
      ...props,
      focusMediaId: null,
      selectedLibraryFilter: "folder-1",
    });
    await act(async () => undefined);

    expect(mediaGridRef.current!.scrollToMediaId).toHaveBeenCalledTimes(1);
  });

  it("leaves acknowledgement pending while the virtual grid mounts a far row", async () => {
    let resolveScroll!: (result: { status: "success" }) => void;
    const scrollToMediaId = jest.fn(
      () => new Promise<{ status: "success" }>((resolve) => (resolveScroll = resolve)),
    );
    const mediaGridRef = {
      current: { scrollToMediaId },
    } as React.RefObject<VirtualMediaGridHandle | null>;
    const props = createProps({ mediaGridRef });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    rerender({ ...props, focusMediaId: null });
    await act(async () => undefined);
    expect(scrollToMediaId).toHaveBeenCalledTimes(1);

    resolveScroll({ status: "success" });
    await act(async () => undefined);
    expect(scrollToMediaId).toHaveBeenCalledTimes(1);
  });

  it("retries a zero-height viewport when layout becomes measurable", async () => {
    const statuses: Array<"not-ready" | "success"> = ["not-ready", "success"];
    const scrollToMediaId = jest.fn(() =>
      Promise.resolve({ status: statuses.shift() ?? "success" }),
    );
    const mediaGridRef = {
      current: { scrollToMediaId },
    } as React.RefObject<VirtualMediaGridHandle | null>;
    const props = createProps({ mediaGridRef });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    rerender({ ...props, focusMediaId: null });
    await act(async () => undefined);
    expect(scrollToMediaId).toHaveBeenCalledTimes(1);

    rerender({ ...props, focusMediaId: null });
    await flushFrame();
    expect(scrollToMediaId).toHaveBeenCalledTimes(2);
  });

  it("does not discard a not-ready first attempt before its retry", async () => {
    const statuses: Array<"not-ready" | "success"> = ["not-ready", "success"];
    const scrollToMediaId = jest.fn(() =>
      Promise.resolve({ status: statuses.shift() ?? "success" }),
    );
    const mediaGridRef = {
      current: { scrollToMediaId },
    } as React.RefObject<VirtualMediaGridHandle | null>;
    const props = createProps({ mediaGridRef });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    rerender({ ...props, focusMediaId: null });
    await act(async () => undefined);
    expect(scrollToMediaId).toHaveBeenCalledTimes(1);
    expect(frameCallbacks).toHaveLength(1);

    await flushFrame();
    expect(scrollToMediaId).toHaveBeenCalledTimes(2);
  });

  it("cancels the older request when a newer Show in Media request arrives", async () => {
    const pending: Array<{
      id: string;
      signal: AbortSignal;
      resolve: (result: { status: "success" }) => void;
    }> = [];
    const scrollToMediaId = jest.fn(
      (id: string, options?: { signal?: AbortSignal }) =>
        new Promise<{ status: "success" }>((resolve) => {
          pending.push({ id, signal: options?.signal as AbortSignal, resolve });
        }),
    );
    const mediaGridRef = {
      current: { scrollToMediaId },
    } as React.RefObject<VirtualMediaGridHandle | null>;
    const props = createProps({
      mediaGridRef,
      list: [target, other],
      filteredList: [target, other],
    });
    const { rerender } = renderHook((currentProps) => useMediaLibraryFocus(currentProps), {
      initialProps: props,
    });
    rerender({ ...props, focusMediaId: null });
    await act(async () => undefined);
    expect(pending[0]?.id).toBe("target-media");

    const newerProps = {
      ...props,
      focusMediaId: "other-media",
      filteredList: [target, other],
    };
    rerender(newerProps);
    await act(async () => undefined);

    expect(pending[0]?.signal.aborted).toBe(true);
    expect(pending[1]?.id).toBe("other-media");
    pending[1]?.resolve({ status: "success" });
    await act(async () => undefined);
    expect(scrollToMediaId).toHaveBeenCalledTimes(2);
  });
});
