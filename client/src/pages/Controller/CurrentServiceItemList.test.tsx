import React from "react";
import { render, screen, within } from "@testing-library/react";
import CurrentServiceItemList from "./CurrentServiceItemList";
import { keepElementInView } from "../../utils/generalUtils";
import { useLiveOutlinePreview } from "./useLiveOutlinePreview";

jest.mock("../../utils/generalUtils", () => ({
  keepElementInView: jest.fn(),
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: () => null,
}));

jest.mock("./useLiveOutlinePreview", () => ({
  useLiveOutlinePreview: jest.fn(),
}));

const mockedKeepElementInView = keepElementInView as jest.MockedFunction<
  typeof keepElementInView
>;
const mockedUseLiveOutlinePreview = useLiveOutlinePreview as jest.MockedFunction<
  typeof useLiveOutlinePreview
>;

describe("CurrentServiceItemList", () => {
  beforeEach(() => {
    mockedKeepElementInView.mockClear();
    mockedUseLiveOutlinePreview.mockReturnValue({
      items: [
        { listId: "item-1", _id: "song-1", name: "First song", type: "song" },
        { listId: "item-2", _id: "song-2", name: "Current song", type: "song" },
      ] as any,
      isLoading: false,
    });
  });

  it("centers the active item when the live item updates", () => {
    render(<CurrentServiceItemList activeListId="item-2" />);

    expect(screen.getByText("Current song")).toBeInTheDocument();
    expect(mockedKeepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({ shouldScrollToCenter: true }),
    );
  });

  it("can highlight a projector item by name when it has no outline ids", () => {
    render(<CurrentServiceItemList activeName="Current song" />);

    expect(screen.getByText("Current song")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("highlights the exact duplicate occurrence when a monitor list id is preserved", () => {
    mockedUseLiveOutlinePreview.mockReturnValue({
      items: [
        { listId: "song-a-first", _id: "song-a", name: "Song A", type: "song" },
        { listId: "song-a-second", _id: "song-a", name: "Song A", type: "song" },
      ] as any,
      isLoading: false,
    });

    render(
      <CurrentServiceItemList
        activeName="Song A"
        activeListId="song-a-second"
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).queryByText("Live")).not.toBeInTheDocument();
    expect(within(rows[1]).getByText("Live")).toBeInTheDocument();
  });
});
