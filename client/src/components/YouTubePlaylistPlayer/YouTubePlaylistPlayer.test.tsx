import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

import YouTubePlaylistPlayer, { type YouTubePlaylistPlayerHandle } from "./YouTubePlaylistPlayer";
import type { YouTubePlaylistEntry } from "./youtubePlaylist";

const queue: YouTubePlaylistEntry[] = [
  { entryKey: "one", songId: "song-1", title: "First song", artist: "Artist", videoId: "aaaaaaaaaaa", playbackRanges: [{}] },
  { entryKey: "two", songId: "song-2", title: "Second song", artist: "Artist", videoId: "bbbbbbbbbbb", playbackRanges: [{}] },
];

describe("YouTubePlaylistPlayer", () => {
  it("uses one player, starts Play All in order, advances on ended, and stops at the end", async () => {
    const player = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      stopVideo: jest.fn(),
      cueVideoById: jest.fn(),
      loadVideoById: jest.fn(),
      seekTo: jest.fn(),
      getCurrentTime: jest.fn(() => 0),
      getDuration: jest.fn(() => 0),
      setVolume: jest.fn(),
      destroy: jest.fn(),
    };
    let events: {
      onReady?: () => void;
      onStateChange?: (event: { data: number }) => void;
    } = {};
    const Player = jest.fn((_element: HTMLElement, options: { events?: typeof events }) => {
      events = options.events || {};
      queueMicrotask(() => events.onReady?.());
      return player;
    });
    (window as Window & { YT?: unknown }).YT = { Player };

    const { unmount } = render(<YouTubePlaylistPlayer queue={queue} />);

    await waitFor(() => expect(Player).toHaveBeenCalledTimes(1));
    expect(screen.getByText("REHEARSAL PLAYLIST")).toBeInTheDocument();
    await waitFor(() => expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "aaaaaaaaaaa" }));
    fireEvent.click(screen.getByRole("button", { name: "Play All" }));
    expect(player.loadVideoById).toHaveBeenCalledWith({ videoId: "aaaaaaaaaaa" });

    act(() => events.onStateChange?.({ data: 0 }));
    expect(player.loadVideoById).toHaveBeenCalledWith({ videoId: "bbbbbbbbbbb" });

    act(() => events.onStateChange?.({ data: 1 }));
    act(() => events.onStateChange?.({ data: 0 }));
    expect(await screen.findByRole("status")).toHaveTextContent("Playlist finished");
    expect(player.loadVideoById).toHaveBeenCalledTimes(2);

    unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
    delete (window as Window & { YT?: unknown }).YT;
  });

  it("auto-plays preview entries and switches the same player", async () => {
    const player = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      stopVideo: jest.fn(),
      cueVideoById: jest.fn(),
      loadVideoById: jest.fn(),
      seekTo: jest.fn(),
      getCurrentTime: jest.fn(() => 0),
      getDuration: jest.fn(() => 0),
      setVolume: jest.fn(),
      destroy: jest.fn(),
    };
    const Player = jest.fn((_element: HTMLElement, options: { events?: { onReady?: () => void } }) => {
      queueMicrotask(() => options.events?.onReady?.());
      return player;
    });
    (window as Window & { YT?: unknown }).YT = { Player };

    const { rerender, unmount } = render(
      <YouTubePlaylistPlayer
        mode="preview"
        queue={[queue[0]]}
        autoPlayEntryKey="one"
      />,
    );

    await waitFor(() => expect(Player).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(player.loadVideoById).toHaveBeenCalledWith({ videoId: "aaaaaaaaaaa" }));

    rerender(
      <YouTubePlaylistPlayer
        mode="preview"
        queue={[queue[1]]}
        autoPlayEntryKey="two"
      />,
    );
    await waitFor(() => expect(player.loadVideoById).toHaveBeenCalledWith({ videoId: "bbbbbbbbbbb" }));
    expect(Player).toHaveBeenCalledTimes(1);

    unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
    delete (window as Window & { YT?: unknown }).YT;
  });

  it("loads each trimmed range, advances within a song, and keeps Next song-based", async () => {
    const player = {
      playVideo: jest.fn(), pauseVideo: jest.fn(), stopVideo: jest.fn(),
      cueVideoById: jest.fn(), loadVideoById: jest.fn(), seekTo: jest.fn(),
      getCurrentTime: jest.fn(() => 0), getDuration: jest.fn(() => 0),
      setVolume: jest.fn(), destroy: jest.fn(),
    };
    let events: { onReady?: () => void; onStateChange?: (event: { data: number }) => void } = {};
    const Player = jest.fn((_element: HTMLElement, options: { events?: typeof events }) => {
      events = options.events || {};
      queueMicrotask(() => events.onReady?.());
      return player;
    });
    (window as Window & { YT?: unknown }).YT = { Player };
    const rangedQueue: YouTubePlaylistEntry[] = [
      { ...queue[0], playbackRanges: [{ startSeconds: 10, endSeconds: 20 }, { startSeconds: 30, endSeconds: 45 }] },
      queue[1],
    ];
    const { unmount } = render(<YouTubePlaylistPlayer queue={rangedQueue} />);
    await waitFor(() => expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 10, endSeconds: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Play All" }));
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 10, endSeconds: 20 });
    act(() => events.onStateChange?.({ data: 0 }));
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 30, endSeconds: 45 });
    act(() => events.onStateChange?.({ data: 1 }));
    act(() => events.onStateChange?.({ data: 0 }));
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "bbbbbbbbbbb" });

    unmount();
    delete (window as Window & { YT?: unknown }).YT;
  });

  it("reports completion only after the final configured range in external playback", async () => {
    const player = {
      playVideo: jest.fn(), pauseVideo: jest.fn(), stopVideo: jest.fn(),
      cueVideoById: jest.fn(), loadVideoById: jest.fn(), seekTo: jest.fn(),
      getCurrentTime: jest.fn(() => 0), getDuration: jest.fn(() => 60),
      setVolume: jest.fn(), destroy: jest.fn(),
    };
    let events: { onReady?: () => void; onStateChange?: (event: { data: number }) => void } = {};
    const Player = jest.fn((_element: HTMLElement, options: { events?: typeof events }) => {
      events = options.events || {};
      queueMicrotask(() => events.onReady?.());
      return player;
    });
    const onExternalRangeComplete = jest.fn();
    const playerHandle = createRef<YouTubePlaylistPlayerHandle>();
    (window as Window & { YT?: unknown }).YT = { Player };
    const entry = {
      ...queue[0],
      playbackRanges: [{ startSeconds: 5, endSeconds: 12 }, { startSeconds: 35, endSeconds: 50 }],
    };
    const view = render(
      <YouTubePlaylistPlayer
        ref={playerHandle}
        queue={[entry]}
        externalPlayback
        onExternalRangeComplete={onExternalRangeComplete}
      />,
    );
    await waitFor(() => expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 5, endSeconds: 12 }));
    view.rerender(<YouTubePlaylistPlayer ref={playerHandle} queue={[]} externalPlayback onExternalRangeComplete={onExternalRangeComplete} />);
    view.rerender(<YouTubePlaylistPlayer ref={playerHandle} queue={[entry]} externalPlayback onExternalRangeComplete={onExternalRangeComplete} />);
    expect(Player).toHaveBeenCalledTimes(1);
    expect(player.destroy).not.toHaveBeenCalled();
    act(() => playerHandle.current?.playEntry("one"));
    act(() => events.onStateChange?.({ data: 0 }));
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 35, endSeconds: 50 });
    act(() => events.onStateChange?.({ data: 1 }));
    act(() => events.onStateChange?.({ data: 0 }));
    expect(onExternalRangeComplete).toHaveBeenCalledWith("one");
    expect(onExternalRangeComplete).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
    delete (window as Window & { YT?: unknown }).YT;
  });

  it("reloads the same video for a new range, restarts trimmed songs, and resumes pauses in place", async () => {
    const player = {
      playVideo: jest.fn(), pauseVideo: jest.fn(), stopVideo: jest.fn(),
      cueVideoById: jest.fn(), loadVideoById: jest.fn(), seekTo: jest.fn(),
      getCurrentTime: jest.fn(() => 0), getDuration: jest.fn(() => 0),
      setVolume: jest.fn(), destroy: jest.fn(),
    };
    let events: { onReady?: () => void; onStateChange?: (event: { data: number }) => void } = {};
    const Player = jest.fn((_element: HTMLElement, options: { events?: typeof events }) => {
      events = options.events || {};
      queueMicrotask(() => events.onReady?.());
      return player;
    });
    (window as Window & { YT?: unknown }).YT = { Player };
    const sameVideoQueue: YouTubePlaylistEntry[] = [
      { ...queue[0], playbackRanges: [{ startSeconds: 5, endSeconds: 12 }, { startSeconds: 35, endSeconds: 50 }] },
      queue[1],
    ];
    const { rerender, unmount } = render(<YouTubePlaylistPlayer queue={sameVideoQueue} />);
    await waitFor(() => expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 5, endSeconds: 12 }));
    fireEvent.click(screen.getByRole("button", { name: "Play All" }));
    act(() => events.onStateChange?.({ data: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
    act(() => events.onStateChange?.({ data: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(player.loadVideoById).toHaveBeenCalledTimes(1);
    act(() => events.onStateChange?.({ data: 0 }));
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 35, endSeconds: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Previous video" }));
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 5, endSeconds: 12 });

    rerender(<YouTubePlaylistPlayer queue={[{ ...sameVideoQueue[0], playbackRanges: [{ startSeconds: 8, endSeconds: 14 }, { startSeconds: 35, endSeconds: 50 }] }, queue[1]]} />);
    await waitFor(() => expect(player.cueVideoById).toHaveBeenLastCalledWith({ videoId: "aaaaaaaaaaa", startSeconds: 8, endSeconds: 14 }));
    unmount();
    delete (window as Window & { YT?: unknown }).YT;
  });

  it("uses a full-width layout for preview mode and keeps playlist mode compact", async () => {
    const player = {
      playVideo: jest.fn(),
      pauseVideo: jest.fn(),
      stopVideo: jest.fn(),
      cueVideoById: jest.fn(),
      loadVideoById: jest.fn(),
      seekTo: jest.fn(),
      getCurrentTime: jest.fn(() => 0),
      getDuration: jest.fn(() => 0),
      setVolume: jest.fn(),
      destroy: jest.fn(),
    };
    const Player = jest.fn((_element: HTMLElement, options: { events?: { onReady?: () => void } }) => {
      queueMicrotask(() => options.events?.onReady?.());
      return player;
    });
    (window as Window & { YT?: unknown }).YT = { Player };

    const { rerender, unmount } = render(
      <YouTubePlaylistPlayer mode="preview" queue={[queue[0]]} />,
    );

    await waitFor(() => expect(Player).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("region", { name: "YouTube video preview" })).toHaveClass("bg-gray-900/70");
    expect(screen.getByTestId("youtube-player-layout")).toHaveClass("grid-cols-1");

    rerender(<YouTubePlaylistPlayer queue={queue} />);
    expect(screen.getByTestId("youtube-player-layout")).toHaveClass("sm:grid-cols-[minmax(0,18rem)_1fr]");

    unmount();
    delete (window as Window & { YT?: unknown }).YT;
  });
});
