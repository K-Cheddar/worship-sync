import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";

import { getSongAudioUrl } from "../../api/auth";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { SongAudio } from "../../types";
import type { RehearsalPlaybackEntry } from "./rehearsalPlaybackQueue";
import { RehearsalPlaybackProvider, useRehearsalPlayback, useRehearsalPlaybackController } from "./RehearsalPlaybackContext";
import RehearsalPlayerWindow from "./RehearsalPlayerWindow";

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  getSongAudioUrl: jest.fn(),
}));

const audio: SongAudio = {
  id: "audio-1", key: "audio-key", fileName: "song.mp3", contentType: "audio/mpeg",
  sizeBytes: 12, uploadedAt: "2026-01-01T00:00:00.000Z",
};

const youtube = (key: string): RehearsalPlaybackEntry => ({
  entryKey: key,
  songId: key,
  title: key,
  source: { kind: "youtube", videoId: "aaaaaaaaaaa", ranges: [{ startSeconds: 10, endSeconds: 30 }], durationSeconds: 20 },
});

const mp3 = (key: string): RehearsalPlaybackEntry => ({
  entryKey: key,
  songId: key,
  title: key,
  source: { kind: "audio", audio },
});

const engineCalls = {
  playAll: jest.fn(), playEntry: jest.fn(), pause: jest.fn(), resume: jest.fn(), seekTo: jest.fn(), seekToPlaybackPosition: jest.fn(), setVolume: jest.fn(), stop: jest.fn(),
};

const EngineAndHarness = ({ queue = [youtube("youtube-a"), mp3("mp3-b"), youtube("youtube-c")] }: { queue?: RehearsalPlaybackEntry[] }) => {
  const playback = useRehearsalPlayback();
  const attachYouTubeEngine = playback.attachYouTubeEngine;
  const currentEntry = playback.currentEntry;
  const isLoading = playback.isLoading;
  const playVersion = playback.playVersion;
  const reportYouTubeStatus = playback.reportYouTubeStatus;
  useEffect(() => {
    attachYouTubeEngine(engineCalls);
    return () => attachYouTubeEngine(null);
  }, [attachYouTubeEngine]);
  useEffect(() => {
    if (currentEntry?.source.kind === "youtube" && isLoading) {
      engineCalls.playEntry(currentEntry.entryKey);
      reportYouTubeStatus(currentEntry.entryKey, true);
    }
  }, [currentEntry, isLoading, playVersion, reportYouTubeStatus]);
  return (
    <>
      <audio ref={playback.attachAudioElement} aria-label="active audio" />
      <button onClick={() => playback.playQueue(queue)}>Play queue</button>
      <button onClick={() => playback.playQueue(queue, "mp3-b")}>Play MP3</button>
      <button onClick={playback.togglePlayback}>Toggle</button>
      <button onClick={playback.previous}>Previous</button>
      <button onClick={playback.next}>Next</button>
      <button onClick={() => playback.seek(12)}>Seek</button>
      <button onClick={() => playback.setVolume(0.4)}>Set volume</button>
      <button onClick={playback.toggleMute}>Mute</button>
      <button onClick={() => playback.reportYouTubeStatus(playback.currentEntry?.entryKey ?? "", true)}>Set YouTube playing</button>
      <button onClick={() => playback.reportYouTubeProgress(playback.currentEntry?.entryKey ?? "", 8, 20)}>Report progress</button>
      <button onClick={() => playback.reportYouTubeStatus("youtube-a", false)}>Report stale YouTube pause</button>
      <button onClick={() => playback.reportYouTubeRangeChange(playback.currentEntry?.entryKey ?? "", 1)}>Set range</button>
      <button onClick={() => playback.reportYouTubeEnded(playback.currentEntry?.entryKey ?? "")}>Complete YouTube</button>
      <button onClick={playback.stop}>Close player</button>
      <output data-testid="state">{JSON.stringify({
        title: playback.currentEntry?.title ?? "",
        source: playback.currentEntry?.source.kind ?? "",
        playing: playback.isPlaying,
        loading: playback.isLoading,
        time: playback.currentTime,
        duration: playback.duration,
        durationByEntryKey: playback.durationByEntryKey,
        range: playback.currentRangeIndex,
        volume: playback.volume,
        muted: playback.isMuted,
        error: playback.error,
      })}</output>
      <RehearsalPlayerWindow youtubeEngine={<div data-testid="youtube-engine" />} />
    </>
  );
};

const ControllerRenderCounter = ({ onRender }: { onRender: () => void }) => {
  useRehearsalPlaybackController();
  onRender();
  return null;
};

const readState = () => JSON.parse(screen.getByTestId("state").textContent || "{}");
const renderPlayer = (children: ReactNode = <EngineAndHarness />) => render(
  <GlobalInfoContext.Provider value={{ loginState: "success", sessionKind: "human", userId: "user-1", churchId: "church-1" } as never}>
    <RehearsalPlaybackProvider>{children}</RehearsalPlaybackProvider>
  </GlobalInfoContext.Provider>,
);

describe("RehearsalPlaybackProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSongAudioUrl).mockResolvedValue({ url: "https://audio.test/song.mp3", expiresAt: "later" });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("advances a mixed YouTube to MP3 to YouTube queue across engines", async () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play queue" }));
    await waitFor(() => expect(engineCalls.playEntry).toHaveBeenCalledWith("youtube-a"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getSongAudioUrl).toHaveBeenCalledWith(expect.objectContaining({ churchId: "church-1", audio, disposition: "inline" })));
    await waitFor(() => expect(readState()).toMatchObject({ title: "mp3-b", source: "audio", playing: true }));
    expect(engineCalls.stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Report stale YouTube pause" }));
    expect(readState().playing).toBe(true);
    fireEvent(screen.getByLabelText("active audio"), new Event("ended"));
    await waitFor(() => expect(engineCalls.playEntry).toHaveBeenLastCalledWith("youtube-c"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("play/pause, seek, volume, and mute control the active source", async () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState()).toMatchObject({ source: "audio", playing: true }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(readState().playing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Seek" }));
    fireEvent.click(screen.getByRole("button", { name: "Set volume" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    fireEvent.click(screen.getByRole("button", { name: "Set range" }));
    expect(readState()).toMatchObject({ time: 12, volume: 0.4, muted: true });
    expect(engineCalls.setVolume).toHaveBeenLastCalledWith(0);
  });

  it("reads MP3 duration metadata into the unified progress state and queue", async () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    const audioElement = screen.getByLabelText("active audio");
    Object.defineProperty(audioElement, "duration", { configurable: true, value: 185 });
    fireEvent.loadedMetadata(audioElement);
    expect(readState()).toMatchObject({ duration: 185, durationByEntryKey: { "mp3-b": 185 } });
  });

  it("uses YouTube controls and advances after its final range", async () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play queue" }));
    await waitFor(() => expect(engineCalls.playEntry).toHaveBeenCalledWith("youtube-a"));
    fireEvent.click(screen.getByRole("button", { name: "Set YouTube playing" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(engineCalls.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(engineCalls.resume).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Seek" }));
    fireEvent.click(screen.getByRole("button", { name: "Set volume" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(engineCalls.seekToPlaybackPosition).toHaveBeenCalledWith(12);
    expect(engineCalls.setVolume).toHaveBeenCalledWith(40);
    expect(engineCalls.setVolume).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Set range" }));
    const state = readState();
    expect(state).toMatchObject({ source: "youtube", range: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Complete YouTube" }));
    await waitFor(() => expect(readState()).toMatchObject({ title: "mp3-b", source: "audio" }));
  });

  it("supports previous and next across source types and clears on close", async () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState().source).toBe("audio"));
    jest.mocked(HTMLMediaElement.prototype.pause).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await waitFor(() => expect(readState()).toMatchObject({ title: "youtube-a", source: "youtube" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(readState()).toMatchObject({ title: "mp3-b", source: "audio" }));
    fireEvent.click(screen.getByRole("button", { name: "Close player" }));
    expect(readState()).toMatchObject({ title: "", source: "", playing: false });
  });

  it("resolves a fresh signed URL after the current audio URL fails", async () => {
    jest.mocked(getSongAudioUrl)
      .mockResolvedValueOnce({ url: "https://audio.test/expired.mp3", expiresAt: "old" })
      .mockResolvedValueOnce({ url: "https://audio.test/fresh.mp3", expiresAt: "new" });
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    fireEvent(screen.getByLabelText("active audio"), new Event("error"));
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => expect(getSongAudioUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
  });

  it("ignores a pending MP3 URL when navigation selects a different entry", async () => {
    let resolveUrl: ((value: { url: string; expiresAt: string }) => void) | undefined;
    jest.mocked(getSongAudioUrl).mockReturnValueOnce(new Promise((resolve) => {
      resolveUrl = resolve;
    }));
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(getSongAudioUrl).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(readState()).toMatchObject({ title: "youtube-c", source: "youtube" }));
    resolveUrl?.({ url: "https://audio.test/late.mp3", expiresAt: "later" });
    await waitFor(() => expect(readState().source).toBe("youtube"));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("clears the session when the church or authenticated account changes", async () => {
    const value = { loginState: "success", sessionKind: "human", userId: "user-1", churchId: "church-1" };
    const view = render(
      <GlobalInfoContext.Provider value={value as never}>
        <RehearsalPlaybackProvider><EngineAndHarness /></RehearsalPlaybackProvider>
      </GlobalInfoContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    view.rerender(
      <GlobalInfoContext.Provider value={{ ...value, churchId: "church-2" } as never}>
        <RehearsalPlaybackProvider><EngineAndHarness /></RehearsalPlaybackProvider>
      </GlobalInfoContext.Provider>,
    );
    await waitFor(() => expect(readState()).toMatchObject({ title: "", playing: false }));
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    view.rerender(
      <GlobalInfoContext.Provider value={{ ...value, loginState: "logged-out", churchId: "church-2" } as never}>
        <RehearsalPlaybackProvider><EngineAndHarness /></RehearsalPlaybackProvider>
      </GlobalInfoContext.Provider>,
    );
    await waitFor(() => expect(readState()).toMatchObject({ title: "", playing: false }));
  });

  it("keeps the active session through route changes and remounts, and does not replace it while browsing", async () => {
    const PlanPage = () => {
      const playback = useRehearsalPlayback();
      return <p aria-label="Active song">{playback.currentEntry?.title ?? "Nothing playing"}</p>;
    };
    renderPlayer(
      <MemoryRouter initialEntries={["/rehearse"]}>
        <Link to="/members">Members</Link>
        <Link to="/other-plan">Other plan</Link>
        <Routes>
          <Route path="/rehearse" element={<PlanPage />} />
          <Route path="/members" element={<p>Members page</p>} />
          <Route path="/other-plan" element={<PlanPage />} />
        </Routes>
        <EngineAndHarness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play queue" }));
    await waitFor(() => expect(engineCalls.playEntry).toHaveBeenCalledWith("youtube-a"));
    fireEvent.click(screen.getByRole("link", { name: "Members" }));
    expect(await screen.findByText("Members page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Other plan" }));
    expect(await screen.findByLabelText("Active song")).toHaveTextContent("youtube-a");
    expect(engineCalls.playEntry).toHaveBeenCalledTimes(1);
  });

  it("keeps progress ticks out of Rehearse controller subscribers", async () => {
    const onRender = jest.fn();
    renderPlayer(<><EngineAndHarness /><ControllerRenderCounter onRender={onRender} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Play queue" }));
    await waitFor(() => expect(engineCalls.playEntry).toHaveBeenCalledWith("youtube-a"));
    fireEvent.click(screen.getByRole("button", { name: "Set YouTube playing" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    const rendersBeforeProgress = onRender.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Report progress" }));
    expect(onRender).toHaveBeenCalledTimes(rendersBeforeProgress);
  });

  it("minimize preserves the playback session and close stops it", async () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Play MP3" }));
    await waitFor(() => expect(readState().playing).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    expect(readState().playing).toBe(true);
    await screen.findByRole("button", { name: "Restore window" });
    fireEvent.click(screen.getByRole("button", { name: "Restore window" }));
    jest.mocked(HTMLMediaElement.prototype.pause).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await waitFor(() => expect(readState()).toMatchObject({ title: "", playing: false }));
  });
});
