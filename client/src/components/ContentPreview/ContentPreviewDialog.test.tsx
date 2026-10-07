import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getExternalResourceResolution } from "../../api/auth";
import * as openExternalUrlModule from "../../utils/openExternalUrl";
import ContentPreviewDialog from "./ContentPreviewDialog";
import { renderAsync } from "docx-preview";

jest.mock("docx-preview", () => ({ renderAsync: jest.fn() }));
const mockRenderDocx = jest.mocked(renderAsync);

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
    mockRenderDocx.mockReset();
    mockRenderDocx.mockResolvedValue(undefined);
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
    const clipVideo = await screen.findByLabelText("clip.mp4", { selector: "video" });
    expect(clipVideo).toHaveAttribute("src", "https://worshipsync.test/api/resources/proxy?token=clip.mp4");

    rerender(<ContentPreviewDialog resource={{ id: "audio-1", url: "https://example.test/track.mp3" }} onClose={jest.fn()} />);
    expect(await screen.findByLabelText("track.mp3", { selector: "audio" })).toHaveAttribute("src", "https://worshipsync.test/api/resources/proxy?token=track.mp3");
  });

  it("renders Dropbox MP4 shares through the same-origin proxy and opens the original share link externally", async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPreview({ id: "dropbox-video", url: dropboxMp4Url });

    const video = await screen.findByLabelText("Pathfinder-Day-Ingles-1.mp4", { selector: "video" });
    expect(video.getAttribute("src")).toContain("/api/resources/proxy");
    expect(screen.getByText("Dropbox • Video")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(dropboxMp4Url, "_blank", "noopener,noreferrer"));
    await user.click(screen.getByRole("button", { name: "More preview actions" }));
    expect(screen.getByRole("menu")).toHaveClass("z-[60]");
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(dropboxMp4Url);
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

  it("keeps the PDF viewer full-width so its document controls remain available", async () => {
    const { rerender } = renderPreview({ id: "text-1", title: "Notes", textContent: "Welcome." });
    expect(screen.getByText("Welcome.")).toBeInTheDocument();

    rerender(<ContentPreviewDialog resource={{ id: "pdf-1", title: "Guide", mimeType: "application/pdf", url: "https://example.test/guide.pdf" }} onClose={jest.fn()} />);
    const pdfFrame = await screen.findByTitle("Guide");
    expect(pdfFrame).toHaveAttribute("src", expect.stringContaining("/api/resources/proxy"));
    expect(pdfFrame).not.toHaveAttribute("sandbox");
    expect(screen.getByTestId("document-preview-container")).toHaveClass("w-full");
    expect(pdfFrame).toHaveClass("w-full");
  });

  it("keeps the expected sandbox on web previews", async () => {
    renderPreview({ id: "web-1", title: "Embedded page", url: "https://example.test/page" });

    expect(await screen.findByTitle("Embedded page")).toHaveAttribute(
      "sandbox",
      "allow-forms allow-modals allow-popups allow-presentation allow-scripts",
    );
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

  it("keeps a slow embedded page mounted and lets it become ready", async () => {
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    jest.useFakeTimers();
    renderPreview({ id: "web-1", title: "Blocked page", url: "https://example.test/page" });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => jest.advanceTimersByTime(7000));

    expect(await screen.findByText("This preview is taking longer than expected.")).toBeInTheDocument();
    const iframe = screen.getByTitle("Blocked page");
    expect(iframe).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.test/page", "_blank", "noopener,noreferrer"));
    fireEvent.load(iframe);
    expect(screen.queryByText("This preview is taking longer than expected.")).not.toBeInTheDocument();
    expect(iframe).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("shows a fallback for an actual media failure without resizing the dialog", async () => {
    renderPreview({ id: "image-error", title: "Failed image", url: "https://example.test/slide.png" });
    const dialog = await screen.findByRole("dialog");
    const originalStageClass = screen.getByTestId("preview-stage").className;
    expect(dialog).toHaveClass("max-w-6xl");
    fireEvent.error(await screen.findByAltText("Failed image"));
    expect(await screen.findByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("max-w-6xl");
    expect(screen.getByTestId("preview-stage")).toHaveClass(originalStageClass);
    expect(screen.getByRole("button", { name: "Open in new tab" })).toBeInTheDocument();
  });

  it("expands and restores the preview while keeping its stage sizing", async () => {
    const user = userEvent.setup();
    renderPreview({ id: "pdf-1", title: "Guide", mimeType: "application/pdf", url: "https://example.test/guide.pdf" });
    await screen.findByTitle("Guide");
    const stage = screen.getByTestId("preview-stage");
    const normalStageClass = stage.className;
    await user.click(screen.getByRole("button", { name: "Expand preview" }));
    expect(screen.getByRole("dialog")).toHaveClass("inset-0");
    expect(screen.getByRole("button", { name: "Exit expanded preview" })).toBeInTheDocument();
    expect(stage).toHaveClass("flex-1");
    await user.click(screen.getByRole("button", { name: "Exit expanded preview" }));
    expect(screen.getByRole("dialog")).toHaveClass("max-w-6xl");
    expect(stage.className).toBe(normalStageClass);
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
    await user.click(screen.getByRole("button", { name: "More preview actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
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
    expect(screen.getByRole("button", { name: "Opening in new tab" })).toBeInTheDocument();
    await user.click(openButton);
    expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);

    resolveOpen(true);
    await waitFor(() => expect(openButton).not.toBeDisabled());

    await user.click(screen.getByRole("button", { name: "More preview actions" }));
    const copyButton = screen.getByRole("menuitem", { name: "Copy link" });
    await user.click(copyButton);
    const pendingCopyItem = screen.getByRole("menuitem", { name: "Copying link…" });
    expect(pendingCopyItem).toHaveAttribute("aria-disabled", "true");
    await user.click(pendingCopyItem);
    expect(writeText).toHaveBeenCalledTimes(1);

    resolveCopy();
    expect(await screen.findByRole("menuitem", { name: "Link copied" })).toBeInTheDocument();
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

  it("fetches a signed DOCX and uses Word rendering without an iframe", async () => {
    const data = new ArrayBuffer(4);
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => data } as Response);
    const view = renderPreview({ id: "word", title: "Notes", fileName: "notes.docx", resolveSource: async () => ({
      url: "https://r2.example.test/opaque?signature=secret", provider: "worshipsync", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }) });
    await waitFor(() => expect(mockRenderDocx).toHaveBeenCalledWith(data, expect.any(HTMLElement), expect.any(HTMLElement), expect.objectContaining({ useBase64URL: true, renderAltChunks: false })));
    expect(screen.getByText("WorshipSync • Document")).toBeInTheDocument();
    expect(screen.getByRole("document", { name: "Word document preview" })).toBeInTheDocument();
    expect(screen.queryByTitle("Notes")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole("button", { name: "Expand preview" }));
    expect(screen.getByTestId("preview-stage")).toHaveClass("flex-1");
    const options = fetchMock.mock.calls[0][1];
    view.rerender(<ContentPreviewDialog resource={null} onClose={jest.fn()} />);
    expect(options?.signal?.aborted).toBe(true);
    fetchMock.mockRestore();
  });

  it.each(["doc", "xls", "xlsx", "ppt", "pptx"])("immediately falls back for .%s without an iframe", async (extension) => {
    renderPreview({ id: "office", title: "Unsupported file", fileName: `notes.${extension}`, resolveSource: async () => ({ url: "https://r2.example.test/opaque", provider: "worshipsync" }) });
    expect(await screen.findByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.queryByTitle("Unsupported file")).not.toBeInTheDocument();
    expect(screen.getByText(/This file format isn’t supported/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in new tab" })).toBeInTheDocument();
  });

  it("shows a useful fallback for failed DOCX rendering", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as Response);
    mockRenderDocx.mockRejectedValueOnce(new Error("Corrupt DOCX"));
    renderPreview({ id: "word", fileName: "notes.docx", resolveSource: async () => ({ url: "https://r2.example.test/opaque" }) });
    expect(await screen.findByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/This document could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in new tab" })).toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it("ignores late Word render completion after switching resources", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as Response);
    let completeDocx: () => void = () => undefined;
    mockRenderDocx.mockReturnValueOnce(new Promise<void>((resolve) => { completeDocx = resolve; }));
    const view = renderPreview({ id: "word", fileName: "notes.docx", resolveSource: async () => ({ url: "https://r2.example.test/opaque" }) });
    await waitFor(() => expect(mockRenderDocx).toHaveBeenCalledTimes(1));
    view.rerender(<ContentPreviewDialog resource={{ id: "new-page", title: "New page", url: "https://example.test/page" }} onClose={jest.fn()} />);
    await screen.findByTitle("New page");
    await act(async () => { completeDocx(); });
    expect(screen.getByRole("status")).toHaveTextContent("Loading embedded page");
    expect(screen.queryByRole("document")).not.toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it("eventually fails a slow embed and keeps its open action", async () => {
    jest.useFakeTimers();
    renderPreview({ id: "web", title: "Slow page", url: "https://example.test/page" });
    await screen.findByTitle("Slow page");
    act(() => jest.advanceTimersByTime(7000));
    expect(screen.getByText("This preview is taking longer than expected.")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(23000));
    expect(screen.getByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.queryByText("This preview is taking longer than expected.")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Slow page")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in new tab" })).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("bounds DOCX fetching and aborts it on final failure", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.spyOn(global, "fetch").mockReturnValue(new Promise<Response>(() => undefined));
    renderPreview({ id: "word", fileName: "notes.docx", resolveSource: async () => ({ url: "https://r2.example.test/opaque" }) });
    await screen.findByRole("document", { hidden: true });
    act(() => jest.advanceTimersByTime(7000));
    expect(screen.getByText("This preview is taking longer than expected.")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(23000));
    expect(screen.getByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it("bounds source resolution and ignores its late success", async () => {
    jest.useFakeTimers();
    let completeSource: (source: { url: string }) => void = () => undefined;
    renderPreview({ id: "pending", resolveSource: () => new Promise((resolve) => { completeSource = resolve; }) });
    expect(screen.getByRole("status")).toHaveTextContent("Preparing preview");
    act(() => jest.advanceTimersByTime(30000));
    expect(screen.getByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    await act(async () => { completeSource({ url: "https://example.test/late.pdf" }); });
    expect(screen.getByRole("heading", { name: "Preview unavailable" })).toBeInTheDocument();
    expect(screen.queryByTestId("document-preview-container")).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it.each(["text/plain", "text/markdown"])("fetches %s with the shared text renderer", async (mimeType) => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, text: async () => "Welcome team" } as Response);
    renderPreview({ id: "text-file", mimeType, resolveSource: async () => ({ url: "https://r2.example.test/opaque", mimeType }) });
    expect(await screen.findByText("Welcome team")).toBeInTheDocument();
    expect(screen.queryByTestId("document-preview-container")).not.toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it("shows the resolver reason for an unsupported SharePoint link and keeps the original link available", async () => {
    const originalUrl = "https://church.sharepoint.com/:b:/s/team/Eprivate?e=share-token";
    const open = jest.spyOn(window, "open").mockReturnValue({} as Window);
    mockGetExternalResourceResolution.mockResolvedValueOnce({
      originalUrl,
      externalUrl: originalUrl,
      provider: "sharepoint",
      title: "SharePoint",
      mediaType: "unknown",
      previewType: "unsupported",
      previewUrl: null,
      requiresProxy: false,
      canPreview: false,
      reason: "This SharePoint link requires sign-in.",
    });

    renderPreview({ id: "sharepoint-private", url: originalUrl });

    expect(await screen.findByText("This SharePoint link requires sign-in.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(originalUrl, "_blank", "noopener,noreferrer"));
  });
});
