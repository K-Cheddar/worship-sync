import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import store from "../../store/store";
import { GlobalInfoContext, globalFireDbInfo } from "../../context/globalInfo";
import { TransferProvider } from "../../context/transferContext";
import type { DesktopVideoDownloadEvent } from "../../types/electron";
import { useDesktopVideoDownload } from "./DesktopVideoDownloadManager";
import DesktopVideoDownloadManager from "./DesktopVideoDownloadManager";

jest.mock("../../containers/Media/localMediaImport", () => ({
  createLocalMediaFromDownloadedVideo: jest.fn(async () => ({
    id: "local_video_download_test-job",
    name: "Test Video",
    type: "video",
    localVideoFile: { id: "local_video_download_test-job" },
  })),
}));
jest.mock("./persistDownloadedVideoMedia", () => ({
  persistDownloadedVideoMedia: jest.fn(async () => undefined),
}));

const StartPage = () => {
  const { start } = useDesktopVideoDownload();
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => start({
      inspection: { inspectionId: "inspection-1", title: "Test Video", thumbnail: "", duration: 30, heights: [1080], defaultQuality: 1080 },
      inspectedUrl: "https://youtu.be/test",
      displayName: "Test Video",
      quality: 1080,
      destination: "computer",
      owner: { churchId: "church-a", workspaceId: "church-a", controllerProfileId: "presentation", folderId: null, routePath: "/media" },
    })}>Start from dialog</button>
    <button type="button" onClick={() => navigate("/other")}>Close dialog and leave Media</button>
  </>;
};

describe("DesktopVideoDownloadManager provider lifetime", () => {
  const originalElectronApi = window.electronAPI;
  const originalChurchId = globalFireDbInfo.churchId;
  let sendProgress: ((event: DesktopVideoDownloadEvent) => void | Promise<void>) | undefined;
  const originalActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  const onVideoDownloadProgress = jest.fn((callback: (event: DesktopVideoDownloadEvent) => void | Promise<void>) => {
    sendProgress = callback;
    return jest.fn();
  });
  const importDownloadedVideo = jest.fn(async () => ({
    assetId: "local_video_download_test-job",
    workspaceId: "church-a",
    kind: "video" as const,
    fileName: "Test Video.mp4",
    contentType: "video/mp4",
    size: 100,
    width: 1920,
    height: 1080,
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
    url: "worshipsync-local-asset://test",
  }));
  const startVideoDownload = jest.fn(async ({ jobId }: { jobId: string }) => ({ jobId }));
  const cleanupVideoDownload = jest.fn(async () => true);

  beforeEach(() => {
    sendProgress = undefined;
    globalFireDbInfo.churchId = "church-a";
    window.electronAPI = {
      onVideoDownloadProgress,
      startVideoDownload,
      importDownloadedVideo,
      cleanupVideoDownload,
      inspectVideoUrl: jest.fn(),
      cancelVideoDownload: jest.fn(async () => true),
      deleteLocalAsset: jest.fn(async () => true),
      uploadDownloadedVideoToMux: jest.fn(async () => undefined),
      setUploadInProgress: jest.fn(async () => true),
      setTaskbarUploadProgress: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;
    onVideoDownloadProgress.mockClear();
    startVideoDownload.mockClear();
    importDownloadedVideo.mockClear();
    cleanupVideoDownload.mockClear();
  });

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    window.electronAPI = originalElectronApi;
    globalFireDbInfo.churchId = originalChurchId;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  it("keeps progress and import alive after the dialog closes and its Media route unmounts", async () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/media"]}>
          <GlobalInfoContext.Provider value={{ churchId: "church-a" } as never}>
            <TransferProvider>
              <DesktopVideoDownloadManager>
                <Routes>
                  <Route path="/media" element={<StartPage />} />
                  <Route path="/other" element={<p>Other controller route</p>} />
                </Routes>
              </DesktopVideoDownloadManager>
            </TransferProvider>
          </GlobalInfoContext.Provider>
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => expect(onVideoDownloadProgress).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Start from dialog" }));
    await waitFor(() => expect(startVideoDownload).toHaveBeenCalledTimes(1));
    const { jobId } = startVideoDownload.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Close dialog and leave Media" }));
    expect(await screen.findByText("Other controller route")).toBeInTheDocument();

    await act(async () => {
      sendProgress?.({ jobId, stage: "downloading", progress: 50, downloadedBytes: 50, totalBytes: 100 });
    });
    const setTaskbarUploadProgress = window.electronAPI?.setTaskbarUploadProgress as jest.Mock;
    await waitFor(() => expect(setTaskbarUploadProgress).toHaveBeenCalledWith(0.5));
    cleanupVideoDownload.mockRejectedValueOnce(new Error("Temporary cleanup failure"));

    await act(async () => {
      await sendProgress?.({
        jobId,
        stage: "complete",
        progress: 100,
        result: { width: 1920, height: 1080, duration: 30, size: 100 },
      });
    });

    expect(await screen.findByRole("button", { name: "View in Media Library" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry cleanup" })).toBeInTheDocument();
    expect(importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(cleanupVideoDownload).toHaveBeenCalledWith(jobId);
    expect(onVideoDownloadProgress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));
    await waitFor(() => expect(cleanupVideoDownload).toHaveBeenCalledTimes(2));
    expect(importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "View in Media Library" })).toBeInTheDocument();
  });
});
