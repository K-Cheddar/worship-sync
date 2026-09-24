import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getExternalResourceResolution } from "../../api/auth";
import * as openExternalUrlModule from "../../utils/openExternalUrl";
import ContentPreviewDialog from "./ContentPreviewDialog";

jest.mock("../../api/auth", () => ({
  getExternalResourceResolution: jest.fn(),
}));

jest.mock("../../utils/openExternalUrl", () => ({
  openExternalUrl: jest.fn(),
}));

const mockGetExternalResourceResolution = jest.mocked(getExternalResourceResolution);
const mockOpenExternalUrl = jest.mocked(openExternalUrlModule.openExternalUrl);

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
    mockGetExternalResourceResolution.mockReset();
    mockOpenExternalUrl.mockReset();
    mockOpenExternalUrl.mockImplementation(async (url) => {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      return Boolean(opened);
    });
    mockGetExternalResourceResolution.mockImplementation(async (url) => {
      const isWeb = /page$/i.test(url);
      const isDropbox = url.includes("dropbox.com");
      const isYouTube = /youtube\.com|youtu\.be/i.test(url);
      const isPdf = /\.pdf(?:$|\?)/i.test(url);
      const filename = url.split("/").pop()?.split("?")[0] || "resource";
      const mediaType = isWeb
        ? "web"
        : isPdf
          ? "document"
          : /\.(mp3|wav)(?:$|\?)/i.test(url)
            ? "audio"
            : /\.(png|jpe?g)(?:$|\?)/i.test(url)
              ? "image"
              : "video";
      const previewType = mediaType === "web" ? "web" : mediaType;
      return {
        originalUrl: url,
        externalUrl: url,
        provider: isYouTube ? "youtube" : isDropbox ? "dropbox" : isWeb ? "web" : "direct",
        title: isYouTube ? "YouTube video" : filename,
        filename,
        mimeType: mediaType === "document" ? "application/pdf" : undefined,
        mediaType,
        previewType: isYouTube ? "youtube" : previewType,
        previewUrl: isWeb || isYouTube
          ? url
          : `https://worshipsync.test/api/resources/proxy?token=${encodeURIComponent(filename)}`,
        requiresProxy: !isWeb && !isYouTube,
        canPreview: true,
        ...(isYouTube ? { mediaId: "dQw4w9WgXcQ" } : {}),
      };
    });
  });

  it("uses the image renderer", async () => {
    renderPreview({ id: "image-1", title: "Slide", url: "https://example.test/slide.png" });
    expect(await screen.findByRole("img", { name: "Slide" })).toHaveAttribute(
      "src",
      "https://worshipsync.test/api/resources/proxy?token=slide.png",
    );
  });

  it("uses video and audio renderers", async () => {
    const { rerender } = renderPreview({ id: "video-1", url: "https://example.test/clip.mp4" });
    expect(await screen.findByLabelText("clip.mp4")).toHaveAttribute("src", "https://worshipsync.test/api/resources/proxy?token=clip.mp4");

    rerender(<ContentPreviewDialog resource={{ id: "audio-1", url: "https://example.test/track.mp3" }} onClose={jest.fn()} />);
    expect(await screen.findByLabelText("track.mp3")).toHaveAttribute("src", "https://worshipsync.test/api/resources/proxy?token=track.mp3");
  });

  it("renders Dropbox MP4 shares through the same-origin proxy and opens the original share link externally", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    renderPreview({ id: "dropbox-video", url: dropboxMp4Url });

    const video = await screen.findByLabelText("Pathfinder-Day-Ingles-1.mp4");
    expect(video.getAttribute("src")).toContain("/api/resources/proxy");
    expect(screen.getByText("Dropbox • Video")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(dropboxMp4Url, "_blank", "noopener,noreferrer"));
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

  it("renders text and PDF/document previews internally", async () => {
    const { rerender } = renderPreview({ id: "text-1", title: "Notes", textContent: "Welcome." });
    expect(screen.getByText("Welcome.")).toBeInTheDocument();

    rerender(<ContentPreviewDialog resource={{ id: "pdf-1", title: "Guide", mimeType: "application/pdf", url: "https://example.test/guide.pdf" }} onClose={jest.fn()} />);
    expect(await screen.findByTitle("Guide")).toHaveAttribute("src", expect.stringContaining("/api/resources/proxy"));
  });

  it("renders saved rich text formatting in text previews", () => {
    renderPreview({
      id: "rich-text-1",
      title: "Notes",
      textContent: "Important note",
      richTextContent: {
        blocks: [{
          type: "paragraph",
          spans: [{ text: "Important note", bold: true, italic: true }],
        }],
      },
    });

    expect(screen.getByText("Important note")).toHaveClass("font-bold", "italic");
  });

  it("shows a blocked-page fallback while keeping external actions available", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    jest.useFakeTimers();
    renderPreview({ id: "web-1", title: "Blocked page", url: "https://example.test/page" });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => jest.advanceTimersByTime(7000));

    expect(await screen.findByText("This site doesn’t allow an embedded preview.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.test/page", "_blank", "noopener,noreferrer"));
    jest.useRealTimers();
  });

  it("keeps a loaded embedded page available after the timeout window", async () => {
    jest.useFakeTimers();
    renderPreview({ id: "web-1", title: "Loaded page", url: "https://example.test/page" });
    fireEvent.load(await screen.findByTitle("Loaded page"));
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

  it("shows pending state and prevents duplicate opening or copying", async () => {
    const user = userEvent.setup();
    let resolveOpen: (opened: boolean) => void = () => undefined;
    const openPromise = new Promise<boolean>((resolve) => {
      resolveOpen = resolve;
    });
    mockOpenExternalUrl.mockReturnValueOnce(openPromise);

    let resolveCopy: () => void = () => undefined;
    const copyPromise = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const writeText = jest.fn().mockReturnValue(copyPromise);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPreview({ id: "web-1", title: "Pending actions", url: "https://example.test/page" });

    const openButton = screen.getByRole("button", { name: "Open in new tab" });
    await user.click(openButton);
    expect(openButton).toBeDisabled();
    expect(openButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Opening…")).toBeInTheDocument();
    await user.click(openButton);
    expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);

    resolveOpen(true);
    await waitFor(() => expect(openButton).not.toBeDisabled());

    const copyButton = screen.getByRole("button", { name: "Copy link" });
    await user.click(copyButton);
    expect(copyButton).toBeDisabled();
    expect(copyButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Copying…")).toBeInTheDocument();
    await user.click(copyButton);
    expect(writeText).toHaveBeenCalledTimes(1);

    resolveCopy();
    await waitFor(() => expect(copyButton).not.toBeDisabled());
    expect(copyButton).toHaveTextContent("Copied");
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

  it("keeps the original public URL available when server resolution fails", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    mockGetExternalResourceResolution.mockRejectedValueOnce(
      new Error("Preview service is unavailable."),
    );
    renderPreview({ id: "public-1", title: "Public file", url: "https://cdn.example.test/clip.mp4" });

    expect(await screen.findByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Preview service is unavailable.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://cdn.example.test/clip.mp4", "_blank", "noopener,noreferrer"));
  });
});
