import { fireEvent, render, screen } from "@testing-library/react";

import { getRichLinkPreview } from "../../api/auth";
import SongLinkPreview from "./SongLinkPreview";

jest.mock("../../api/auth", () => ({
  getRichLinkPreview: jest.fn(),
}));

const mockGetRichLinkPreview = jest.mocked(getRichLinkPreview);

describe("SongLinkPreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows rich YouTube details and plays inside the app", async () => {
    mockGetRichLinkPreview.mockResolvedValue({
      provider: "youtube",
      kind: "video",
      resourceId: "M7lc1UVf-VE",
      title: "YouTube player demo",
      creator: "YouTube Developers",
      thumbnailUrl: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
      thumbnailWidth: 480,
      thumbnailHeight: 360,
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      embedUrl: "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
      supportsSegments: true,
    });

    render(
      <SongLinkPreview
        link={{
          id: "youtube-1",
          label: "Rehearsal",
          url: "https://youtu.be/M7lc1UVf-VE",
        }}
      />,
    );

    const playButton = await screen.findByRole("button", {
      name: "Play YouTube player demo in WorshipSync",
    });
    expect(screen.getByText("YouTube Developers")).toBeInTheDocument();
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
    );

    fireEvent.click(playButton);

    expect(screen.getByTitle("YouTube player demo")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=1&rel=0",
    );
    expect(screen.getAllByRole("link", { name: /Open on YouTube/ })).toHaveLength(
      1,
    );
  });

  it("shows Spotify details and opens its player inside the app", async () => {
    mockGetRichLinkPreview.mockResolvedValue({
      provider: "spotify",
      kind: "track",
      resourceId: "6rqhFgbbKwnb9MLmUQDhG6",
      title: "Reference track",
      thumbnailUrl: "https://i.scdn.co/image/example",
      canonicalUrl:
        "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
      embedUrl:
        "https://open.spotify.com/embed/track/6rqhFgbbKwnb9MLmUQDhG6",
      embedHeight: 152,
      supportsSegments: false,
    });

    render(
      <SongLinkPreview
        compact
        link={{
          id: "spotify-1",
          url: "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Play Reference track in WorshipSync",
      }),
    );

    expect(screen.getByTitle("Reference track")).toHaveAttribute(
      "src",
      "https://open.spotify.com/embed/track/6rqhFgbbKwnb9MLmUQDhG6",
    );
    expect(screen.getByRole("link", { name: /Open on Spotify/ })).toHaveAttribute(
      "href",
      "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
    );
  });

  it("keeps unsupported resources as ordinary links", () => {
    render(
      <SongLinkPreview
        link={{
          id: "chart-1",
          label: "Chord chart",
          url: "https://example.com/chart",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Chord chart" })).toHaveAttribute(
      "href",
      "https://example.com/chart",
    );
    expect(mockGetRichLinkPreview).not.toHaveBeenCalled();
  });

  it("uses the URL when an ordinary link has no label", () => {
    render(
      <SongLinkPreview
        link={{ id: "chart-2", url: "https://example.com/unlabelled" }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "https://example.com/unlabelled" }),
    ).toHaveAttribute("href", "https://example.com/unlabelled");
  });

  it("plays saved YouTube segments using absolute start and end times", async () => {
    mockGetRichLinkPreview.mockResolvedValue({
      provider: "youtube",
      kind: "video",
      resourceId: "dQw4w9WgXcQ",
      title: "Service recording",
      creator: "Example channel",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      supportsSegments: true,
    });

    render(
      <SongLinkPreview
        compact
        link={{
          id: "youtube-segments",
          url: "https://youtu.be/dQw4w9WgXcQ",
          segments: [
            {
              id: "chorus",
              label: "Chorus",
              startSeconds: 90,
              endSeconds: 125,
            },
          ],
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Play Service recording, Chorus · 1:30–2:05",
      }),
    );

    expect(screen.getByTitle("Service recording — Chorus")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90&end=125",
    );
  });
});
