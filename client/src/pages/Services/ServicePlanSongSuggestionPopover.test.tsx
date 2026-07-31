import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import ServicePlanSongSuggestionPopover from "./ServicePlanSongSuggestionPopover";
import type { DBItem, ServiceItem } from "../../types";

const songDoc = (name: string): DBItem =>
  ({ _id: name, name, type: "song" }) as unknown as DBItem;

const createTestStore = (songs: string[]) =>
  configureStore({
    reducer: {
      allDocs: (state = { allSongDocs: songs.map(songDoc) }) => state,
      allItems: (
        state = { list: [] as ServiceItem[], isAllItemsLoading: false },
      ) => state,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
  });

const renderPopover = ({
  title,
  songs,
  onSelectSong = jest.fn(),
  onOpenLibrary = jest.fn(),
  onCreateSong,
  onOpenChange = jest.fn(),
}: {
  title: string;
  songs: string[];
  onSelectSong?: jest.Mock;
  onOpenLibrary?: jest.Mock;
  onCreateSong?: jest.Mock;
  onOpenChange?: jest.Mock;
}) => {
  render(
    <Provider store={createTestStore(songs)}>
      <ServicePlanSongSuggestionPopover
        open
        onOpenChange={onOpenChange}
        title={title}
        onSelectSong={onSelectSong}
        onOpenLibrary={onOpenLibrary}
        onCreateSong={onCreateSong}
        anchor={<button type="button">Song chip</button>}
      />
    </Provider>,
  );
  return { onSelectSong, onOpenLibrary, onCreateSong, onOpenChange };
};

describe("ServicePlanSongSuggestionPopover", () => {
  const library = [
    "Rolled the Sea Away (Live)",
    "Rolled Away",
    "How Great Is Our God",
    "Amazing Grace",
  ];

  it("offers the closest library songs for an unmatched title", () => {
    renderPopover({ title: "Rolled the Sea Away", songs: library });

    expect(screen.getByText("Rolled the Sea Away")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rolled the Sea Away (Live)" }),
    ).toBeInTheDocument();
    // Nothing close is left out, but unrelated songs never appear.
    expect(
      screen.queryByRole("button", { name: "Amazing Grace" }),
    ).not.toBeInTheDocument();
  });

  it("links the song and closes when a suggestion is chosen", async () => {
    const user = userEvent.setup();
    const { onSelectSong, onOpenChange } = renderPopover({
      title: "Rolled the Sea Away",
      songs: library,
    });

    await user.click(
      screen.getByRole("button", { name: "Rolled the Sea Away (Live)" }),
    );

    expect(onSelectSong).toHaveBeenCalledWith({
      kind: "library",
      songId: "Rolled the Sea Away (Live)",
      songName: "Rolled the Sea Away (Live)",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says so when the library holds nothing close", () => {
    renderPopover({ title: "Way Maker", songs: ["Amazing Grace"] });

    expect(
      screen.getByText(/No close matches in your song library/i),
    ).toBeInTheDocument();
  });

  it("always offers the full library as a way out", async () => {
    const user = userEvent.setup();
    const { onOpenLibrary, onOpenChange } = renderPopover({
      title: "Way Maker",
      songs: ["Amazing Grace"],
    });

    await user.click(screen.getByRole("button", { name: /Search library/i }));

    expect(onOpenLibrary).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers create song beside search when create is available", async () => {
    const user = userEvent.setup();
    const onCreateSong = jest.fn();
    const { onOpenChange } = renderPopover({
      title: "Way Maker",
      songs: ["Amazing Grace"],
      onCreateSong,
    });

    await user.click(screen.getByRole("button", { name: /Create song/i }));

    expect(onCreateSong).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides create song when create is not available", () => {
    renderPopover({
      title: "Way Maker",
      songs: ["Amazing Grace"],
    });

    expect(
      screen.queryByRole("button", { name: /Create song/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Search library/i }),
    ).toBeInTheDocument();
  });
});
