import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SongAudioPlayer from "./SongAudioPlayer";
import type { SongAudio } from "../../types";

const audio: SongAudio = {
  id: "reference",
  key: "churches/church-1/songs/song-1/reference.mp3",
  fileName: "rehearsal.mp3",
  contentType: "audio/mpeg",
  sizeBytes: 2 * 1024 * 1024,
  uploadedAt: "2026-08-06T12:00:00.000Z",
};

describe("SongAudioPlayer", () => {
  it("resolves a private URL only when playback is requested", async () => {
    const onGetUrl = jest.fn().mockResolvedValue("https://audio.example/signed");
    const play = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    render(<SongAudioPlayer audio={audio} onGetUrl={onGetUrl} />);

    expect(onGetUrl).not.toHaveBeenCalled();
    expect(screen.getByText("rehearsal.mp3")).toBeInTheDocument();
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(onGetUrl).toHaveBeenCalledWith("inline");
    });
    expect(screen.getByLabelText("Play rehearsal.mp3")).toHaveAttribute(
      "src",
      "https://audio.example/signed",
    );
    await waitFor(() => {
      expect(play).toHaveBeenCalled();
    });

    play.mockRestore();
  });

  it("shows an actionable error when playback cannot be authorized", async () => {
    const onGetUrl = jest.fn().mockRejectedValue(new Error("Sign in again."));

    render(<SongAudioPlayer audio={audio} onGetUrl={onGetUrl} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again.");
  });

  it("expands compact mode into full-width native controls after play", async () => {
    const onGetUrl = jest.fn().mockResolvedValue("https://audio.example/signed");
    const play = jest
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    render(
      <SongAudioPlayer
        audio={audio}
        onGetUrl={onGetUrl}
        compact
        showFileDetails={false}
        showDownload={false}
        className="border-0 bg-transparent p-0"
      />,
    );

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Play rehearsal.mp3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    const playerGroup = await screen.findByRole("group", {
      name: "Reference audio for rehearsal.mp3",
    });
    expect(playerGroup.className).toMatch(/basis-full/);
    const player = screen.getByLabelText("Play rehearsal.mp3");
    expect(player).toHaveAttribute("src", "https://audio.example/signed");
    expect(player).toHaveAttribute("controls");
    expect(player.className).toMatch(/h-11/);
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(play).toHaveBeenCalled();
    });

    play.mockRestore();
  });
});