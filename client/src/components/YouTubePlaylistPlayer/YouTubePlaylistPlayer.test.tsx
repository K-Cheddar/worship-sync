import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import YouTubePlaylistPlayer from "./YouTubePlaylistPlayer";
import type { YouTubePlaylistEntry } from "./youtubePlaylist";

const queue: YouTubePlaylistEntry[] = [
  { entryKey: "one", songId: "song-1", title: "First song", artist: "Artist", videoId: "aaaaaaaaaaa" },
  { entryKey: "two", songId: "song-2", title: "Second song", artist: "Artist", videoId: "bbbbbbbbbbb" },
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
      events.onReady?.();
      return player;
    });
    (window as Window & { YT?: unknown }).YT = { Player };

    const { unmount } = render(<YouTubePlaylistPlayer queue={queue} />);

    await waitFor(() => expect(Player).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Play All" }));
    expect(player.playVideo).toHaveBeenCalledTimes(1);

    act(() => events.onStateChange?.({ data: 0 }));
    expect(player.loadVideoById).toHaveBeenCalledWith("bbbbbbbbbbb");

    act(() => events.onStateChange?.({ data: 0 }));
    expect(await screen.findByRole("status")).toHaveTextContent("Playlist finished");
    expect(player.loadVideoById).toHaveBeenCalledTimes(1);

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
    expect(player.playVideo).toHaveBeenCalledTimes(1);

    rerender(
      <YouTubePlaylistPlayer
        mode="preview"
        queue={[queue[1]]}
        autoPlayEntryKey="two"
      />,
    );
    await waitFor(() => expect(player.loadVideoById).toHaveBeenCalledWith("bbbbbbbbbbb"));
    expect(Player).toHaveBeenCalledTimes(1);

    unmount();
    expect(player.destroy).toHaveBeenCalledTimes(1);
    delete (window as Window & { YT?: unknown }).YT;
  });
});
