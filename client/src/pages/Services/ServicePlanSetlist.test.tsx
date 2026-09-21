import { fireEvent, render, screen } from "@testing-library/react";

import { searchYouTubeVideos } from "../../api/auth";
import type { DBItem } from "../../types";
import type { ServicePlanSection, ServicePlanSongReference } from "../../types/servicePlan";
import ServicePlanSetlist from "./ServicePlanSetlist";

jest.mock("../../components/SongLinkPreview/SongLinkPreview", () => ({
  __esModule: true,
  default: ({ link }: { link: { label?: string; url: string } }) => (
    <a href={link.url}>{link.label || link.url}</a>
  ),
}));

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  searchYouTubeVideos: jest.fn(),
}));

jest.mock("../../components/YouTubePlaylistPlayer/YouTubePlaylistPlayer", () => ({
  __esModule: true,
  default: () => null,
}));

const makeSong = (id: string, name: string, url?: string): DBItem =>
  ({
    _id: id,
    name,
    type: "song",
    selectedArrangement: 0,
    arrangements: [],
    slides: [],
    shouldSendTo: { projector: true, monitor: true, stream: true },
    songMetadata: {
      source: "manual",
      trackName: name,
      artistName: "Artist",
      albumName: "Album",
      importedAt: "2026-01-01T00:00:00.000Z",
    },
    ...(url ? { songLinks: [{ id: `${id}-link`, label: "YouTube", url }] } : {}),
  }) as DBItem;

const ref = (songId: string, songName: string): ServicePlanSongReference => ({
  kind: "library",
  songId,
  songName,
});

describe("ServicePlanSetlist YouTube workflow", () => {
  beforeEach(() => {
    jest.mocked(searchYouTubeVideos).mockResolvedValue({
      query: "Missing song Artist",
      cached: false,
      results: [],
    });
  });

  it("shows playable counts and opens the shared picker with missing-song metadata", async () => {
    const firstRef = ref("song-1", "First song");
    const secondRef = ref("song-2", "Missing song");
    const sections = [
      {
        id: "section-1",
        name: "Worship",
        elements: [
          { id: "element-1", type: "song", title: { ops: [] }, songRefs: [firstRef] },
          { id: "element-2", type: "song", title: { ops: [] }, songRefs: [secondRef] },
        ],
      },
    ] as unknown as ServicePlanSection[];
    const songs = [
      makeSong("song-1", "First song", "https://youtu.be/aaaaaaaaaaa"),
      makeSong("song-2", "Missing song"),
    ];
    const resolvedSongRefs = new Map<string, ServicePlanSongReference[]>([
      ["element-1", [firstRef]],
      ["element-2", [secondRef]],
    ]);

    render(
      <ServicePlanSetlist
        sections={sections}
        songs={songs}
        resolvedSongRefs={resolvedSongRefs}
        onViewSong={jest.fn()}
        onLinkYouTubeVideo={jest.fn()}
      />,
    );

    expect(screen.getByText("1 of 2 songs playable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find video" }));
    expect(await screen.findByRole("dialog", { name: "Find YouTube video" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search YouTube:")).toHaveValue("Missing song Artist");
    expect(screen.getByText("Search YouTube:")).toHaveClass("text-gray-200");
  });
});
