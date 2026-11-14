import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { GlobalInfoContext, globalFireDbInfo } from "../../context/globalInfo";
import { globalDb } from "../../context/controllerInfo";
import { useTransferActions } from "../../context/transferContext";
import { useDispatch, useSelector } from "../../hooks";
import {
  setFocusMediaId,
  setIsMediaExpanded,
  setRequestOpenMediaPanel,
} from "../../store/preferencesSlice";
import type { RootState } from "../../store/store";
import { registerLinkedVideoReplacementRecovery } from "../../containers/Media/relinkLocalVideo";
import {
  loadMediaLibrary,
  readMediaItemForDeletion,
} from "../../utils/mediaDocUtils";
import type { MediaType } from "../../types";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";
import { buildLocalVideoCloudSharePatch } from "../../containers/Media/localMediaCloudShare";
import { createLocalMediaFromDownloadedVideo } from "../../containers/Media/localMediaImport";
import { uploadDownloadedVideoToMux } from "../../containers/Media/utils/muxUpload";
import { MEDIA_STORAGE_CHANGED_EVENT } from "../../containers/Media/mediaStorageEvents";
import {
  DesktopVideoDownloadManager as DesktopVideoDownloadController,
  type DesktopVideoDownloadInput,
  type DesktopVideoDownloadOwner,
} from "./desktopVideoDownloadController";
import {
  persistDownloadedVideoMedia,
  removeDownloadedVideoAssetIfUnreferenced,
  removeDownloadedVideoMuxAssetIfUnreferenced,
} from "./persistDownloadedVideoMedia";

type DesktopVideoDownloadContextValue = {
  start: (input: DesktopVideoDownloadInput) => string;
};

const DesktopVideoDownloadContext =
  createContext<DesktopVideoDownloadContextValue | null>(null);

export const useDesktopVideoDownload = () => {
  const context = useContext(DesktopVideoDownloadContext);
  if (!context) throw new Error("Desktop video downloads are unavailable.");
  return context;
};

const DesktopVideoDownloadManager = ({ children }: { children: ReactNode }) => {
  const info = useContext(GlobalInfoContext);
  const churchId = info?.churchId ?? "";
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  const churchIdRef = useRef(churchId);
  navigateRef.current = navigate;
  churchIdRef.current = churchId;
  const transfer = useTransferActions();
  const mediaItems = useSelector((state) => state.media.list);
  const mediaLoadStatus = useSelector((state) => state.media.loadStatus);
  const recoveryCheckpointSignature = useMemo(
    () =>
      JSON.stringify(
        mediaItems
          .filter((media) => media.pendingLinkedVideoCleanup?.length)
          .map(({ id, pendingLinkedVideoCleanup }) => [
            id,
            pendingLinkedVideoCleanup,
          ]),
      ),
    [mediaItems],
  );
  const recoveredCleanup = useRef(
    new Map<
      string,
      {
        churchId: string;
        mediaId: string;
        db: object;
        checkpoint: string;
      }
    >(),
  );
  const recoveryScans = useRef(
    new WeakMap<
      object,
      { churchId: string; inFlight: boolean; rerun: boolean }
    >(),
  );
  const mountedRef = useRef(true);
  const managerRef = useRef<DesktopVideoDownloadController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!managerRef.current && window.electronAPI) {
    const native = window.electronAPI;
    const isOwnerCurrent = (owner: DesktopVideoDownloadOwner) =>
      churchIdRef.current === owner.churchId &&
      globalFireDbInfo.churchId === owner.churchId &&
      globalDb === owner.dbAtStart;
    const persistMediaItem = (
      incoming: MediaType,
      owner: DesktopVideoDownloadOwner,
      patch?: Partial<MediaType>,
    ) =>
      persistDownloadedVideoMedia({
        incoming,
        owner,
        patch,
        dispatch,
        getState: reduxStore.getState,
        isOwnerCurrent,
      });

    managerRef.current = new DesktopVideoDownloadController({
      native,
      getDatabase: () => globalDb,
      isOwnerCurrent,
      createLocalMedia: ({
        asset,
        owner,
        displayName,
        duration,
        thumbnail,
        uploadToCloud,
      }) =>
        createLocalMediaFromDownloadedVideo({
          asset,
          workspaceId: owner.workspaceId,
          displayName,
          duration,
          thumbnail,
          storagePolicy: uploadToCloud ? "local-and-cloud" : "local-only",
          folderId: owner.folderId,
        }),
      registerLocalMedia: (media, owner) => persistMediaItem(media, owner),
      registerCloudMedia: (media, patch, owner) =>
        persistMediaItem(media, owner, patch),
      removeUnregisteredLocalMedia: (media, assetId, owner) =>
        removeDownloadedVideoAssetIfUnreferenced({
          media,
          assetId,
          owner,
          deleteAsset: deleteLocalVideoFile,
          getInMemoryMediaItem: (id) =>
            reduxStore
              .getState()
              .media.list.find((item) => item.localVideoFile?.id === id),
          isOwnerCurrent,
        }),
      removeUnregisteredCloudMedia: (result, owner) =>
        removeDownloadedVideoMuxAssetIfUnreferenced({
          result,
          owner,
          getInMemoryMediaItems: () => reduxStore.getState().media.list,
          isOwnerCurrent,
        }),
      uploadToCloud: uploadDownloadedVideoToMux,
      buildCloudPatch: buildLocalVideoCloudSharePatch,
      viewMedia: (media, owner) => {
        dispatch(setRequestOpenMediaPanel(true));
        dispatch(setIsMediaExpanded(true));
        dispatch(setFocusMediaId(media.id));
        navigateRef.current(owner.routePath || "/controller");
      },
      notifyCloudStorageChanged: () =>
        window.dispatchEvent(new Event(MEDIA_STORAGE_CHANGED_EVENT)),
      transfer,
    });
  }

  const manager = managerRef.current;
  useEffect(() => manager?.attachProgressListener(), [manager]);
  useEffect(() => {
    manager?.handleChurchChange(churchId);
  }, [churchId, manager]);

  // Recovery belongs above routes, alongside download Activity. The Redux list
  // signals successful initialization and replication; the captured PouchDB
  // library remains authoritative for checkpoint discovery.
  useEffect(() => {
    if (
      !window.electronAPI ||
      mediaLoadStatus !== "ready" ||
      !globalDb ||
      !churchId ||
      globalFireDbInfo.churchId !== churchId
    )
      return;
    const dbAtStart = globalDb;
    const owner: DesktopVideoDownloadOwner = {
      churchId,
      workspaceId: churchId,
      controllerProfileId: "",
      folderId: null,
      routePath: "/controller",
      dbAtStart,
    };
    const isOwnerCurrent = () =>
      mountedRef.current &&
      churchIdRef.current === churchId &&
      globalDb === dbAtStart &&
      globalFireDbInfo.churchId === churchId;
    let scan = recoveryScans.current.get(dbAtStart);
    if (!scan || scan.churchId !== churchId) {
      scan = { churchId, inFlight: false, rerun: false };
      recoveryScans.current.set(dbAtStart, scan);
    }
    if (scan.inFlight) {
      scan.rerun = true;
      return;
    }
    scan.inFlight = true;

    const discover = async () => {
      try {
        do {
          scan!.rerun = false;
          try {
            const { list } = await loadMediaLibrary(
              dbAtStart as PouchDB.Database,
            );
            if (!isOwnerCurrent()) return;
            const pendingMediaIds = new Set(
              list
                .filter((media) => media.pendingLinkedVideoCleanup?.length)
                .map((media) => media.id),
            );
            for (const recovered of recoveredCleanup.current.values()) {
              if (
                recovered.db !== dbAtStart ||
                recovered.churchId !== churchId ||
                pendingMediaIds.has(recovered.mediaId)
              )
                continue;
              transfer.removeTransfer(
                `media-relink-cleanup-${churchId}:${recovered.mediaId}`,
              );
              recoveredCleanup.current.delete(
                JSON.stringify([churchId, recovered.mediaId]),
              );
            }

            for (const media of list) {
              const checkpoints = media.pendingLinkedVideoCleanup;
              if (!checkpoints?.length || !isOwnerCurrent()) continue;
              const recoveryKey = JSON.stringify([churchId, media.id]);
              const checkpoint = JSON.stringify(checkpoints);
              const recovered = recoveredCleanup.current.get(recoveryKey);
              if (
                recovered?.db === dbAtStart &&
                recovered.checkpoint === checkpoint
              )
                continue;

              const native = window.electronAPI;
              if (!native) return;
              const reconciled = await Promise.all(
                checkpoints.map(async (entry) => {
                  if (!entry.linkedAssetId || !entry.localAssetId) {
                    return {
                      entry,
                      error: new Error(
                        "The saved relink checkpoint is incomplete. Its files were kept.",
                      ),
                    };
                  }
                  try {
                    return {
                      entry,
                      status: await native.getLocalVideoRelinkStatus(
                        entry.linkedAssetId,
                        entry.localAssetId,
                      ),
                    };
                  } catch {
                    return {
                      entry,
                      error: new Error(
                        "The native relink state could not be checked. Its recovery checkpoint was kept.",
                      ),
                    };
                  }
                }),
              );
              if (!isOwnerCurrent()) return;

              const latest = await readMediaItemForDeletion(
                dbAtStart as PouchDB.Database,
                media.id,
              );
              if (!isOwnerCurrent()) return;
              if (
                !latest ||
                JSON.stringify(latest.item.pendingLinkedVideoCleanup ?? []) !==
                  checkpoint
              ) {
                scan!.rerun = true;
                continue;
              }

              let error: Error | undefined;
              for (const observation of reconciled) {
                if ("error" in observation) {
                  error ??= observation.error;
                  continue;
                }
                const { entry, status } = observation;
                if (
                  status.asset &&
                  status.asset.workspaceId !== owner.workspaceId
                ) {
                  error ??= new Error(
                    "This relink checkpoint belongs to a different church. Its files were kept.",
                  );
                  continue;
                }
                const isCurrentReplacement =
                  !entry.rolledBack &&
                  latest.item.localVideoFile?.id === entry.linkedAssetId &&
                  latest.item.localVideoFile?.contentHash === entry.contentHash;
                if (entry.rolledBack && status.status === "committed") {
                  error ??= new Error(
                    "Native adoption conflicts with the saved rollback. Its files were kept for review.",
                  );
                } else if (
                  isCurrentReplacement &&
                  status.status === "missing"
                ) {
                  error ??= new Error(
                    "The native linked video is missing. Reconnect its drive or relink it before cleanup.",
                  );
                } else if (
                  isCurrentReplacement &&
                  status.status === "superseded"
                ) {
                  error ??= new Error(
                    "The native linked video changed during recovery. Its files were kept.",
                  );
                }
              }

              const getItems = () => reduxStore.getState().media.list;
              registerLinkedVideoReplacementRecovery({
                item: latest.item,
                owner,
                isOwnerCurrent,
                getItems,
                dispatch,
                transfer,
                error,
              });
              recoveredCleanup.current.set(recoveryKey, {
                churchId,
                mediaId: media.id,
                db: dbAtStart,
                checkpoint,
              });
            }
          } catch (error) {
            if (isOwnerCurrent())
              console.error("Failed to discover linked video recovery:", error);
          }
        } while (scan!.rerun && isOwnerCurrent());
      } finally {
        scan!.inFlight = false;
      }
    };

    void discover();
  }, [
    churchId,
    dispatch,
    mediaLoadStatus,
    recoveryCheckpointSignature,
    reduxStore,
    transfer,
  ]);

  const start = useCallback(
    (input: DesktopVideoDownloadInput) => {
      if (!manager)
        throw new Error("Video downloads are available in the desktop app.");
      return manager.start(input);
    },
    [manager],
  );

  return (
    <DesktopVideoDownloadContext.Provider value={{ start }}>
      {children}
    </DesktopVideoDownloadContext.Provider>
  );
};

export default DesktopVideoDownloadManager;
