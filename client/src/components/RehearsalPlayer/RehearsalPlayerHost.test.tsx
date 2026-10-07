import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Navigate, Route, Routes } from "react-router-dom";

import { GlobalInfoContext } from "../../context/globalInfo";
import { RehearsalPlaybackProvider, useRehearsalPlayback } from "./RehearsalPlaybackContext";
import RehearsalPlayerHost from "./RehearsalPlayerHost";
import type { YouTubePlaylistPlayerHandle } from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";

jest.mock("../YouTubePlaylistPlayer/YouTubePlaylistPlayer", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef((_props: unknown, ref: React.ForwardedRef<YouTubePlaylistPlayerHandle>) => {
      React.useImperativeHandle(ref, () => ({
        playAll: jest.fn(), playEntry: jest.fn(), pause: jest.fn(), resume: jest.fn(),
        seekTo: jest.fn(), seekToPlaybackPosition: jest.fn(), setVolume: jest.fn(), stop: jest.fn(),
      }));
      return <div data-testid="youtube-engine" />;
    }),
  };
});

const StartPlayback = () => {
  const playback = useRehearsalPlayback();
  return <button onClick={() => playback.playQueue([{
    entryKey: "song-1", songId: "song-1", title: "Song One",
    source: { kind: "youtube", videoId: "aaaaaaaaaaa", ranges: [{}] },
  }])}>Start rehearsal</button>;
};

const renderHost = (path: string) => render(
  <GlobalInfoContext.Provider value={{ loginState: "success", sessionKind: "human", userId: "user-1", churchId: "church-1" } as never}>
    <RehearsalPlaybackProvider>
      <MemoryRouter initialEntries={[path]}>
        <Link to="/">Home</Link>
        <Link to="/controller">Presentation</Link>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="*" element={null} />
        </Routes>
        <Link to="/projector">Projector</Link>
        <Link to="/services/share-id">Public service</Link>
        <Link to="/auth/reset">Password reset</Link>
        <RehearsalPlayerHost />
        <StartPlayback />
      </MemoryRouter>
    </RehearsalPlaybackProvider>
  </GlobalInfoContext.Provider>,
);

describe("RehearsalPlayerHost", () => {
  it("preserves the player and media engine through the Home redirect and another domain", () => {
    renderHost("/teams-and-services/services/plan-1");
    fireEvent.click(screen.getByRole("button", { name: "Start rehearsal" }));
    const engine = screen.getByTestId("youtube-engine");
    const progress = screen.getByRole("slider", { name: "Rehearsal progress" });

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByText("Song One")).toBeInTheDocument();
    expect(screen.getByTestId("youtube-engine")).toBe(engine);
    expect(screen.getByRole("slider", { name: "Rehearsal progress" })).toBe(progress);

    fireEvent.click(screen.getByRole("link", { name: "Presentation" }));
    expect(screen.getByText("Song One")).toBeInTheDocument();
    expect(screen.getByTestId("youtube-engine")).toBe(engine);
    expect(screen.getByRole("slider", { name: "Rehearsal progress" })).toBe(progress);
  });

  it.each([
    ["/projector", "Projector"],
    ["/services/share-id", "Public service"],
    ["/auth/reset", "Password reset"],
  ])("stops and hides the player on %s", (_path, linkName) => {
    renderHost("/home");
    fireEvent.click(screen.getByRole("button", { name: "Start rehearsal" }));
    expect(screen.getByText("Rehearsal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: linkName }));
    expect(screen.queryByText("Rehearsal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("youtube-engine")).not.toBeInTheDocument();
  });
});
