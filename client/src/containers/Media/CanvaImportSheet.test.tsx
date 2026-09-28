import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  getCanvaDesign,
  getCanvaStatus,
  importCanvaDesign,
  listCanvaDesigns,
  resolveCanvaDesignLink,
} from "../../api/canva";
import CanvaImportSheet from "./CanvaImportSheet";
import type { MediaType } from "../../types";
import type { mediaInfoType } from "./cloudinaryTypes";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import { CanvaMediaReconciliationRequiredError } from "../../utils/canvaMediaReplacement";

jest.mock("../../api/canva", () => ({
  getCanvaStatus: jest.fn(),
  getCanvaDesign: jest.fn(),
  importCanvaDesign: jest.fn(),
  listCanvaDesigns: jest.fn(),
  resolveCanvaDesignLink: jest.fn(),
}));

const mockStartCanvaTransfer = jest.fn();
jest.mock("../../context/transferContext", () => ({
  useTransfers: () => ({ startCanvaTransfer: mockStartCanvaTransfer }),
}));

const mockShowToast = jest.fn();
jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("../../utils/environment", () => ({
  isElectron: () => false,
  getApiBasePath: () => "/",
  isPackagedElectronRenderer: () => false,
}));

const existingMedia = {
  id: "media-1",
  name: "Weekly welcome",
  type: "image",
  canvaImportKey: "canva:DAF_design_1:rev:100:png:1",
  canvaSource: {
    designId: "DAF_design_1",
    designTitle: "Sunday Welcome",
    revision: 100,
    format: "png",
    pageNumbers: [1],
  },
} as MediaType;

beforeEach(() => {
  mockStartCanvaTransfer.mockReset();
  mockStartCanvaTransfer.mockImplementation((job) => {
    const controller = new AbortController();
    void job.run(controller.signal, jest.fn())
      .then((result: never) => job.finalize(result, controller.signal, jest.fn()))
      .catch(() => undefined);
    return "test-transfer";
  });
});

const refreshedImage = {
  public_id: "canva/new-page-1",
  secure_url: "https://res.cloudinary.com/new-page-1.png",
  thumbnail_url: "https://res.cloudinary.com/new-page-1-thumb.png",
  resource_type: "image",
  format: "png",
  width: 1920,
  height: 1080,
  canvaImportKey: "canva:DAF_design_1:rev:101:png:1",
  canvaSource: {
    designId: "DAF_design_1",
    designTitle: "Sunday Welcome",
    revision: 101,
    format: "png",
    pageNumbers: [1],
  },
} as mediaInfoType;

test("opens a design from a pasted Canva link when the church account can access it", async () => {
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [],
    continuation: "",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAF_shared_99",
    title: "Shared Weekly Deck",
    thumbnailUrl: "https://example.test/shared.png",
    pageCount: 3,
    updatedAt: 200,
    editUrl: "https://www.canva.com/design/DAF_shared_99/edit",
    viewUrl: "https://www.canva.com/design/DAF_shared_99/view",
  });

  const onCreateDeckItem = jest.fn();
  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={jest.fn()}
          onVideoRefresh={jest.fn()}
          onCreateDeckItem={onCreateDeckItem}
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  const linkInput = await screen.findByLabelText(/Open by link/i);
  await user.type(
    linkInput,
    "https://www.canva.com/design/DAF_shared_99/view",
  );
  await user.click(screen.getByRole("button", { name: /^Open$/i }));

  await waitFor(() => {
    expect(getCanvaDesign).toHaveBeenCalledWith("church-1", "DAF_shared_99");
  });
  expect(await screen.findByText("Shared Weekly Deck")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Page 1/i })).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Page 2 preview placeholder" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("tab", { name: /PNG images/i }),
  ).toHaveAttribute("data-state", "active");
  expect(
    screen.getByRole("checkbox", {
      name: "Create a custom item with one slide per page",
    }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /MP4 video/i }));
  expect(
    screen.getByRole("tab", { name: /MP4 video/i }),
  ).toHaveAttribute("data-state", "active");
  expect(
    screen.getByRole("checkbox", {
      name: "Create a custom item with the imported video",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "MP4 import mode" }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Separate video per page" }),
  );
  expect(
    screen.getByRole("checkbox", {
      name: "Create a custom item with one slide per page",
    }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 pages selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Page 1/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: /Page 2/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByText("0 pages selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Page 1/i })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("resolves an official Canva short link before loading the design", async () => {
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [],
    continuation: "",
  });
  jest.mocked(resolveCanvaDesignLink).mockResolvedValue({
    designId: "DAHULw6Qfe4",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAHULw6Qfe4",
    title: "Short Link Design",
    thumbnailUrl: "https://example.test/short-link.png",
    pageCount: 1,
    updatedAt: 200,
    editUrl: "https://www.canva.com/design/DAHULw6Qfe4/edit",
    viewUrl: "https://www.canva.com/design/DAHULw6Qfe4/view",
  });

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={jest.fn()}
          onVideoRefresh={jest.fn()}
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText(/Open by link/i),
    "https://canva.link/hy5vwxec3e5yyhg",
  );
  await user.click(screen.getByRole("button", { name: /^Open$/i }));

  await waitFor(() => {
    expect(resolveCanvaDesignLink).toHaveBeenCalledWith(
      "church-1",
      "https://canva.link/hy5vwxec3e5yyhg",
    );
  });
  await waitFor(() => {
    expect(getCanvaDesign).toHaveBeenCalledWith("church-1", "DAHULw6Qfe4");
  });
  expect(await screen.findByText("Short Link Design")).toBeInTheDocument();
});

test("refreshes an existing Canva media record when its design revision changes", async () => {
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAF_design_1",
    title: "Sunday Welcome",
    thumbnailUrl: "https://example.test/thumb.png",
    pageCount: 2,
    updatedAt: 101,
    editUrl: "https://www.canva.com/api/design/token/edit",
    viewUrl: "https://www.canva.com/api/design/token/view",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 2,
        updatedAt: 101,
        editUrl: "https://www.canva.com/api/design/token/edit",
        viewUrl: "https://www.canva.com/api/design/token/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "image", data: refreshedImage }],
    skippedCount: 0,
    revision: 101,
  });
  const onImageComplete = jest.fn();
  const onImageRefresh = jest.fn();

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={onImageComplete}
          onVideoComplete={jest.fn()}
          onImageRefresh={onImageRefresh}
          onVideoRefresh={jest.fn()}
          existingMedia={[existingMedia]}
          sourceMedia={existingMedia}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText("A newer Canva revision is available."),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  const openSpy = jest.spyOn(window, "open").mockReturnValue(null);
  await user.click(screen.getByRole("button", { name: "Edit in Canva" }));
  expect(mockShowToast).toHaveBeenCalledWith(
    "Canva did not open. Allow pop-ups for WorshipSync, then try again.",
    "error",
  );
  openSpy.mockRestore();
  await user.click(screen.getByRole("button", { name: "Change design" }));
  const prefetchedDesign = await screen.findByRole("button", {
    name: /Sunday Welcome/,
  });
  expect(listCanvaDesigns).toHaveBeenCalledWith("church-1");
  await user.click(prefetchedDesign);
  await user.click(screen.getByRole("button", { name: "Refresh selected" }));

  await waitFor(() => {
    expect(onImageRefresh).toHaveBeenCalledWith(refreshedImage, "media-1");
  });
  expect(onImageComplete).not.toHaveBeenCalled();
  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", {
    designId: "DAF_design_1",
    pages: [1],
    format: "png",
    existingImportKeys: ["canva:DAF_design_1:rev:100:png:1"],
  }, expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("refreshes an existing Canva video through the awaited callback", async () => {
  const existingVideo = {
    id: "media-video-1",
    name: "Weekly video",
    type: "video",
    background: "https://stream.mux.com/old-playback.m3u8",
    muxPlaybackId: "old-playback",
    muxAssetId: "old-mux-asset",
    canvaImportKey: "canva:DAF_design_1:rev:100:mp4:1,2",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 100,
      format: "mp4" as const,
      pageNumbers: [1, 2],
    },
  } as MediaType;
  const refreshedVideo = {
    playbackId: "new-playback",
    assetId: "new-mux-asset",
    playbackUrl: "https://stream.mux.com/new-playback.m3u8",
    thumbnailUrl: "https://image.mux.com/new-playback/thumbnail.jpg",
    name: "Sunday Welcome",
    canvaImportKey: "canva:DAF_design_1:rev:101:mp4:1,2",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 101,
      format: "mp4" as const,
      pageNumbers: [1, 2],
    },
  } as MuxUploadResult;
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAF_design_1",
    title: "Sunday Welcome",
    thumbnailUrl: "https://example.test/thumb.png",
    pageCount: 2,
    updatedAt: 101,
    editUrl: "https://www.canva.com/api/design/token/edit",
    viewUrl: "https://www.canva.com/design/DAF_design_1/view",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 2,
        updatedAt: 101,
        editUrl: "https://www.canva.com/design/DAF_design_1/edit",
        viewUrl: "https://www.canva.com/design/DAF_design_1/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "video", data: refreshedVideo }],
    skippedCount: 0,
    revision: 101,
  });
  const onVideoRefresh = jest.fn(async () => { });

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={jest.fn()}
          onVideoRefresh={onVideoRefresh}
          existingMedia={[existingVideo]}
          sourceMedia={existingVideo}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText("A newer Canva revision is available."),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Change design" }));
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  await user.click(screen.getByRole("button", { name: "Refresh selected" }));

  await waitFor(() => {
    expect(onVideoRefresh).toHaveBeenCalledWith(refreshedVideo, "media-video-1");
  });
  expect(onVideoRefresh).toHaveBeenCalledTimes(1);
});

test("awaits each refreshed Canva page before starting the next callback", async () => {
  const page1 = {
    ...existingMedia,
    canvaSource: {
      ...existingMedia.canvaSource!,
      revision: 100,
      pageNumbers: [1],
    },
  } as MediaType;
  const page2 = {
    ...page1,
    id: "media-2",
    canvaImportKey: "canva:DAF_design_1:rev:100:png:2",
    canvaSource: { ...page1.canvaSource!, pageNumbers: [2] },
  } as MediaType;
  const refreshed = (pageNumber: number) =>
    ({
      public_id: `new-page-${pageNumber}`,
      secure_url: `https://res.cloudinary.com/new-page-${pageNumber}.png`,
      thumbnail_url: `https://res.cloudinary.com/new-page-${pageNumber}-thumb.png`,
      resource_type: "image",
      format: "png",
      canvaImportKey: `canva:DAF_design_1:rev:101:png:${pageNumber}`,
      canvaSource: {
        designId: "DAF_design_1",
        designTitle: "Sunday Welcome",
        revision: 101,
        format: "png" as const,
        pageNumbers: [pageNumber],
      },
    }) as mediaInfoType;
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 2,
        updatedAt: 101,
        editUrl: "https://www.canva.com/design/DAF_design_1/edit",
        viewUrl: "https://www.canva.com/design/DAF_design_1/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [
      { kind: "image", data: refreshed(1) },
      { kind: "image", data: refreshed(2) },
    ],
    skippedCount: 0,
    revision: 101,
  });
  let releaseFirst: () => void = () => { };
  const firstRefreshComplete = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const onImageRefresh = jest.fn((_info: mediaInfoType, mediaId: string) =>
    mediaId === "media-1" ? firstRefreshComplete : Promise.resolve(),
  );

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={onImageRefresh}
          onVideoRefresh={jest.fn()}
          existingMedia={[page1, page2]}
          sourceMedia={page1}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText("A newer Canva revision is available."),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Change design" }));
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("button", { name: "Refresh selected" }));

  await waitFor(() => {
    expect(onImageRefresh).toHaveBeenCalledWith(refreshed(1), "media-1");
  });
  expect(onImageRefresh).toHaveBeenCalledTimes(1);
  releaseFirst();
  await waitFor(() => {
    expect(onImageRefresh).toHaveBeenCalledWith(refreshed(2), "media-2");
  });
});

test("cleans only returned Canva pages after a mid-list refresh failure", async () => {
  const existingPages = [1, 2, 3, 4].map(
    (pageNumber) =>
      ({
        ...existingMedia,
        id: `media-${pageNumber}`,
        canvaImportKey: `canva:DAF_design_1:rev:100:png:${pageNumber}`,
        canvaSource: {
          ...existingMedia.canvaSource!,
          pageNumbers: [pageNumber],
        },
      }) as MediaType,
  );
  const refreshedPages = [1, 2, 3, 4].map(
    (pageNumber) =>
      ({
        public_id: `new-page-${pageNumber}`,
        secure_url: `https://res.cloudinary.com/new-page-${pageNumber}.png`,
        thumbnail_url: `https://res.cloudinary.com/new-page-${pageNumber}-thumb.png`,
        resource_type: "image",
        format: "png",
        width: 1920,
        height: 1080,
        canvaImportKey: `canva:DAF_design_1:rev:101:png:${pageNumber}`,
        canvaSource: {
          designId: "DAF_design_1",
          designTitle: "Sunday Welcome",
          revision: 101,
          format: "png" as const,
          pageNumbers: [pageNumber],
        },
      }) as mediaInfoType,
  );
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAF_design_1",
    title: "Sunday Welcome",
    thumbnailUrl: "https://example.test/thumb.png",
    pageCount: 4,
    updatedAt: 101,
    editUrl: "https://www.canva.com/design/DAF_design_1/edit",
    viewUrl: "https://www.canva.com/design/DAF_design_1/view",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 4,
        updatedAt: 101,
        editUrl: "https://www.canva.com/design/DAF_design_1/edit",
        viewUrl: "https://www.canva.com/design/DAF_design_1/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: refreshedPages.map((data) => ({ kind: "image" as const, data })),
    skippedCount: 0,
    revision: 101,
  });
  const onImageRefresh = jest.fn(async (_info: mediaInfoType, mediaId: string) => {
    if (mediaId === "media-2") throw new Error("page 2 replacement failed");
  });
  let finishFirstCleanup: ((success: boolean) => void) | undefined;
  const cleanup = jest.fn()
    .mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        finishFirstCleanup = resolve;
      }),
    )
    .mockResolvedValue(true);

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={onImageRefresh}
          onVideoRefresh={jest.fn()}
          onUnprocessedAssetCleanup={cleanup}
          existingMedia={existingPages}
          sourceMedia={existingPages[0]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText("A newer Canva revision is available."),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Change design" }));
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  await user.click(screen.getByRole("button", { name: "Select all" }));
  await user.click(screen.getByRole("button", { name: "Refresh selected" }));

  await waitFor(() => {
    expect(onImageRefresh).toHaveBeenCalledTimes(2);
  });
  expect(onImageRefresh).toHaveBeenCalledWith(refreshedPages[0], "media-1");
  expect(onImageRefresh).toHaveBeenCalledWith(refreshedPages[1], "media-2");
  await waitFor(() => {
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByRole("button", { name: "Change design" })).toBeEnabled();
  await act(async () => finishFirstCleanup?.(false));
  await waitFor(() => {
    expect(cleanup).toHaveBeenCalledTimes(3);
  });
  expect(cleanup).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ kind: "image", data: refreshedPages[1] }),
  );
  expect(cleanup).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ kind: "image", data: refreshedPages[2] }),
  );
  expect(cleanup).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({ kind: "image", data: refreshedPages[3] }),
  );
  expect(cleanup).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: refreshedPages[0] }),
  );
});

test("creates a one-slide custom item for an imported Canva video", async () => {
  const importedVideo = {
    playbackId: "canva-video-1",
    assetId: "mux-asset-1",
    playbackUrl: "https://stream.mux.com/canva-video-1.m3u8",
    thumbnailUrl: "https://image.mux.com/canva-video-1/thumbnail.jpg",
    name: "Sunday Welcome",
    canvaImportKey: "canva:DAF_design_1:rev:100:mp4:1,2",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 100,
      format: "mp4" as const,
      pageNumbers: [1, 2],
    },
  } as MuxUploadResult;
  const createdVideo = {
    id: "media-video-1",
    name: "Sunday Welcome",
    type: "video",
    background: importedVideo.playbackUrl,
    canvaImportKey: importedVideo.canvaImportKey,
    canvaSource: importedVideo.canvaSource,
  } as MediaType;
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 2,
        updatedAt: 100,
        editUrl: "https://www.canva.com/api/design/token/edit",
        viewUrl: "https://www.canva.com/design/DAF_design_1/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "video", data: importedVideo }],
    skippedCount: 0,
    revision: 100,
  });
  const onVideoComplete = jest.fn(() => createdVideo);
  const onCreateDeckItem = jest.fn();

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={onVideoComplete}
          onImageRefresh={jest.fn()}
          onVideoRefresh={jest.fn()}
          onCreateDeckItem={onCreateDeckItem}
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("tab", { name: /MP4 video/i }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));

  await waitFor(() => {
    expect(onCreateDeckItem).toHaveBeenCalledWith(
      [createdVideo],
      "Sunday Welcome",
      expect.objectContaining({ navigateToItem: false, idempotencyKey: expect.any(String) }),
    );
  });
  expect(onVideoComplete).toHaveBeenCalledWith(importedVideo);
  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", {
    designId: "DAF_design_1",
    pages: [1, 2],
    format: "mp4",
    mp4ImportMode: "combined",
    existingImportKeys: [],
  }, expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("creates one custom-item slide per imported Canva video page", async () => {
  const createVideo = (pageNumber: number) =>
    ({
      playbackId: `canva-video-${pageNumber}`,
      assetId: `mux-asset-${pageNumber}`,
      playbackUrl: `https://stream.mux.com/canva-video-${pageNumber}.m3u8`,
      thumbnailUrl: `https://image.mux.com/canva-video-${pageNumber}/thumbnail.jpg`,
      name: `Sunday Welcome - Page ${pageNumber}`,
      canvaImportKey: `canva:DAF_design_1:rev:100:mp4:${pageNumber}`,
      canvaSource: {
        designId: "DAF_design_1",
        designTitle: "Sunday Welcome",
        revision: 100,
        format: "mp4" as const,
        pageNumbers: [pageNumber],
      },
    }) as MuxUploadResult;
  const importedVideos = [createVideo(1), createVideo(2)];
  const createdVideos = importedVideos.map(
    (video, index) =>
      ({
        id: `media-video-${index + 1}`,
        name: video.name,
        type: "video",
        background: video.playbackUrl,
        canvaImportKey: video.canvaImportKey,
        canvaSource: video.canvaSource,
      }) as MediaType,
  );
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 2,
        updatedAt: 100,
        editUrl: "https://www.canva.com/api/design/token/edit",
        viewUrl: "https://www.canva.com/design/DAF_design_1/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: importedVideos.map((data) => ({ kind: "video" as const, data })),
    skippedCount: 0,
    revision: 100,
  });
  const onVideoComplete = jest.fn((info: MuxUploadResult) =>
    createdVideos[info.canvaSource?.pageNumbers[0] === 1 ? 0 : 1],
  );
  const onCreateDeckItem = jest.fn();

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={onVideoComplete}
          onImageRefresh={jest.fn()}
          onVideoRefresh={jest.fn()}
          onCreateDeckItem={onCreateDeckItem}
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("tab", { name: /MP4 video/i }));
  await user.click(
    screen.getByRole("button", { name: "Separate video per page" }),
  );
  await user.click(screen.getByRole("button", { name: /Import selected/i }));

  await waitFor(() => {
    expect(onCreateDeckItem).toHaveBeenCalledWith(
      createdVideos,
      "Sunday Welcome",
      expect.objectContaining({ navigateToItem: false, idempotencyKey: expect.any(String) }),
    );
  });
  expect(onVideoComplete).toHaveBeenCalledTimes(2);
  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", {
    designId: "DAF_design_1",
    pages: [1, 2],
    format: "mp4",
    mp4ImportMode: "separate",
    existingImportKeys: [],
  }, expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("creates a deck from new, refreshed, and already-current selected pages", async () => {
  const page2Existing = {
    ...existingMedia,
    id: "media-2",
    name: "Weekly welcome page 2",
    canvaImportKey: "canva:DAF_design_1:rev:101:png:2",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 101,
      format: "png" as const,
      pageNumbers: [2],
    },
    background: "https://res.cloudinary.com/page-2.png",
  } as MediaType;
  const newPage3 = {
    public_id: "canva/new-page-3",
    secure_url: "https://res.cloudinary.com/new-page-3.png",
    thumbnail_url: "https://res.cloudinary.com/new-page-3-thumb.png",
    resource_type: "image",
    format: "png",
    width: 1920,
    height: 1080,
    original_filename: "Page 3",
    canvaImportKey: "canva:DAF_design_1:rev:101:png:3",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 101,
      format: "png" as const,
      pageNumbers: [3],
    },
  } as mediaInfoType;
  const createdPage3 = {
    id: "media-3",
    name: "Page 3",
    type: "image",
    background: newPage3.secure_url,
    canvaImportKey: newPage3.canvaImportKey,
    canvaSource: newPage3.canvaSource,
  } as MediaType;

  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 3,
        updatedAt: 101,
        editUrl: "https://www.canva.com/api/design/token/edit",
        viewUrl: "https://www.canva.com/api/design/token/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [
      { kind: "image", data: refreshedImage },
      { kind: "image", data: newPage3 },
    ],
    skippedCount: 1,
    revision: 101,
  });
  const onImageComplete = jest.fn(() => createdPage3);
  const onImageRefresh = jest.fn();
  const onCreateDeckItem = jest.fn();

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={onImageComplete}
          onVideoComplete={jest.fn()}
          onImageRefresh={onImageRefresh}
          onVideoRefresh={jest.fn()}
          onCreateDeckItem={onCreateDeckItem}
          existingMedia={[existingMedia, page2Existing]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  // Page 1 is pre-selected when a design opens; add the rest of the selection.
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("button", { name: /Page 3/i }));
  await user.click(
    screen.getByRole("button", { name: /Import selected|Refresh selected/i }),
  );

  await waitFor(() => {
    expect(onCreateDeckItem).toHaveBeenCalled();
  });
  const [deckPages, title] = onCreateDeckItem.mock.calls[0];
  expect(title).toBe("Sunday Welcome");
  expect(deckPages).toHaveLength(3);
  expect(deckPages[0].id).toBe("media-1");
  expect(deckPages[0].background).toBe(refreshedImage.secure_url);
  expect(deckPages[1].id).toBe("media-2");
  expect(deckPages[2].id).toBe("media-3");
  expect(onImageRefresh).toHaveBeenCalledWith(refreshedImage, "media-1");
  expect(onImageComplete).toHaveBeenCalledWith(newPage3);
});

const setCanvaDesignList = (pageCount = 4) => {
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_progress",
        title: "Progress Deck",
        thumbnailUrl: "https://example.test/progress.png",
        pageCount,
        updatedAt: 100,
        editUrl: "https://www.canva.com/design/DAF_design_progress/edit",
        viewUrl: "https://www.canva.com/design/DAF_design_progress/view",
      },
    ],
    continuation: "",
  });
};

const makeProgressAssets = (count: number) => Array.from({ length: count }, (_, index) => {
  const page = index + 1;
  return {
    kind: "image" as const,
    data: {
      ...refreshedImage,
      public_id: `progress-${page}`,
      secure_url: `https://example.test/progress-${page}.png`,
      canvaImportKey: `canva:DAF_design_progress:rev:101:png:${page}`,
      canvaSource: {
        designId: "DAF_design_progress",
        designTitle: "Progress Deck",
        revision: 101,
        format: "png" as const,
        pageNumbers: [page],
      },
    } as mediaInfoType,
  };
});

type CapturedCanvaJob = {
  run: (signal: AbortSignal, onProgress: (event: never) => void) => Promise<{
    assets: ReturnType<typeof makeProgressAssets>;
    skippedCount: number;
    revision: number;
  }>;
  finalize: (
    result: { assets: ReturnType<typeof makeProgressAssets>; skippedCount: number; revision: number },
    signal: AbortSignal,
    onPagesPersisted: (pages: number[]) => void,
  ) => Promise<unknown>;
  cleanupRetry?: () => Promise<void>;
};

test("starts a transfer, closes the import sheet, and finishes after the sheet closes", async () => {
  setCanvaDesignList(2);
  let resolveImport!: (result: { assets: { kind: "image"; data: mediaInfoType }[]; skippedCount: number; revision: number }) => void;
  jest.mocked(importCanvaDesign).mockImplementation(() => new Promise((resolve) => { resolveImport = resolve; }));
  const onImageComplete = jest.fn((info: mediaInfoType) => ({ id: info.canvaImportKey || "new-media", name: info.original_filename, background: info.secure_url, canvaSource: info.canvaSource } as MediaType));
  const Wrapper = () => {
    const [open, setOpen] = useState(true);
    return <MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
      <CanvaImportSheet open={open} onOpenChange={setOpen} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} existingMedia={[]} />
    </GlobalInfoContext.Provider></MemoryRouter>;
  };
  const user = userEvent.setup();
  const view = render(<Wrapper />);
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await waitFor(() => expect(importCanvaDesign).toHaveBeenCalled());
  expect(screen.queryByRole("dialog", { name: "Import from Canva" })).not.toBeInTheDocument();
  await act(async () => resolveImport({
    assets: [1, 2].map((page) => ({ kind: "image" as const, data: {
      ...refreshedImage,
      public_id: `page-${page}`,
      secure_url: `https://example.test/page-${page}.png`,
      original_filename: `Page ${page}`,
      canvaImportKey: `canva:DAF_design_progress:rev:101:png:${page}`,
      canvaSource: { designId: "DAF_design_progress", designTitle: "Sunday Welcome", revision: 101, format: "png" as const, pageNumbers: [page] },
    } })) as { kind: "image"; data: mediaInfoType }[],
    skippedCount: 0,
    revision: 101,
  }));
  await waitFor(() => expect(onImageComplete).toHaveBeenCalledTimes(2));
  view.unmount();
});

test("keeps the sheet open when the transfer cannot be registered", async () => {
  setCanvaDesignList(2);
  mockStartCanvaTransfer.mockImplementationOnce(() => { throw new Error("Transfer panel unavailable."); });
  const onOpenChange = jest.fn();
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={onOpenChange} onImageComplete={jest.fn()} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} existingMedia={[]} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Canva import couldn't finish. Please try again.");
  expect(screen.getByRole("dialog", { name: "Import from Canva" })).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test("builds queued import keys from Media state at execution time", async () => {
  setCanvaDesignList(1);
  let latestMedia: readonly MediaType[] = [];
  mockStartCanvaTransfer.mockImplementationOnce(() => "queued-canva");
  jest.mocked(importCanvaDesign).mockResolvedValue({ assets: [], skippedCount: 1, revision: 100 });
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={jest.fn()} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} existingMedia={[]} getCurrentMedia={() => latestMedia} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));

  latestMedia = [existingMedia];
  const queuedJob = mockStartCanvaTransfer.mock.calls[0][0] as unknown as {
    run: (signal: AbortSignal, onProgress: (event: never) => void) => Promise<unknown>;
  };
  await queuedJob.run(new AbortController().signal, jest.fn());

  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", expect.objectContaining({
    existingImportKeys: [existingMedia.canvaImportKey],
  }), expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("resolves a refresh target from current Media state during finalization", async () => {
  setCanvaDesignList(1);
  let latestMedia: readonly MediaType[] = [];
  mockStartCanvaTransfer.mockImplementationOnce(() => "queued-refresh");
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "image", data: refreshedImage }],
    skippedCount: 0,
    revision: 101,
  });
  const onImageRefresh = jest.fn().mockResolvedValue(true);
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={jest.fn()} onVideoComplete={jest.fn()} onImageRefresh={onImageRefresh} onVideoRefresh={jest.fn()} existingMedia={[]} getCurrentMedia={() => latestMedia} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  latestMedia = [existingMedia];

  const queuedJob = mockStartCanvaTransfer.mock.calls[0][0] as unknown as {
    run: (signal: AbortSignal, onProgress: (event: never) => void) => Promise<unknown>;
    finalize: (result: unknown, signal: AbortSignal, onPagesPersisted: (pages: number[]) => void) => Promise<unknown>;
  };
  const signal = new AbortController().signal;
  const imported = await queuedJob.run(signal, jest.fn());
  await queuedJob.finalize(imported, signal, jest.fn());

  expect(onImageRefresh).toHaveBeenCalledWith(refreshedImage, "media-1");
});

test("retains a Canva asset and fails its page when replacement reconciliation is required", async () => {
  setCanvaDesignList(1);
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [{
      id: "DAF_design_1",
      title: "Progress Deck",
      thumbnailUrl: "https://example.test/progress.png",
      pageCount: 1,
      updatedAt: 101,
      editUrl: "https://www.canva.com/design/DAF_design_1/edit",
      viewUrl: "https://www.canva.com/design/DAF_design_1/view",
    }],
    continuation: "",
  });
  mockStartCanvaTransfer.mockImplementationOnce(() => "queued-reconciliation");
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "image", data: refreshedImage }],
    skippedCount: 0,
    revision: 101,
  });
  const onImageRefresh = jest.fn().mockRejectedValue(
    new CanvaMediaReconciliationRequiredError("Canva media references need reconciliation. Both provider files were kept."),
  );
  const cleanup = jest.fn().mockResolvedValue(true);
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={jest.fn()} onVideoComplete={jest.fn()} onImageRefresh={onImageRefresh} onVideoRefresh={jest.fn()} onUnprocessedAssetCleanup={cleanup} existingMedia={[existingMedia as MediaType]} getCurrentMedia={() => [existingMedia as MediaType]} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Refresh selected/i }));
  const job = mockStartCanvaTransfer.mock.calls[0][0] as unknown as {
    run: (signal: AbortSignal, onProgress: (event: never) => void) => Promise<unknown>;
    finalize: (result: unknown, signal: AbortSignal, onPagesPersisted: (pages: number[]) => void) => Promise<unknown>;
  };
  const signal = new AbortController().signal;
  const imported = await job.run(signal, jest.fn());
  await expect(job.finalize(imported, signal, jest.fn())).rejects.toThrow("Both provider files were kept");
  expect(cleanup).not.toHaveBeenCalled();
});

test("fails and cleans the exported asset when a queued refresh target disappears", async () => {
  setCanvaDesignList(1);
  const oldTarget = { ...existingMedia, canvaImportKey: "canva:DAF_design_1:rev:99:png:1", canvaSource: { ...existingMedia.canvaSource, revision: 99 } } as MediaType;
  let latestMedia: readonly MediaType[] = [oldTarget];
  mockStartCanvaTransfer.mockImplementationOnce(() => "queued-missing-refresh");
  jest.mocked(importCanvaDesign).mockResolvedValue({ assets: [{ kind: "image", data: refreshedImage }], skippedCount: 0, revision: 101 });
  const cleanup = jest.fn().mockResolvedValue(true);
  const onImageComplete = jest.fn();
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} onUnprocessedAssetCleanup={cleanup} existingMedia={[oldTarget]} getCurrentMedia={() => latestMedia} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected|Refresh selected/i }));
  const queuedJob = mockStartCanvaTransfer.mock.calls[0][0] as unknown as {
    run: (signal: AbortSignal, onProgress: (event: never) => void) => Promise<unknown>;
    finalize: (result: unknown, signal: AbortSignal, onPagesPersisted: (pages: number[]) => void) => Promise<unknown>;
  };
  const signal = new AbortController().signal;
  const imported = await queuedJob.run(signal, jest.fn());
  latestMedia = [];
  await expect(queuedJob.finalize(imported, signal, jest.fn())).rejects.toThrow("The Canva refresh target is no longer in Media");
  expect(cleanup).toHaveBeenCalledWith({ kind: "image", data: refreshedImage });
  expect(onImageComplete).not.toHaveBeenCalled();
});

test("retries custom-item creation from saved media without exporting again", async () => {
  setCanvaDesignList(1);
  jest.mocked(importCanvaDesign).mockClear();
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "image", data: { ...refreshedImage, canvaImportKey: "canva:DAF_design_progress:rev:101:png:1", canvaSource: { designId: "DAF_design_progress", designTitle: "Progress Deck", revision: 101, format: "png", pageNumbers: [1] } } }],
    skippedCount: 0,
    revision: 101,
  });
  const savedMedia = { ...existingMedia, id: "saved-page" } as MediaType;
  let latestMedia: readonly MediaType[] = [];
  const onImageComplete = jest.fn(async () => {
    latestMedia = [savedMedia];
    return savedMedia;
  });
  const onCreateDeckItem = jest.fn()
    .mockRejectedValueOnce(new Error("Database unavailable."))
    .mockResolvedValueOnce("/controller/item-canva");
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} onCreateDeckItem={onCreateDeckItem} existingMedia={[]} getCurrentMedia={() => latestMedia} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await waitFor(() => expect(onCreateDeckItem).toHaveBeenCalledTimes(1));
  const job = mockStartCanvaTransfer.mock.calls[0][0] as unknown as { customItemRetry: () => Promise<string | void> };
  await expect(job.customItemRetry()).resolves.toBe("/controller/item-canva");

  expect(importCanvaDesign).toHaveBeenCalledTimes(1);
  expect(onImageComplete).toHaveBeenCalledTimes(1);
  expect(onCreateDeckItem.mock.calls[1][2]).toEqual(onCreateDeckItem.mock.calls[0][2]);
});

test("cleans every unprocessed Canva asset when cancelled before the first save", async () => {
  setCanvaDesignList(2);
  const assets = makeProgressAssets(2);
  jest.mocked(importCanvaDesign).mockResolvedValue({ assets, skippedCount: 0, revision: 101 });
  let job: CapturedCanvaJob | undefined;
  mockStartCanvaTransfer.mockImplementationOnce((input) => {
    job = input as unknown as CapturedCanvaJob;
    return "captured-before-save";
  });
  const cleanup = jest.fn().mockResolvedValue(true);
  const onImageComplete = jest.fn();
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} onUnprocessedAssetCleanup={cleanup} existingMedia={[]} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await waitFor(() => expect(importCanvaDesign).toHaveBeenCalled());

  const controller = new AbortController();
  const result = await job!.run(controller.signal, jest.fn());
  controller.abort();
  await expect(job!.finalize(result, controller.signal, jest.fn())).rejects.toThrow("cancelled");

  expect(onImageComplete).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenNthCalledWith(1, assets[0]);
  expect(cleanup).toHaveBeenNthCalledWith(2, assets[1]);
});

test("keeps an asset whose save completes after cancellation and cleans the next page", async () => {
  setCanvaDesignList(2);
  const assets = makeProgressAssets(2);
  jest.mocked(importCanvaDesign).mockResolvedValue({ assets, skippedCount: 0, revision: 101 });
  let job: CapturedCanvaJob | undefined;
  mockStartCanvaTransfer.mockImplementationOnce((input) => {
    job = input as unknown as CapturedCanvaJob;
    return "captured-active-save";
  });
  let finishSave!: (media: MediaType) => void;
  const saveGate = new Promise<MediaType>((resolve) => { finishSave = resolve; });
  const savedMedia = { id: "committed-page-1", background: assets[0].data.secure_url, canvaSource: assets[0].data.canvaSource } as MediaType;
  const onImageComplete = jest.fn(() => saveGate);
  const cleanup = jest.fn().mockResolvedValue(true);
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} onUnprocessedAssetCleanup={cleanup} existingMedia={[]} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await waitFor(() => expect(importCanvaDesign).toHaveBeenCalled());

  const controller = new AbortController();
  const result = await job!.run(controller.signal, jest.fn());
  const persistedPages = jest.fn();
  const finalizing = job!.finalize(result, controller.signal, persistedPages);
  const cancellation = finalizing.then(() => null, (error: unknown) => error);
  await waitFor(() => expect(onImageComplete).toHaveBeenCalledTimes(1));
  controller.abort();
  await act(async () => finishSave(savedMedia));
  const outcome = await cancellation;
  expect(outcome).toEqual(expect.objectContaining({ message: expect.stringContaining("cancelled") }));

  expect(persistedPages).toHaveBeenCalledWith([1]);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledWith(assets[1]);
  expect(cleanup).not.toHaveBeenCalledWith(assets[0]);
});

test("retains a failed save asset when cleanup fails and retries only that cleanup", async () => {
  setCanvaDesignList(2);
  const assets = makeProgressAssets(2);
  jest.mocked(importCanvaDesign).mockResolvedValue({ assets, skippedCount: 0, revision: 101 });
  let job: CapturedCanvaJob | undefined;
  mockStartCanvaTransfer.mockImplementationOnce((input) => {
    job = input as unknown as CapturedCanvaJob;
    return "captured-cleanup-retry";
  });
  const cleanup = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  const onImageComplete = jest.fn().mockRejectedValue(new Error("Media write could not be confirmed."));
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} onUnprocessedAssetCleanup={cleanup} existingMedia={[]} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await waitFor(() => expect(importCanvaDesign).toHaveBeenCalled());

  const signal = new AbortController().signal;
  const result = await job!.run(signal, jest.fn());
  await expect(job!.finalize(result, signal, jest.fn())).rejects.toThrow("could not be removed");
  expect(cleanup).toHaveBeenNthCalledWith(1, assets[0]);
  expect(cleanup).toHaveBeenNthCalledWith(2, assets[1]);
  await job!.cleanupRetry?.();
  expect(cleanup).toHaveBeenNthCalledWith(3, assets[0]);
  expect(cleanup).toHaveBeenCalledTimes(3);
});

test("cancellation immediately after a committed page stops the next page", async () => {
  setCanvaDesignList(2);
  const assets = makeProgressAssets(2);
  jest.mocked(importCanvaDesign).mockResolvedValue({ assets, skippedCount: 0, revision: 101 });
  let job: CapturedCanvaJob | undefined;
  mockStartCanvaTransfer.mockImplementationOnce((input) => {
    job = input as unknown as CapturedCanvaJob;
    return "captured-after-save";
  });
  const cleanup = jest.fn().mockResolvedValue(true);
  const onImageComplete = jest.fn(async (info: mediaInfoType) => ({
    id: `saved-${info.canvaSource?.pageNumbers?.[0]}`,
    background: info.secure_url,
    canvaSource: info.canvaSource,
  } as MediaType));
  render(<MemoryRouter><GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
    <CanvaImportSheet open onOpenChange={jest.fn()} onImageComplete={onImageComplete} onVideoComplete={jest.fn()} onImageRefresh={jest.fn()} onVideoRefresh={jest.fn()} onUnprocessedAssetCleanup={cleanup} existingMedia={[]} />
  </GlobalInfoContext.Provider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await waitFor(() => expect(importCanvaDesign).toHaveBeenCalled());

  const controller = new AbortController();
  const result = await job!.run(controller.signal, jest.fn());
  const persistedPages = jest.fn(() => controller.abort());
  const cancellation = job!.finalize(result, controller.signal, persistedPages).then(() => null, (error: unknown) => error);
  const outcome = await cancellation;
  expect(outcome).toEqual(expect.objectContaining({ message: expect.stringContaining("cancelled") }));

  expect(onImageComplete).toHaveBeenCalledTimes(1);
  expect(persistedPages).toHaveBeenCalledWith([1]);
  expect(cleanup).toHaveBeenCalledWith(assets[1]);
  expect(cleanup).not.toHaveBeenCalledWith(assets[0]);
});
