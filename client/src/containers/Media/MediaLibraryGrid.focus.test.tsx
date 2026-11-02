import { act, render, screen } from "@testing-library/react";
import MediaLibraryGrid from "./MediaLibraryGrid";
import type { VirtualMediaGridHandle } from "./VirtualMediaGrid";
import type { MediaType } from "../../types";

jest.mock("./MediaLibraryGridMediaTile", () => ({
  __esModule: true,
  default: ({ mediaItem }: { mediaItem: MediaType }) => <div>{mediaItem.name}</div>,
}));

const items = Array.from({ length: 200 }, (_, index) => ({
  id: `media-${index}`, name: `Media ${index}`, type: "image",
}) as MediaType);

it("opens the panel and reveals a far item with the real virtualizer, including a repeated request", async () => {
  jest.useFakeTimers();
  const scrollRef = { current: null } as React.RefObject<HTMLElement | null>;
  const gridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, descriptor: PropertyDescriptor) => {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, ...descriptor });
  };
  define("offsetHeight", { get() { return this === scrollRef.current ? 200 : 80; } });
  define("clientHeight", { get() { return this === scrollRef.current ? 200 : 80; } });
  define("offsetWidth", { get: () => 400 });
  define("scrollHeight", { get: () => 8416 });
  const scrollTo = jest.fn(function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? 0;
    setTimeout(() => this.dispatchEvent(new Event("scroll")), 0);
  });
  define("scrollTo", { value: scrollTo });
  const bounds = jest.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const index = this.dataset.mediaId?.replace("media-", "");
      const top = index === undefined ? 0 :
        16 + Math.floor(Number(index) / 2) * 84 - (scrollRef.current?.scrollTop ?? 0);
      const height = this === scrollRef.current ? 200 : 80;
      return { top, bottom: top + height, height, width: 400,
        left: 0, right: 400, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  const panel = (expanded: boolean) => (
    <MediaLibraryGrid
      isPanelVariant isMediaExpanded={expanded} isMediaLoading={false}
      hasMediaLoadError={false} mediaItemsPerRow={2} mediaListRef={scrollRef}
      mediaGridRef={gridRef} filteredList={items} showAll showNamesInPanelGrid={false}
      searchTerm="" childFolders={[]} canGoUp={false} onGoUp={jest.fn()}
      onOpenFolder={jest.fn()} selectedMedia={items[199]} selectedMediaIds={new Set()}
      mediaMultiSelectMode={false} onMediaTileClick={jest.fn()}
      onEnterMediaMultiSelectMode={jest.fn()}
    />
  );
  const frames = async () => {
    for (let frame = 0; frame < 8; frame += 1) {
      await act(async () => { jest.advanceTimersByTime(16); });
    }
  };

  const view = render(panel(false));
  try {
    expect(gridRef.current).toBeNull();
    view.rerender(panel(true));
    expect(screen.queryByText("Media 199")).not.toBeInTheDocument();
    let result!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => { result = gridRef.current!.scrollToMediaId("media-199"); });
    await frames();
    await expect(result).resolves.toEqual({ status: "success" });
    expect(screen.getByText("Media 199")).toBeInTheDocument();
    expect(scrollRef.current!.scrollTop).toBeGreaterThan(8000);
    expect(16 + 99 * 84 - scrollRef.current!.scrollTop).toBeGreaterThanOrEqual(0);
    expect(16 + 99 * 84 + 80 - scrollRef.current!.scrollTop).toBeLessThanOrEqual(200);

    await act(async () => { scrollRef.current!.scrollTo({ top: 0 }); });
    await frames();
    expect(screen.queryByText("Media 199")).not.toBeInTheDocument();
    await act(async () => { result = gridRef.current!.scrollToMediaId("media-199"); });
    await frames();
    await expect(result).resolves.toEqual({ status: "success" });
    expect(screen.getByText("Media 199")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  } finally {
    view.unmount();
    bounds.mockRestore();
    originalDescriptors.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, key);
    });
    jest.useRealTimers();
  }
});
