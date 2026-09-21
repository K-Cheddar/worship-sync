import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContentPreviewDialog from "./ContentPreviewDialog";

const dropboxMp4Url =
  "https://www.dropbox.com/scl/fi/abc123/Pathfinder-Day-Ingles-1.mp4?rlkey=secret&st=abc&dl=0";

jest.mock("../YouTubePlaylistPlayer/YouTubePlaylistPlayer", () => ({
  __esModule: true,
  default: () => {
    return <div aria-label="YouTube player" />;
  },
}));

const renderPreview = (resource: Parameters<typeof ContentPreviewDialog>[0]["resource"]) =>
  render(<ContentPreviewDialog resource={resource} onClose={jest.fn()} />);

describe("ContentPreviewDialog", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the image renderer", () => {
    renderPreview({ id: "image-1", title: "Slide", url: "https://example.test/slide.png" });
    expect(screen.getByRole("img", { name: "Slide" })).toHaveAttribute(
      "src",
      "https://example.test/slide.png",
    );
  });

  it("uses video and audio renderers", () => {
    const { rerender } = renderPreview({ id: "video-1", url: "https://example.test/clip.mp4" });
    expect(screen.getByLabelText("clip.mp4")).toHaveAttribute("src", "https://example.test/clip.mp4");

    rerender(<ContentPreviewDialog resource={{ id: "audio-1", url: "https://example.test/track.mp3" }} onClose={jest.fn()} />);
    expect(screen.getByLabelText("track.mp3")).toHaveAttribute("src", "https://example.test/track.mp3");
  });

  it("renders Dropbox MP4 shares as resolved video and opens the original share link externally", () => {
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    renderPreview({ id: "dropbox-video", url: dropboxMp4Url });

    const video = screen.getByLabelText("Pathfinder-Day-Ingles-1.mp4");
    expect(new URL(video.getAttribute("src") || "").searchParams.get("raw")).toBe("1");
    expect(screen.getByText("Dropbox • Video")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect(open).toHaveBeenCalledWith(dropboxMp4Url, "_blank", "noopener,noreferrer");
  });

  it("uses the existing YouTube player", async () => {
    renderPreview({
      id: "youtube-1",
      title: "Rehearsal",
      type: "youtube",
      mediaId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(await screen.findByLabelText("YouTube player")).toBeInTheDocument();
  });

  it("renders text and PDF/document previews internally", () => {
    const { rerender } = renderPreview({ id: "text-1", title: "Notes", textContent: "Welcome." });
    expect(screen.getByText("Welcome.")).toBeInTheDocument();

    rerender(<ContentPreviewDialog resource={{ id: "pdf-1", title: "Guide", mimeType: "application/pdf", url: "https://example.test/guide.pdf" }} onClose={jest.fn()} />);
    expect(screen.getByTitle("Guide")).toHaveAttribute("src", "https://example.test/guide.pdf");
  });

  it("shows a blocked-page fallback while keeping external actions available", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    jest.useFakeTimers();
    renderPreview({ id: "web-1", title: "Blocked page", url: "https://example.test/page" });
    act(() => jest.advanceTimersByTime(7000));

    expect(await screen.findByText("This site doesn’t allow an embedded preview.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    expect(open).toHaveBeenCalledWith("https://example.test/page", "_blank", "noopener,noreferrer");
    jest.useRealTimers();
  });

  it("keeps a loaded embedded page available after the timeout window", () => {
    jest.useFakeTimers();
    renderPreview({ id: "web-1", title: "Loaded page", url: "https://example.test/page" });
    fireEvent.load(screen.getByTitle("Loaded page"));
    act(() => jest.advanceTimersByTime(7000));

    expect(screen.getByTitle("Loaded page")).toBeInTheDocument();
    expect(screen.queryByText("This site doesnâ€™t allow an embedded preview.")).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("copies links and rejects unsafe URLs", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = renderPreview({ id: "web-1", title: "Safe page", url: "https://example.test/page" });
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://example.test/page");

    const unsafeUrl = ["java", "script:alert(1)"].join("");
    view.rerender(<ContentPreviewDialog resource={{ id: "unsafe-1", title: "Unsafe", url: unsafeUrl }} onClose={jest.fn()} />);
    expect(await screen.findByText("This resource does not contain a previewable link.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
  });

  it("shows loading while a private resource URL resolves and ignores a rejected resolver", async () => {
    let resolveSource: (value: { url: string; mimeType?: string }) => void = () => undefined;
    const resolver = new Promise<{ url: string }>((resolve) => {
      resolveSource = resolve;
    });
    const { rerender } = renderPreview({ id: "private-1", title: "Private PDF", resolveSource: () => resolver });
    expect(screen.getByRole("status")).toHaveTextContent("Preparing preview");
    resolveSource({ url: "https://example.test/private.pdf", mimeType: "application/pdf" });
    await waitFor(() => expect(screen.getByTitle("Private PDF")).toHaveAttribute("src", "https://example.test/private.pdf"));

    rerender(<ContentPreviewDialog resource={null} onClose={jest.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a compact useful fallback when provider resolution fails", async () => {
    renderPreview({
      id: "private-1",
      title: "Private file",
      resolveSource: async () => {
        throw new Error("The resource URL expired.");
      },
    });

    expect(await screen.findByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.getByText("The resource URL expired.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
  });
});
