import { render, screen } from "@testing-library/react";
import { VirtualMediaGrid } from "./VirtualMediaGrid";
import type { MediaType } from "../../types";

jest.mock("@tanstack/react-virtual", () => {
  const React = jest.requireActual("react") as typeof import("react");

  return {
    useVirtualizer: ({ count }: { count: number }) => {
      const [, forceRender] = React.useState(0);
      return React.useMemo(
        () => ({
          getTotalSize: () => count * 100,
          getVirtualItems: () =>
            count > 0
              ? [{ index: 0, key: "0", start: 0 }]
              : [],
          measureElement: (element: HTMLElement | null) => {
            if (element) forceRender((value) => value + 1);
          },
          measure: jest.fn(),
          scrollToIndex: jest.fn(),
        }),
        [count, forceRender],
      );
    },
  };
});

jest.mock("./MediaLibraryGridMediaTile", () => ({
  __esModule: true,
  default: ({ mediaItem }: { mediaItem: MediaType }) => (
    <div>{mediaItem.name}</div>
  ),
}));

const mediaItem = {
  id: "media-1",
  name: "Welcome",
  type: "image",
} as MediaType;

describe("VirtualMediaGrid", () => {
  it("does not loop when virtualizer measurement causes a rerender", () => {
    expect(() =>
      render(
        <VirtualMediaGrid
          scrollRef={{ current: null }}
          mediaItems={[mediaItem]}
          cols={1}
          showFolders={false}
          childFolders={[]}
          canGoUp={false}
          onGoUp={jest.fn()}
          onOpenFolder={jest.fn()}
          selectedMedia={{} as MediaType}
          selectedMediaIds={new Set()}
          mediaMultiSelectMode={false}
          onMediaTileClick={jest.fn()}
          onEnterMediaMultiSelectMode={jest.fn()}
          showBottomName={false}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });
});
