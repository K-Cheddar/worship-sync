import { fireEvent, render, screen } from "@testing-library/react";

import { searchYouTubeVideos } from "../../api/auth";
import type { DBItem } from "../../types";
import type { ServicePlanSection, ServicePlanSongReference } from "../../types/servicePlan";
import ServicePlanSetlist from "./ServicePlanSetlist";
import { useRehearsalPlaybackController } from "../../components/RehearsalPlayer/RehearsalPlaybackContext";

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

jest.mock("../../components/RehearsalPlayer/RehearsalPlaybackContext", () => ({
  useRehearsalPlaybackController: jest.fn(),
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
    jest.mocked(useRehearsalPlaybackController).mockReturnValue({
      currentEntry: null,
      durationByEntryKey: {},
      isPlaying: false,
      isLoading: false,
      playEntry: jest.fn(),
      playQueue: jest.fn(),
      togglePlayback: jest.fn(),
    } as unknown as ReturnType<typeof useRehearsalPlaybackController>);
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

    expect(screen.getByText("1 of 2 playable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find video" }));
    expect(await screen.findByRole("dialog", { name: "Find YouTube video" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search YouTube:")).toHaveValue("Missing song Artist");
    expect(screen.getByText("Search YouTube:")).toHaveClass("text-gray-200");
  });

  it("plays MP3-only songs in Play All and lets a dual-source row request its MP3", () => {
    const mp3Only = makeSong("mp3-only", "MP3 only");
    mp3Only.songAudio = {
      id: "audio-only", key: "audio-only-key", fileName: "only.mp3",
      contentType: "audio/mpeg", sizeBytes: 512, uploadedAt: "2026-01-01T00:00:00.000Z",
    };
    const both = makeSong("both", "Both sources", "https://youtu.be/aaaaaaaaaaa");
    both.songLinks![0].durationSeconds = 100;
    both.songAudio = {
      id: "audio-both", key: "audio-both-key", fileName: "both.mp3",
      contentType: "audio/mpeg", sizeBytes: 512, uploadedAt: "2026-01-01T00:00:00.000Z",
    };
    const refs = [ref("mp3-only", "MP3 only"), ref("both", "Both sources")];
    const sections = [{
      id: "section-1",
      name: "Worship",
      elements: refs.map((songRef, index) => ({
        id: `element-${index + 1}`,
        type: "song",
        title: { ops: [] },
        songRefs: [songRef],
      })),
    }] as unknown as ServicePlanSection[];
    const playEntry = jest.fn();
    const playQueue = jest.fn();
    jest.mocked(useRehearsalPlaybackController).mockReturnValue({
      currentEntry: null,
      durationByEntryKey: { "element-1:0": 90 },
      isPlaying: false,
      isLoading: false,
      playEntry,
      playQueue,
      togglePlayback: jest.fn(),
    } as unknown as ReturnType<typeof useRehearsalPlaybackController>);

    render(
      <ServicePlanSetlist
        sections={sections}
        songs={[mp3Only, both]}
        resolvedSongRefs={new Map()}
        onViewSong={jest.fn()}
      />,
    );

    expect(screen.getByText("2 of 2 playable · 3:10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play All" }));
    const allQueue = playQueue.mock.calls[0][0];
    expect(allQueue.map((entry: { source: { kind: string } }) => entry.source.kind)).toEqual(["audio", "youtube"]);
    fireEvent.click(screen.getByRole("button", { name: "Play MP3 for Both sources" }));
    const audioQueue = playEntry.mock.calls[0][0];
    expect(audioQueue).toHaveLength(2);
    expect(audioQueue[1].source.kind).toBe("audio");
  });

  it("shows the trimmed duration in Rehearse and the playlist total", () => {
    const songRef = ref("song-trimmed", "Trimmed song");
    const sections = [{
      id: "section-1",
      name: "Worship",
      elements: [{ id: "element-1", type: "song", title: { ops: [] }, songRefs: [songRef] }],
    }] as unknown as ServicePlanSection[];
    const song = makeSong("song-trimmed", "Trimmed song", "https://youtu.be/aaaaaaaaaaa") as DBItem;
    song.songLinks![0].durationSeconds = 240;
    song.songLinks![0].segments = [
      { id: "first", startSeconds: 25, endSeconds: 55 },
      { id: "second", startSeconds: 90, endSeconds: 130 },
    ];

    render(
      <ServicePlanSetlist
        sections={sections}
        songs={[song]}
        resolvedSongRefs={new Map([["element-1", [songRef]]])}
        onViewSong={jest.fn()}
      />,
    );

    expect(screen.getByText("1 of 1 playable · 1:10")).toBeInTheDocument();
    expect(screen.getByText("1:10")).toBeInTheDocument();
  });

  it("highlights the active entry and reflects the global playing state when revisited", () => {
    const songRef = ref("song-1", "First song");
    const sections = [{
      id: "section-1",
      name: "Worship",
      elements: [{ id: "element-1", type: "song", title: { ops: [] }, songRefs: [songRef] }],
    }] as unknown as ServicePlanSection[];
    const song = makeSong("song-1", "First song", "https://youtu.be/aaaaaaaaaaa");
    jest.mocked(useRehearsalPlaybackController).mockReturnValue({
      currentEntry: {
        entryKey: "service-1:element-1:0",
        songId: "song-1",
        title: "First song",
        source: { kind: "youtube", videoId: "aaaaaaaaaaa", ranges: [{}] },
      },
      durationByEntryKey: {},
      isPlaying: true,
      isLoading: false,
      playEntry: jest.fn(),
      playQueue: jest.fn(),
      togglePlayback: jest.fn(),
    } as unknown as ReturnType<typeof useRehearsalPlaybackController>);

    render(
      <ServicePlanSetlist
        planKey="service-1"
        sections={sections}
        songs={[song]}
        resolvedSongRefs={new Map()}
        onViewSong={jest.fn()}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Pause First song" })).toBeInTheDocument();
  });

  it("groups repeated library references once and queues one entry for Play All", () => {
    const songRef = { ...ref("song-1", "First song"), key: "D" };
    const sections = [{
      id: "section-1",
      name: "Worship",
      elements: [1, 2, 3].map((number) => ({
        id: `element-${number}`,
        type: "song",
        title: { ops: [] },
        songRefs: [songRef],
      })),
    }] as unknown as ServicePlanSection[];
    const song = makeSong("song-1", "First song", "https://youtu.be/aaaaaaaaaaa");
    song.songLinks![0].durationSeconds = 240;
    song.songLinks![0].segments = [
      { id: "first", startSeconds: 25, endSeconds: 55 },
      { id: "second", startSeconds: 90, endSeconds: 130 },
    ];

    render(
      <ServicePlanSetlist
        sections={sections}
        songs={[song]}
        resolvedSongRefs={new Map()}
        onViewSong={jest.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /View song details for First song/i })).toHaveLength(1);
    expect(screen.getByRole("note", {
      name: "Used 3 times in plan at number 1, number 2, number 3",
    })).toHaveTextContent("Used 3× in plan");
    expect(screen.getByText("1 song · 3 uses in plan")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 playable · 1:10")).toBeInTheDocument();
    expect(screen.getByText("1:10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play All" })).toBeInTheDocument();
  });

  it("keeps different keys and different song IDs separate even when titles match", () => {
    const songA = makeSong("song-a", "Same title", "https://youtu.be/aaaaaaaaaaa");
    const songB = makeSong("song-b", "Same title", "https://youtu.be/bbbbbbbbbbb");
    const refs = [
      { ...ref("song-a", "Same title"), key: "D" },
      { ...ref("song-a", "Same title"), key: "E" },
      { ...ref("song-b", "Same title"), key: "D" },
    ];
    const sections = [{
      id: "section-1",
      name: "Worship",
      elements: refs.map((songRef, index) => ({
        id: `element-${index}`,
        type: "song",
        title: { ops: [] },
        songRefs: [songRef],
      })),
    }] as unknown as ServicePlanSection[];

    render(
      <ServicePlanSetlist
        sections={sections}
        songs={[songA, songB]}
        resolvedSongRefs={new Map()}
        onViewSong={jest.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /View song details for Same title/i })).toHaveLength(3);
    expect(screen.getByText("3 songs")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Play Same title" })).toHaveLength(3);
  });

  it("does not merge ambiguous pending references by title", () => {
    const refs: ServicePlanSongReference[] = [
      { kind: "pending", title: "New song", lyricsText: "lyrics" },
      { kind: "pending", title: "New song", lyricsText: "different lyrics" },
    ];
    const sections = [{
      id: "section-1",
      name: "Worship",
      elements: refs.map((songRef, index) => ({
        id: `element-${index}`,
        type: "song",
        title: { ops: [] },
        songRefs: [songRef],
      })),
    }] as unknown as ServicePlanSection[];

    render(
      <ServicePlanSetlist
        sections={sections}
        songs={[]}
        resolvedSongRefs={new Map()}
        onViewSong={jest.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /View reference lyrics for New song/i })).toHaveLength(2);
    expect(screen.getByText("2 songs")).toBeInTheDocument();
  });
});
