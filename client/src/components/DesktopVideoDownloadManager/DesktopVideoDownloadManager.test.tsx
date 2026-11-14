import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import store from "../../store/store";
import { GlobalInfoContext, globalFireDbInfo } from "../../context/globalInfo";
import { setGlobalContentDatabase } from "../../context/controllerInfo";
import { TransferProvider, useTransfers } from "../../context/transferContext";
import type { DesktopVideoDownloadEvent } from "../../types/electron";
import type { MediaType } from "../../types";
import mediaReducer, {
  initiateMediaFromDoc,
  setLoadStatus,
  syncMediaFromRemote,
} from "../../store/mediaSlice";
import * as mediaDocs from "../../utils/mediaDocUtils";
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
  return (
    <>
      <button
        type="button"
        onClick={() =>
          start({
            inspection: {
              inspectionId: "inspection-1",
              videoUrl: "https://www.youtube.com/watch?v=S9EUEdnJQDA",
              title: "Test Video",
              thumbnail: "",
              duration: 30,
              heights: [1080],
              defaultQuality: 1080,
            },
            inspectedUrl: "https://www.youtube.com/watch?v=S9EUEdnJQDA",
            displayName: "Test Video",
            quality: 1080,
            saveOutsideWorshipSync: false,
            uploadToCloud: false,
            owner: {
              churchId: "church-a",
              workspaceId: "church-a",
              controllerProfileId: "presentation",
              folderId: null,
              routePath: "/media",
            },
          })
        }
      >
        Start from dialog
      </button>
      <button type="button" onClick={() => navigate("/other")}>
        Close dialog and leave Media
      </button>
    </>
  );
};

describe("DesktopVideoDownloadManager provider lifetime", () => {
  const originalElectronApi = window.electronAPI;
  const originalChurchId = globalFireDbInfo.churchId;
  let sendProgress:
    | ((event: DesktopVideoDownloadEvent) => void | Promise<void>)
    | undefined;
  const originalActEnvironment = (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT;
  const onVideoDownloadProgress = jest.fn(
    (callback: (event: DesktopVideoDownloadEvent) => void | Promise<void>) => {
      sendProgress = callback;
      return jest.fn();
    },
  );
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
  const startVideoDownload = jest.fn(async ({ jobId }: { jobId: string }) => ({
    jobId,
  }));
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
      getLocalVideoRelinkStatus: jest.fn(async () => ({
        status: "pending",
        asset: { workspaceId: "church-a" },
      })),
      commitRelinkLocalVideoFile: jest.fn(async () => ({
        assetId: "stable",
        contentHash: "b".repeat(64),
        size: 100,
      })),
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
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    window.electronAPI = originalElectronApi;
    globalFireDbInfo.churchId = originalChurchId;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
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
                  <Route
                    path="/other"
                    element={<p>Other controller route</p>}
                  />
                </Routes>
              </DesktopVideoDownloadManager>
            </TransferProvider>
          </GlobalInfoContext.Provider>
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() =>
      expect(onVideoDownloadProgress).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start from dialog" }));
    await waitFor(() => expect(startVideoDownload).toHaveBeenCalledTimes(1));
    const { jobId } = startVideoDownload.mock.calls[0][0];
    fireEvent.click(
      screen.getByRole("button", { name: "Close dialog and leave Media" }),
    );
    expect(
      await screen.findByText("Other controller route"),
    ).toBeInTheDocument();

    await act(async () => {
      sendProgress?.({
        jobId,
        stage: "downloading",
        progress: 50,
        downloadedBytes: 50,
        totalBytes: 100,
      });
    });
    const setTaskbarUploadProgress = window.electronAPI
      ?.setTaskbarUploadProgress as jest.Mock;
    await waitFor(() =>
      expect(setTaskbarUploadProgress).toHaveBeenCalledWith(0.5),
    );
    cleanupVideoDownload.mockRejectedValueOnce(
      new Error("Temporary cleanup failure"),
    );

    await act(async () => {
      await sendProgress?.({
        jobId,
        stage: "complete",
        progress: 100,
        result: { width: 1920, height: 1080, duration: 30, size: 100 },
      });
    });

    expect(
      await screen.findByRole("button", { name: "View in Media Library" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Retry cleanup" }),
    ).toBeInTheDocument();
    expect(importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(cleanupVideoDownload).toHaveBeenCalledWith(jobId);
    expect(onVideoDownloadProgress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));
    await waitFor(() => expect(cleanupVideoDownload).toHaveBeenCalledTimes(2));
    expect(importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "View in Media Library" }),
    ).toBeInTheDocument();
  });
});

const pendingRelink = (patch: Partial<MediaType> = {}): MediaType =>
  ({
    id: "video-1",
    name: "Sermon",
    path: "",
    createdAt: "today",
    updatedAt: "today",
    format: "mp4",
    height: 1080,
    width: 1920,
    publicId: "video-1",
    type: "video",
    localVideoFile: {
      id: "stable-asset",
      contentHash: "b".repeat(64),
      ownerDeviceId: "device-a",
      ownerLabel: "Controller",
      fileName: "sermon.mp4",
      contentType: "video/mp4",
      storageMode: "linked",
      storagePolicy: "local-only",
    },
    pendingLinkedVideoCleanup: [
      {
        localAssetId: "staged-candidate",
        linkedAssetId: "stable-asset",
        contentHash: "b".repeat(64),
        previousContentHash: "a".repeat(64),
        muxAssetIds: ["old-mux-asset"],
        contentChanged: true,
        previousFields: {
          width: 1920,
          height: 1080,
          duration: 60,
          format: "mp4",
          background: "",
          thumbnail: "",
          placeholderImage: "",
          localVideoFile: {
            id: "stable-asset",
            contentHash: "a".repeat(64),
          } as never,
          updatedAt: "today",
        },
        proposedFields: {
          width: 1280,
          height: 720,
          duration: 90,
          format: "mp4",
          background: "",
          thumbnail: "",
          placeholderImage: "",
          localVideoFile: {
            id: "stable-asset",
            contentHash: "b".repeat(64),
          } as never,
          updatedAt: "today",
        },
      },
    ],
    ...patch,
  }) as MediaType;

const RecoveryActivity = () => {
  const { transfers } = useTransfers();
  const recovery = transfers.filter((transfer) =>
    transfer.id.startsWith("media-relink-cleanup-"),
  );
  return (
    <div data-testid="recovery-activity">
      <span data-testid="recovery-count">{recovery.length}</span>
      {recovery.map((transfer) => (
        <section key={transfer.id}>
          <span>{transfer.name}</span>
          {transfer.error && (
            <span data-testid="recovery-error">{transfer.error.message}</span>
          )}
          {transfer.actions?.map((action) => (
            <span data-testid="recovery-action-label" key={action.key}>
              {action.label}
            </span>
          ))}
        </section>
      ))}
    </div>
  );
};

describe("startup linked-video recovery discovery", () => {
  const originalChurchId = globalFireDbInfo.churchId;
  const originalElectronApi = window.electronAPI;
  const loadLibrary = jest.spyOn(mediaDocs, "loadMediaLibrary");
  const readItem = jest.spyOn(mediaDocs, "readMediaItemForDeletion");
  const createDb = (name: string) => ({ name }) as unknown as PouchDB.Database;
  const freshStore = () => configureStore({ reducer: { media: mediaReducer } });
  const LeaveMedia = () => {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate("/other")}>
        Leave Media
      </button>
    );
  };
  const renderRecovery = ({
    db = createDb("church-a-db"),
    churchId = "church-a",
    persisted = [pendingRelink()],
    ready = true,
    children = <p>Media route</p>,
  }: {
    db?: PouchDB.Database;
    churchId?: string;
    persisted?: MediaType[];
    ready?: boolean;
    children?: ReactNode;
  } = {}) => {
    const testStore = freshStore();
    testStore.dispatch(
      ready
        ? initiateMediaFromDoc({ list: [], folders: [] })
        : { type: "media/setLoadStatus", payload: "loading" },
    );
    setGlobalContentDatabase(db, { databaseKey: churchId, churchId });
    globalFireDbInfo.churchId = churchId;
    loadLibrary.mockImplementation(async () => ({
      list: persisted,
      folders: [],
    }));
    readItem.mockImplementation(async (_capturedDb, id) => {
      const item = persisted.find((row) => row.id === id);
      return item ? { doc: {} as never, item } : null;
    });
    const view = render(
      <Provider store={testStore}>
        <MemoryRouter initialEntries={["/media"]}>
          <GlobalInfoContext.Provider value={{ churchId } as never}>
            <TransferProvider>
              <DesktopVideoDownloadManager>
                <Routes>
                  <Route
                    path="/media"
                    element={
                      <>
                        {children}
                        <LeaveMedia />
                      </>
                    }
                  />
                  <Route path="/other" element={<p>Other route</p>} />
                </Routes>
                <RecoveryActivity />
              </DesktopVideoDownloadManager>
            </TransferProvider>
          </GlobalInfoContext.Provider>
        </MemoryRouter>
      </Provider>,
    );
    return { ...view, testStore, db };
  };

  beforeEach(() => {
    loadLibrary.mockReset();
    readItem.mockReset();
    globalFireDbInfo.churchId = "church-a";
    window.electronAPI = {
      onVideoDownloadProgress: jest.fn(() => jest.fn()),
      getLocalVideoRelinkStatus: jest.fn(async () => ({
        status: "pending",
        asset: { workspaceId: "church-a", contentHash: "a".repeat(64) },
      })),
      commitRelinkLocalVideoFile: jest.fn(async () => ({
        assetId: "stable-asset",
        contentHash: "b".repeat(64),
        size: 100,
      })),
      deleteLocalAsset: jest.fn(async () => true),
      notifyLocalVideoAssetChanged: jest.fn(async () => true),
      cancelVideoDownload: jest.fn(async () => true),
      cleanupVideoDownload: jest.fn(async () => true),
      setUploadInProgress: jest.fn(async () => true),
      setTaskbarUploadProgress: jest.fn(async () => true),
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    setGlobalContentDatabase(undefined);
    globalFireDbInfo.churchId = originalChurchId;
    window.electronAPI = originalElectronApi;
  });

  afterAll(() => {
    loadLibrary.mockRestore();
    readItem.mockRestore();
  });

  it.each(["pending", "committed"] as const)(
    "discovers a persisted checkpoint when native adoption is %s",
    async (status) => {
      window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(async () => ({
        status,
        asset: {
          workspaceId: "church-a",
          contentHash: status === "pending" ? "a".repeat(64) : "b".repeat(64),
        },
      })) as never;
      renderRecovery();

      const activity = await screen.findByTestId("recovery-activity");
      expect(within(activity).getByText("Retry relink")).toBeInTheDocument();
      expect(screen.getByTestId("recovery-count")).toHaveTextContent("1");
      expect(screen.queryByText(/files were kept/i)).not.toBeInTheDocument();
      expect(
        window.electronAPI!.getLocalVideoRelinkStatus,
      ).toHaveBeenCalledWith("stable-asset", "staged-candidate");
      expect(
        window.electronAPI!.commitRelinkLocalVideoFile,
      ).not.toHaveBeenCalled();
    },
  );

  it("waits for Media Library initialization and discovers from the persisted library", async () => {
    const { testStore } = renderRecovery({ ready: false });
    expect(loadLibrary).not.toHaveBeenCalled();
    act(() => {
      testStore.dispatch(initiateMediaFromDoc({ list: [], folders: [] }));
    });
    expect(
      await within(screen.getByTestId("recovery-activity")).findByText(
        "Retry relink",
      ),
    ).toBeInTheDocument();
    expect(loadLibrary).toHaveBeenCalledTimes(1);
  });

  it("keeps a recovery action after the Media route unmounts during native reconciliation", async () => {
    let finishStatus!: (value: {
      status: "pending";
      asset: { workspaceId: string };
    }) => void;
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(
      () =>
        new Promise((resolve) => {
          finishStatus = resolve;
        }),
    ) as never;
    renderRecovery();
    await waitFor(() =>
      expect(
        window.electronAPI!.getLocalVideoRelinkStatus,
      ).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave Media" }));
    expect(await screen.findByText("Other route")).toBeInTheDocument();

    await act(async () => {
      finishStatus({ status: "pending", asset: { workspaceId: "church-a" } });
    });
    expect(
      await within(screen.getByTestId("recovery-activity")).findByText(
        "Retry relink",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("recovery-count")).toHaveTextContent("1");
  });

  it("deduplicates replication and repeated initialization for the same checkpoint", async () => {
    const { testStore } = renderRecovery();
    expect(
      await within(screen.getByTestId("recovery-activity")).findByText(
        "Retry relink",
      ),
    ).toBeInTheDocument();
    act(() => {
      testStore.dispatch(setLoadStatus("loading"));
    });
    act(() => {
      testStore.dispatch(
        initiateMediaFromDoc({ list: [pendingRelink()], folders: [] }),
      );
    });
    await waitFor(() => expect(loadLibrary).toHaveBeenCalledTimes(2));
    act(() => {
      testStore.dispatch(
        syncMediaFromRemote({
          list: [pendingRelink({ name: "A later rename" })],
          folders: [],
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("recovery-count")).toHaveTextContent("1"),
    );
    expect(loadLibrary).toHaveBeenCalledTimes(2);
    expect(window.electronAPI!.getLocalVideoRelinkStatus).toHaveBeenCalledTimes(
      1,
    );
    expect(
      within(screen.getByTestId("recovery-activity")).getAllByText(
        "Retry relink",
      ),
    ).toHaveLength(1);
  });

  it("shows cleanup recovery without an error for a rolled-back checkpoint", async () => {
    const rolledBack = pendingRelink({
      localVideoFile: {
        id: "stable-asset",
        contentHash: "a".repeat(64),
        ownerDeviceId: "device-a",
        ownerLabel: "Controller",
        fileName: "sermon.mp4",
        contentType: "video/mp4",
        storageMode: "linked",
        storagePolicy: "local-and-cloud",
      },
      pendingLinkedVideoCleanup: [
        { ...pendingRelink().pendingLinkedVideoCleanup![0], rolledBack: true },
      ],
    });
    renderRecovery({ persisted: [rolledBack] });
    expect(
      await within(screen.getByTestId("recovery-activity")).findByText(
        "Retry cleanup",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("recovery-error")).not.toBeInTheDocument();
    expect(
      window.electronAPI!.commitRelinkLocalVideoFile,
    ).not.toHaveBeenCalled();
  });

  it("shows uncertainty without running cleanup when native status conflicts", async () => {
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(async () => ({
      status: "superseded",
      asset: { workspaceId: "church-b" },
    })) as never;
    renderRecovery();
    expect(
      await within(screen.getByTestId("recovery-activity")).findByText(
        /different church/i,
      ),
    ).toBeInTheDocument();
    expect(
      window.electronAPI!.commitRelinkLocalVideoFile,
    ).not.toHaveBeenCalled();
    expect(window.electronAPI!.deleteLocalAsset).not.toHaveBeenCalled();
  });

  it("does not register a completed checkpoint", async () => {
    renderRecovery({
      persisted: [pendingRelink({ pendingLinkedVideoCleanup: [] })],
    });
    await waitFor(() => expect(loadLibrary).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("recovery-count")).toHaveTextContent("0");
    expect(
      window.electronAPI!.getLocalVideoRelinkStatus,
    ).not.toHaveBeenCalled();
  });

  it("does not publish Church A recovery after the operator switches to Church B mid-discovery", async () => {
    let finishStatus!: (value: {
      status: "pending";
      asset: { workspaceId: string };
    }) => void;
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(
      () =>
        new Promise((resolve) => {
          finishStatus = resolve;
        }),
    ) as never;
    const dbA = createDb("church-a-db");
    const view = renderRecovery({ db: dbA });
    await waitFor(() =>
      expect(
        window.electronAPI!.getLocalVideoRelinkStatus,
      ).toHaveBeenCalledTimes(1),
    );

    const dbB = createDb("church-b-db");
    setGlobalContentDatabase(dbB, {
      databaseKey: "church-b",
      churchId: "church-b",
    });
    globalFireDbInfo.churchId = "church-b";
    loadLibrary.mockImplementation(async () => ({ list: [], folders: [] }));
    view.rerender(
      <Provider store={view.testStore}>
        <MemoryRouter initialEntries={["/media"]}>
          <GlobalInfoContext.Provider value={{ churchId: "church-b" } as never}>
            <TransferProvider>
              <DesktopVideoDownloadManager>
                <Routes>
                  <Route path="/media" element={<p>Media route</p>} />
                </Routes>
                <RecoveryActivity />
              </DesktopVideoDownloadManager>
            </TransferProvider>
          </GlobalInfoContext.Provider>
        </MemoryRouter>
      </Provider>,
    );
    await act(async () => {
      finishStatus({ status: "pending", asset: { workspaceId: "church-a" } });
    });
    await waitFor(() => expect(loadLibrary).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("recovery-count")).toHaveTextContent("0");
  });
});
