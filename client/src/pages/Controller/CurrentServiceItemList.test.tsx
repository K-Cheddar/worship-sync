import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CurrentServiceItemList from "./CurrentServiceItemList";
import { keepElementInView } from "../../utils/generalUtils";
import { useLiveOutlinePreview } from "./useLiveOutlinePreview";
import ActiveControllerContext, { useActiveControllerId } from "../../context/activeController";

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

const ActiveControllerProbe = () => <span data-testid="active-controller">{useActiveControllerId()}</span>;

describe("CurrentServiceItemList", () => {
  beforeEach(() => {
    mockedKeepElementInView.mockClear();
    mockedUseLiveOutlinePreview.mockClear();
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
    expect(screen.queryByRole("group", { name: "Item list controller" })).not.toBeInTheDocument();
    expect(mockedKeepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({ shouldScrollToCenter: true }),
    );
  });

  it("can highlight a projector item by name when it has no outline ids", () => {
    render(<CurrentServiceItemList activeName="Current song" />);

    expect(screen.getByText("Current song")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("highlights the selected aux controller's live row without predicting the next item", () => {
    mockedUseLiveOutlinePreview.mockReturnValue({
      items: [
        { listId: "aux-row-1", _id: "aux-item-1", name: "TV live item", type: "song" },
        { listId: "aux-row-2", _id: "aux-item-2", name: "TV later item", type: "song" },
      ] as any,
      isLoading: false,
    });
    const controller = {
      id: "aux-a",
      type: "aux-presentation",
      name: "Aux · TVs",
      enabled: true,
      outlineScope: "aux-a",
    } as any;

    render(
      <CurrentServiceItemList
        controller={controller}
        activeListId="aux-row-1"
      />,
    );

    expect(screen.getByText("TV live item")).toBeInTheDocument();
    expect(screen.getByText("TV later item")).toBeInTheDocument();
    expect(screen.getAllByText("Live")).toHaveLength(1);
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
    expect(mockedUseLiveOutlinePreview).toHaveBeenCalledWith("aux-a");
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

  it("switches only the item list scope and leaves the active controller unchanged", async () => {
    const user = userEvent.setup();
    const onControllerChange = jest.fn();
    const profiles = [
      { id: "presentation", type: "presentation", name: "Presentation", enabled: true, outlineScope: "presentation" },
      { id: "aux-a", type: "aux-presentation", name: "Aux · TVs", enabled: true, outlineScope: "aux-a" },
    ] as any;
    const view = render(
      <ActiveControllerContext.Provider value="presentation">
        <ActiveControllerProbe />
        <CurrentServiceItemList
          controller={profiles[0]}
          controllers={profiles}
          onControllerChange={onControllerChange}
        />
      </ActiveControllerContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Aux · TVs" }));
    view.rerender(
      <ActiveControllerContext.Provider value="presentation">
        <ActiveControllerProbe />
        <CurrentServiceItemList
          controller={profiles[1]}
          controllers={profiles}
          onControllerChange={onControllerChange}
        />
      </ActiveControllerContext.Provider>,
    );

    expect(onControllerChange).toHaveBeenCalledWith("aux-a");
    expect(screen.getByTestId("active-controller")).toHaveTextContent("presentation");
    expect(mockedUseLiveOutlinePreview).toHaveBeenLastCalledWith("aux-a");
  });
});
