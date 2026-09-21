import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { searchYouTubeVideos } from "../../api/auth";
import YouTubeVideoPicker from "./YouTubeVideoPicker";

const mockPreviewPlayEntry = jest.fn();
const mockPreviewDestroy = jest.fn();

jest.mock("../YouTubePlaylistPlayer/YouTubePlaylistPlayer", () => {
  const React = jest.requireActual("react");
  return {
    __esModule: true,
    default: React.forwardRef(
      (
        {
          queue,
          autoPlayEntryKey,
        }: { queue: Array<{ videoId: string }>; autoPlayEntryKey?: string | null },
        ref: React.ForwardedRef<{ playAll: () => void; playEntry: (entryKey: string) => void }>,
      ) => {
        React.useImperativeHandle(ref, () => ({
          playAll: jest.fn(),
          playEntry: mockPreviewPlayEntry,
        }));
        React.useEffect(() => {
          if (autoPlayEntryKey) mockPreviewPlayEntry(autoPlayEntryKey);
        }, [autoPlayEntryKey]);
        React.useEffect(() => () => mockPreviewDestroy(), []);
        return React.createElement(
          "section",
          { role: "region", "aria-label": "YouTube video preview" },
          queue[0]?.videoId,
        );
      },
    ),
  };
});

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  searchYouTubeVideos: jest.fn(),
}));

const mockSearch = jest.mocked(searchYouTubeVideos);

const firstResult = {
  videoId: "dQw4w9WgXcQ",
  title: "Living Hope (Official Video)",
  channelName: "Phil Wickham",
  thumbnail: "https://img.example/thumb.jpg",
  description: "Official recording",
  durationSeconds: 240,
  embeddable: true,
  watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

const secondResult = {
  ...firstResult,
  videoId: "aaaaaaaaaaa",
  title: "Living Hope (Live)",
  watchUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
};

describe("YouTubeVideoPicker", () => {
  beforeEach(() => {
    mockPreviewPlayEntry.mockReset();
    mockPreviewDestroy.mockReset();
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({
      query: "Living Hope Phil Wickham",
      cached: false,
      results: [firstResult, secondResult],
    });
  });

  it("uses metadata-only generated queries, supports edits, and keeps refresh hidden", async () => {
    const onSelect = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(
      <YouTubeVideoPicker
        isOpen
        onClose={onClose}
        title="Living Hope"
        artist="Phil Wickham"
        album="The Ascension"
        onSelect={onSelect}
      />,
    );

    expect(await screen.findByText("Living Hope (Official Video)")).toBeInTheDocument();
    expect(mockSearch).toHaveBeenCalledWith({
      title: "Living Hope",
      artist: "Phil Wickham",
      album: "The Ascension",
      query: "Living Hope Phil Wickham",
      forceRefresh: false,
    });
    expect(screen.queryByRole("button", { name: "Refresh YouTube results" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();

    const queryInput = screen.getByLabelText("Search YouTube:");
    fireEvent.change(queryInput, { target: { value: "Living Hope live" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(mockSearch).toHaveBeenLastCalledWith({
        title: "Living Hope",
        artist: "Phil Wickham",
        album: "The Ascension",
        query: "Living Hope live",
        forceRefresh: false,
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Link video" })[0]);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(firstResult));
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the modal theme color for the search label", async () => {
    render(
      <YouTubeVideoPicker
        isOpen
        onClose={jest.fn()}
        title="Missing song"
        artist="Artist"
        album="Album"
        onSelect={jest.fn()}
      />,
    );

    await screen.findByText("Living Hope (Official Video)");
    expect(screen.getByText("Search YouTube:")).toHaveClass("text-gray-200");
  });

  it("previews in-app with one player, switches videos, and never saves or navigates", async () => {
    const onSelect = jest.fn();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <YouTubeVideoPicker
        isOpen
        onClose={jest.fn()}
        title="Living Hope"
        artist="Phil Wickham"
        onSelect={onSelect}
      />,
    );

    await screen.findByText("Living Hope (Official Video)");
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    expect(mockPreviewPlayEntry).toHaveBeenCalledWith("dQw4w9WgXcQ");
    expect(screen.getByRole("region", { name: "YouTube video preview" })).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[1]);
    expect(mockPreviewPlayEntry).toHaveBeenLastCalledWith("aaaaaaaaaaa");
    openSpy.mockRestore();
  });

  it("destroys the preview player when the modal closes", async () => {
    const onClose = jest.fn();
    render(
      <YouTubeVideoPicker
        isOpen
        onClose={onClose}
        title="Living Hope"
        onSelect={jest.fn()}
      />,
    );

    await screen.findByText("Living Hope (Official Video)");
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    expect(screen.getByRole("region", { name: "YouTube video preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    await waitFor(() => expect(mockPreviewDestroy).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });
});
