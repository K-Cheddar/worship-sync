import { act, render, screen, waitFor } from "@testing-library/react";
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

jest.mock("../../api/canva", () => ({
  getCanvaStatus: jest.fn(),
  getCanvaDesign: jest.fn(),
  importCanvaDesign: jest.fn(),
  listCanvaDesigns: jest.fn(),
  resolveCanvaDesignLink: jest.fn(),
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
    replacementAssets: [],
  }, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
  const cleanup = jest.fn(async () => true);

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
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  expect(cleanup).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ kind: "image", data: refreshedPages[2] }),
  );
  expect(cleanup).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ kind: "image", data: refreshedPages[3] }),
  );
  expect(cleanup).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: refreshedPages[0] }),
  );
  expect(cleanup).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: refreshedPages[1] }),
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
    );
  });
  expect(onVideoComplete).toHaveBeenCalledWith(importedVideo);
  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", {
    designId: "DAF_design_1",
    pages: [1, 2],
    format: "mp4",
    mp4ImportMode: "combined",
    existingImportKeys: [],
    replacementAssets: [],
  }, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    );
  });
  expect(onVideoComplete).toHaveBeenCalledTimes(2);
  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", {
    designId: "DAF_design_1",
    pages: [1, 2],
    format: "mp4",
    mp4ImportMode: "separate",
    existingImportKeys: [],
    replacementAssets: [],
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

const createProgressVideo = (pageNumber: number) =>
  ({
    playbackId: `progress-video-${pageNumber}`,
    assetId: `progress-asset-${pageNumber}`,
    playbackUrl: `https://stream.mux.com/progress-video-${pageNumber}.m3u8`,
    thumbnailUrl: `https://image.mux.com/progress-video-${pageNumber}/thumbnail.jpg`,
    name: `Progress Deck - Page ${pageNumber}`,
    canvaImportKey: `canva:DAF_design_progress:rev:100:mp4:${pageNumber}`,
    canvaSource: {
      designId: "DAF_design_progress",
      designTitle: "Progress Deck",
      revision: 100,
      format: "mp4" as const,
      pageNumbers: [pageNumber],
    },
  }) as MuxUploadResult;

test("shows live separate-video page progress and disables import controls", async () => {
  setCanvaDesignList();
  let finishImport: (() => void) | undefined;
  jest.mocked(importCanvaDesign).mockImplementation(
    async (_churchId, _request, onProgress) => {
      onProgress?.({ type: "started", total: 4, pages: [1, 2, 3, 4] });
      onProgress?.({ type: "page-progress", page: 1, status: "exporting" });
      onProgress?.({
        type: "page-progress",
        page: 2,
        status: "processing",
        exported: true,
      });
      onProgress?.({ type: "page-progress", page: 3, status: "exporting" });
      return new Promise((resolve) => {
        finishImport = () => {
          [1, 2, 3, 4].forEach((page) =>
            onProgress?.({
              type: "page-progress",
              page,
              status: "ready",
              exported: true,
            }),
          );
          resolve({
            assets: [1, 2, 3, 4].map((page) => ({
              kind: "video" as const,
              data: createProgressVideo(page),
            })),
            skippedCount: 0,
            revision: 100,
          });
        };
      });
    },
  );
  const onVideoComplete = jest.fn(() => ({
    id: "media-progress",
    name: "Progress video",
    type: "video",
  }) as MediaType);

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
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("button", { name: /Page 3/i }));
  await user.click(screen.getByRole("button", { name: /Page 4/i }));
  await user.click(screen.getByRole("tab", { name: /MP4 video/i }));
  await user.click(screen.getByRole("button", { name: "Separate video per page" }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));

  expect(await screen.findByText("0 of 4 ready · 1 waiting · 2 exporting · 1 processing")).toBeInTheDocument();
  expect(screen.getAllByText("Exporting…")).toHaveLength(2);
  expect(screen.getByText("Processing…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Page 1/i })).toBeDisabled();
  expect(screen.getByRole("tab", { name: /PNG images/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Separate video per page" })).toBeDisabled();

  await act(async () => {
    finishImport?.();
  });
  expect(await screen.findByText("4 of 4 ready")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Canva import progress" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  expect(onVideoComplete).toHaveBeenCalledTimes(4);
});

test("keeps the failed Canva page visible and does not create a partial deck", async () => {
  setCanvaDesignList(3);
  const onOpenChange = jest.fn();
  const onCreateDeckItem = jest.fn();
  jest.mocked(importCanvaDesign).mockImplementation(
    async (_churchId, _request, onProgress) => {
      onProgress?.({ type: "started", total: 3, pages: [1, 2, 3] });
      onProgress?.({ type: "page-progress", page: 1, status: "ready", exported: true });
      onProgress?.({
        type: "page-progress",
        page: 2,
        status: "error",
        error: "Canva could not export page 2.",
      });
      throw new Error("Canva could not export page 2.");
    },
  );

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={onOpenChange}
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
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("button", { name: /Page 3/i }));
  await user.click(screen.getByRole("tab", { name: /MP4 video/i }));
  await user.click(screen.getByRole("button", { name: "Separate video per page" }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));

  expect(await screen.findByText("Failed")).toBeInTheDocument();
  expect(screen.getByText("1 of 3 ready · 1 waiting · 1 failed")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("page 2");
  expect(onCreateDeckItem).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test("cancels an active import and immediately closes the sheet", async () => {
  setCanvaDesignList(2);
  const onOpenChange = jest.fn();
  let importSignal: AbortSignal | undefined;
  let progressHandler: ((event: { type: "page-progress"; page: number; status: "ready" }) => void) | undefined;
  jest.mocked(importCanvaDesign).mockImplementation(
    async (_churchId, _request, onProgress, options) => {
      importSignal = options?.signal;
      progressHandler = onProgress as typeof progressHandler;
      return new Promise(() => undefined);
    },
  );

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={onOpenChange}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={jest.fn()}
          onVideoRefresh={jest.fn()}
          onCreateDeckItem={jest.fn()}
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Progress Deck/ }));
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("tab", { name: /MP4 video/i }));
  await user.click(screen.getByRole("button", { name: /Import selected/i }));
  await user.click(await screen.findByRole("button", { name: "Cancel import" }));

  expect(importSignal?.aborted).toBe(true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByText(/0 of 2 ready/)).toBeInTheDocument();
  progressHandler?.({ type: "page-progress", page: 2, status: "ready" });
  expect(screen.getByText(/0 of 2 ready/)).toBeInTheDocument();
});
