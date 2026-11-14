import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import {
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Maximize,
  MonitorSmartphone,
  X,
} from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useDispatch } from "../../hooks";
import MediaUploadInput from "./MediaUploadInput";
import { useStore } from "react-redux";
import { useOptionalTransferActions } from "../../context/transferContext";
import { globalDb } from "../../context/controllerInfo";
import { globalFireDbInfo } from "../../context/globalInfo";
import { readMediaItemForDeletion } from "../../utils/mediaDocUtils";
import type { RootState } from "../../store/store";
import type { DesktopVideoDownloadOwner } from "../../components/DesktopVideoDownloadManager/desktopVideoDownloadController";
import { cleanupLinkedVideoReplacement, discardUnadoptedLinkedVideo, finalizeLinkedVideoReplacement, linkedVideoRecoveryPatch, persistLinkedVideoReplacement, restoreUncommittedLinkedVideo, registerLinkedVideoReplacementRecovery } from "./relinkLocalVideo";
import { setIsMediaExpanded } from "../../store/preferencesSlice";
import {
  MEDIA_LIBRARY_ROOT_VIEW,
  moveMediaToFolder,
} from "../../utils/mediaFolderMutations";
import {
  MediaLibraryFolderModals,
  MediaLibraryNewFolderForm,
  MediaLibraryRenameFolderForm,
  MediaLibraryRenameMediaForm,
} from "./MediaLibraryFolderModals";
import MediaLibraryActionBar from "./MediaLibraryActionBar";
import cn from "classnames";
import Toggle from "../../components/Toggle/Toggle";
import MediaOriginFilter from "./MediaOriginFilter";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import MediaModal from "./MediaModal";
import MediaProviderRetryModal from "./MediaProviderRetryModal";
import MediaLibraryGrid from "./MediaLibraryGrid";
import MediaLibraryMediaVisual from "./MediaLibraryMediaVisual";
import { useMediaLibraryController } from "./useMediaLibraryController";
import type { MediaFolder, MediaType } from "../../types";
import FloatingWindow, {
  FloatingWindowHandle,
} from "../../components/FloatingWindow/FloatingWindow";
import CanvaImportSheet from "./CanvaImportSheet";
import { getCanvaStatus } from "../../api/canva";
import { GlobalInfoContext } from "../../context/globalInfo";
import LocalVideoInputPicker, {
  type LocalVideoCaptureMode,
} from "../../components/LocalVideoInputPicker/LocalVideoInputPicker";
import {
  addItemToMediaList,
  updateMediaItemFields,
} from "../../store/mediaSlice";
import type { LocalVideoInputMediaSource } from "../../types";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import { LOCAL_IMAGE_CLOUD_CLEANUP_COMPLETE_EVENT } from "../../utils/localImageAssets";
import { supportsDesktopCapture } from "../../utils/desktopCapture";
import type { LocalVideoThumbnailFrame } from "../../utils/localVideoInputThumbnail";
import {
  useLocalVideoInputThumbnailPersistence,
  VideoInputMediaWriteOutcomeUnknownError,
} from "../../hooks/useLocalVideoInputThumbnailPersistence";
import { useNativeFileDrop } from "./useNativeFileDrop";
import { MediaAddControl } from "./MediaAddControl";
import { MediaSourceAddMenu } from "./MediaSourceAddMenu";
import DownloadVideoDialog from "./DownloadVideoDialog";
import { useActiveControllerProfile } from "../../context/activeController";
import { useLocation } from "react-router-dom";
import { MEDIA_STORAGE_CHANGED_EVENT } from "./mediaStorageEvents";
import { createLocalMediaFromLinkedVideo } from "./localMediaImport";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";
import { useToast } from "../../context/toastContext";
import { claimMediaUpload } from "../../utils/mediaOperationClaims";

const MEDIA_LIBRARY_FORM_POPOVER_CLASS =
  "w-72 border border-gray-600 bg-gray-900 p-3 text-white";

type MediaProps = {
  /** Stacked with TransmitHandler: collapsed bar at bottom; expanded fills column above hidden transmit. */
  variant?: "default" | "panel";
  pageMode?: "default" | "overlayController";
};

export const getMediaPanelClassName = ({
  isPanelVariant,
  isMediaExpanded,
}: {
  isPanelVariant: boolean;
  isMediaExpanded: boolean;
}) =>
  cn(
    isPanelVariant && "flex flex-col min-h-0 w-full overflow-hidden",
    isPanelVariant && (isMediaExpanded ? "flex-1" : "shrink-0 mt-auto"),
    !isPanelVariant && "contents",
  );

const Media = ({ variant = "default", pageMode = "default" }: MediaProps) => {
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const transfer = useOptionalTransferActions();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const { showToast } = useToast();
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const controllerProfile = useActiveControllerProfile();
  const { pathname } = useLocation();
  const [isCanvaImportOpen, setIsCanvaImportOpen] = useState(false);
  const [canvaSourceMedia, setCanvaSourceMedia] = useState<MediaType | null>(
    null,
  );
  const [canvaOauthConfigured, setCanvaOauthConfigured] = useState(false);
  const [isVideoInputOpen, setIsVideoInputOpen] = useState(false);
  const [isVideoDownloadOpen, setIsVideoDownloadOpen] = useState(false);
  const [isVideoDownloaderAvailable, setIsVideoDownloaderAvailable] = useState(false);
  const [isLinkingLocalVideo, setIsLinkingLocalVideo] = useState(false);
  const [videoInputToEdit, setVideoInputToEdit] = useState<MediaType>();
  const [videoInputMode, setVideoInputMode] =
    useState<LocalVideoCaptureMode>("device");
  const pendingInitialVideoRowsRef = useRef(new Map<string, MediaType>());
  const storageUsageRefreshRef = useRef<() => void>(() => undefined);
  const notifyStorageUsageChanged = useCallback(
    () => storageUsageRefreshRef.current(),
    [],
  );
  useEffect(() => {
    const handleCloudCleanupComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (detail?.workspaceId === churchId) notifyStorageUsageChanged();
    };
    window.addEventListener(LOCAL_IMAGE_CLOUD_CLEANUP_COMPLETE_EVENT, handleCloudCleanupComplete);
    return () => window.removeEventListener(
      LOCAL_IMAGE_CLOUD_CLEANUP_COMPLETE_EVENT,
      handleCloudCleanupComplete,
    );
  }, [churchId, notifyStorageUsageChanged]);
  const registerStorageUsageRefresh = useCallback((refresh: () => void) => {
    storageUsageRefreshRef.current = refresh;
  }, []);
  const openCanva = useCallback((sourceMedia?: MediaType) => {
    setCanvaSourceMedia(sourceMedia || null);
    setIsCanvaImportOpen(true);
  }, []);
  const relinkVideoInput = useCallback((media: MediaType) => {
    const captureKind = media.localVideoInput?.captureKind;
    setVideoInputMode(
      captureKind === "screen" || captureKind === "window"
        ? "desktop"
        : "device",
    );
    setVideoInputToEdit(media);
    setIsVideoInputOpen(true);
  }, []);
  const openVideoInputPicker = useCallback((mode: LocalVideoCaptureMode) => {
    setVideoInputMode(mode);
    setVideoInputToEdit(undefined);
    setIsVideoInputOpen(true);
  }, []);
  const c = useMediaLibraryController({
    variant,
    pageMode,
    onManageCanvaSource: canvaOauthConfigured ? openCanva : undefined,
    onRelinkVideoInput: relinkVideoInput,
    onStorageUsageChanged: notifyStorageUsageChanged,
  });
  const {
    showAll,
    navigateToFolder,
    getCurrentMediaList,
  } = c;

  const {
    persistVideoInputMediaPatch,
    removeOptimisticVideoInputMediaRow,
    saveVideoInputThumbnail,
    removeVideoInputThumbnail,
  } = useLocalVideoInputThumbnailPersistence(notifyStorageUsageChanged);
  const handleDroppedFiles = useCallback(
    (files: File[]) => c.mediaUploadInputRef.current?.openModalWithFiles(files),
    [c.mediaUploadInputRef],
  );
  const { isFileDragOver, fileDropHandlers } = useNativeFileDrop({
    disabled: c.isMediaReadOnly || !c.isMediaExpanded,
    onFiles: handleDroppedFiles,
  });

  useEffect(() => {
    if (!churchId) {
      setCanvaOauthConfigured(false);
      return;
    }
    let active = true;
    void getCanvaStatus(churchId)
      .then((status) => {
        if (active) setCanvaOauthConfigured(Boolean(status.oauthConfigured));
      })
      .catch((error: unknown) => {
        if (active) {
          console.warn("Could not load Canva status.", error);
          setCanvaOauthConfigured(false);
        }
      });
    return () => {
      active = false;
    };
  }, [churchId]);

  useEffect(() => {
    let active = true;
    const checkAvailability = window.electronAPI?.isVideoDownloaderAvailable;
    if (!checkAvailability) return;
    void checkAvailability().then((available) => {
      if (active) setIsVideoDownloaderAvailable(available);
    }).catch(() => {
      if (active) setIsVideoDownloaderAvailable(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onStorageChanged = () => notifyStorageUsageChanged();
    window.addEventListener(MEDIA_STORAGE_CHANGED_EVENT, onStorageChanged);
    return () => window.removeEventListener(MEDIA_STORAGE_CHANGED_EVENT, onStorageChanged);
  }, [notifyStorageUsageChanged]);

  const selectedCount = c.selectedMediaIds.size;
  const mediaRenameWindowRef = useRef<FloatingWindowHandle>(null);
  const [mediaRenamePosition, setMediaRenamePosition] = useState({
    x: Math.max(window.innerWidth - 340, 0),
    y: 80,
  });

  const handleNewFolderCreated = useCallback(
    (nf: MediaFolder) => {
      if (!showAll) return;
      navigateToFolder(nf.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
    },
    [showAll, navigateToFolder],
  );

  const handleMediaRenameOpenChange = useCallback(
    (open: boolean) => {
      if (open && c.mediaRenameOpen) {
        mediaRenameWindowRef.current?.restore();
        return;
      }
      if (open) {
        const trigger = document.activeElement;
        if (trigger instanceof HTMLElement) {
          const rect = trigger.getBoundingClientRect();
          setMediaRenamePosition({
            x: Math.min(
              Math.max(rect.left, 8),
              Math.max(window.innerWidth - 340, 0),
            ),
            y: Math.min(rect.bottom + 8, Math.max(window.innerHeight - 240, 8)),
          });
        }
      }
      c.handleActionBarMediaRenameOpenChange(open);
    },
    [c],
  );

  const addLocalMedia = useCallback(
    (media: MediaType) => {
      const existing = c.list.find((item) => item.id === media.id);
      if (existing) {
        dispatch(updateMediaItemFields({ id: existing.id, patch: media }));
        return;
      }
      dispatch(
        addItemToMediaList({
          ...media,
          // Match cloud/Mux imports: land in the folder currently being browsed.
          folderId: media.folderId ?? c.uploadTargetFolderId,
        }),
      );
    },
    [c.list, c.uploadTargetFolderId, dispatch],
  );

  const addVideoInput = useCallback(
    async (
      source: LocalVideoInputMediaSource,
      initialThumbnail?: LocalVideoThumbnailFrame,
    ) => {
      const ownedSource: LocalVideoInputMediaSource = {
        ...source,
        ownerDeviceId: getOrCreateDeviceId(),
        ownerLabel: getTrustedDeviceLabel(),
      };
      const now = new Date().toISOString();
      const id = `local_input_${ownedSource.sourceId}`;
      const existing = getCurrentMediaList().find((item) => item.id === id);
      const pendingInitialRow = pendingInitialVideoRowsRef.current.get(id);
      let optimisticRow: MediaType | undefined;
      if (!existing) {
        optimisticRow = {
          path: "",
          createdAt: now,
          updatedAt: now,
          format: "live",
          height: 1080,
          width: 1920,
          name: ownedSource.label,
          publicId: id,
          type: "video",
          id,
          background: `local-video-input://${encodeURIComponent(ownedSource.sourceId)}`,
          thumbnail: "",
          placeholderImage: "",
          source: "local",
          localVideoInput: ownedSource,
          folderId: c.uploadTargetFolderId,
        };
        dispatch(
          addItemToMediaList(optimisticRow),
        );
      }
      const rowToRetainOrRollback = optimisticRow ?? pendingInitialRow;
      const allowCreate = !existing || Boolean(pendingInitialRow);
      try {
        const mediaPatch = {
          name: ownedSource.label,
          updatedAt: now,
          localVideoInput: ownedSource,
        };
        if (initialThumbnail) {
          await saveVideoInputThumbnail(id, initialThumbnail, {
            mediaPatch,
            allowCreate,
          });
        } else {
          await persistVideoInputMediaPatch(
            id,
            ownedSource.sourceId,
            mediaPatch,
            allowCreate,
          );
        }
        pendingInitialVideoRowsRef.current.delete(id);
      } catch (error) {
        if (!existing || pendingInitialRow) {
          if (
            error instanceof VideoInputMediaWriteOutcomeUnknownError &&
            rowToRetainOrRollback
          ) {
            pendingInitialVideoRowsRef.current.set(id, rowToRetainOrRollback);
          } else {
            if (rowToRetainOrRollback) {
              removeOptimisticVideoInputMediaRow(id, rowToRetainOrRollback);
            }
            pendingInitialVideoRowsRef.current.delete(id);
          }
        }
        throw error;
      }
    },
    [
      c.uploadTargetFolderId,
      dispatch,
      getCurrentMediaList,
      persistVideoInputMediaPatch,
      removeOptimisticVideoInputMediaRow,
      saveVideoInputThumbnail,
    ],
  );

  const linkLocalVideo = useCallback(async () => {
    const api = window.electronAPI;
    if (c.isMediaReadOnly || !api?.linkLocalVideoFile) return;
    setIsLinkingLocalVideo(true);
    const dbAtStart = globalDb;
    const isOwnerCurrent = () => globalDb === dbAtStart && globalFireDbInfo.churchId === churchId;
    let assetId: string | undefined;
    try {
      const asset = await api.linkLocalVideoFile(churchId);
      if (!asset) return;
      assetId = asset.assetId;
      if (!isOwnerCurrent()) throw new Error("The active church changed before the video could be linked.");
      const media = await createLocalMediaFromLinkedVideo({
        asset,
        workspaceId: churchId,
        folderId: c.uploadTargetFolderId,
      });
      if (!isOwnerCurrent()) throw new Error("The active church changed before the video could be linked.");
      addLocalMedia(media);
      notifyStorageUsageChanged();
      showToast("Video linked to the Media Library.", "success");
    } catch (error) {
      if (assetId) await deleteLocalVideoFile(assetId).catch(() => undefined);
      if (isOwnerCurrent() && mountedRef.current) showToast(
        error instanceof Error ? error.message : "Could not link this video file.",
        "error",
      );
    } finally {
      if (mountedRef.current) setIsLinkingLocalVideo(false);
    }
  }, [addLocalMedia, churchId, c.isMediaReadOnly, c.uploadTargetFolderId, notifyStorageUsageChanged, showToast]);

  const relinkLocalVideoFile = useCallback(async (media: MediaType) => {
    const api = window.electronAPI;
    const reference = media.localVideoFile;
    if (
      c.isMediaReadOnly || !api?.relinkLocalVideoFile ||
      !reference || reference.storageMode !== "linked"
    ) return;
    const claim = claimMediaUpload(media.id);
    if (!claim) {
      showToast("Wait for the current video upload to finish before relinking this file.", "error");
      return;
    }
    setIsLinkingLocalVideo(true);
    const owner: DesktopVideoDownloadOwner = {
      churchId, workspaceId: churchId, controllerProfileId: "", folderId: media.folderId ?? null,
      routePath: pathname, dbAtStart: globalDb,
    };
    const isOwnerCurrent = () => globalDb === owner.dbAtStart && globalFireDbInfo.churchId === owner.churchId;
    const isCurrent = () => claim.isCurrent() && isOwnerCurrent();
    const getItems = () => reduxStore.getState().media.list;
    const publishAdopted = (saved: MediaType) => {
      const patch = linkedVideoRecoveryPatch(saved, getItems().find((item) => item.id === media.id));
      if (patch && isOwnerCurrent()) dispatch(updateMediaItemFields({ id: media.id, patch }));
    };
    let candidate: Awaited<ReturnType<typeof api.relinkLocalVideoFile>>;
    let savedReplacement: Awaited<ReturnType<typeof persistLinkedVideoReplacement>> | undefined;
    let persistenceStarted = false;
    try {
      const persisted = owner.dbAtStart
        ? await readMediaItemForDeletion(owner.dbAtStart as PouchDB.Database, media.id) : null;
      const pending = persisted?.item.pendingLinkedVideoCleanup?.findLast((entry) =>
        !entry.rolledBack && entry.contentHash === persisted.item.localVideoFile?.contentHash);
      if (pending) {
        const status = await api.getLocalVideoRelinkStatus(reference.id, pending.localAssetId);
        if (status.status !== "committed") {
          registerLinkedVideoReplacementRecovery({ item: persisted!.item, owner, isOwnerCurrent, getItems, dispatch,
            transfer: transfer ?? undefined, error: new Error("Finish the previous relink before selecting another file.") });
          throw new Error("Finish the previous relink using Retry relink in Activity, then choose another file.");
        }
      }
      if (!isCurrent()) throw new Error("The active church or video changed. Try relinking again.");
      candidate = await api.relinkLocalVideoFile(reference.id);
      if (!candidate) return;
      if (candidate.workspaceId !== churchId) throw new Error("This local video belongs to a different church. Its source was kept.");
      if (candidate.assetId === reference.id) throw new Error("Restart WorshipSync before relinking this video.");
      if (!isCurrent()) throw new Error("The active church or video changed. Try relinking again.");
      const linked = await createLocalMediaFromLinkedVideo({
        asset: candidate, workspaceId: churchId, displayName: media.name, folderId: media.folderId, validateOnly: true,
      });
      // Recheck identity after Chromium has decoded the candidate. Do not adopt
      // a source moved or modified while metadata validation was in progress.
      const available = await api.getLocalAsset(candidate.assetId);
      if (!available || available.contentHash !== candidate.contentHash || !isCurrent()) {
        throw new Error("The selected file or active church changed while the video was being checked.");
      }
      persistenceStarted = true;
      const saved = await persistLinkedVideoReplacement({ original: media, linked, candidateAssetId: candidate.assetId, previousContentHash: candidate.previousContentHash, owner, isOwnerCurrent: isCurrent });
      savedReplacement = saved;
      await finalizeLinkedVideoReplacement(saved.item, isCurrent, owner.workspaceId);
      if (isCurrent()) {
        const current = getItems().find((item) => item.id === media.id);
        dispatch(updateMediaItemFields({ id: media.id, patch: {
          ...saved.patch,
          localVideoFile: { ...saved.patch.localVideoFile!, audioEnabled: current?.localVideoFile?.audioEnabled },
          pendingLinkedVideoCleanup: saved.item.pendingLinkedVideoCleanup,
        } }));
      }
      const onRetired = (retired: NonNullable<MediaType["pendingLinkedVideoCleanup"]>[number]) => {
        const current = getItems().find((item) => item.id === media.id);
        dispatch(updateMediaItemFields({ id: media.id, patch: {
          pendingLinkedVideoCleanup: current?.pendingLinkedVideoCleanup?.filter((entry) => JSON.stringify(entry) !== JSON.stringify(retired)),
        } }));
      };
      const cleanup = () => cleanupLinkedVideoReplacement(media.id, owner, isCurrent, getItems, onRetired, publishAdopted);
      try { await cleanup(); }
      catch (error) {
        registerLinkedVideoReplacementRecovery({ item: saved.item, owner, isOwnerCurrent, getItems, dispatch, transfer: transfer ?? undefined, error });
      }
      if (isOwnerCurrent() && mountedRef.current) {
        notifyStorageUsageChanged();
        showToast(saved.changed ? "File relinked. Upload it again to restore its cloud copy." : "File relinked.", "success");
      }
    } catch (error) {
      if (candidate && savedReplacement) {
        await restoreUncommittedLinkedVideo(media, savedReplacement.patch, candidate.assetId, owner, isOwnerCurrent, candidate.previousContentHash).catch(() => undefined);
      }
      if (candidate && persistenceStarted) {
        let pending = true;
        try {
          const persisted = await readMediaItemForDeletion(owner.dbAtStart as PouchDB.Database, media.id);
          pending = Boolean(persisted?.item.pendingLinkedVideoCleanup?.some((entry) => entry.localAssetId === candidate!.assetId));
        } catch { /* An unreadable commit needs recovery, never speculative rollback. */ }
        if (pending) registerLinkedVideoReplacementRecovery({ item: media, owner, isOwnerCurrent, getItems, dispatch,
          transfer: transfer ?? undefined, error });
      }
      if (candidate && candidate.assetId !== reference.id) {
        // A rejected acknowledgement may already have adopted the candidate.
        // Preserve it whenever the authoritative reference cannot be checked.
        await discardUnadoptedLinkedVideo(candidate, owner, isOwnerCurrent, getItems).catch(() => undefined);
      }
      if (isOwnerCurrent() && mountedRef.current) showToast(
        error instanceof Error ? error.message : "Could not relink this video file.", "error",
      );
    } finally {
      claim.release();
      if (mountedRef.current) setIsLinkingLocalVideo(false);
    }
  }, [churchId, c.isMediaReadOnly, dispatch, notifyStorageUsageChanged, pathname, reduxStore, showToast, transfer]);

  return (
    <ErrorBoundary>
      <div
        className={getMediaPanelClassName({
          isPanelVariant: c.isPanelVariant,
          isMediaExpanded: c.isMediaExpanded,
        })}
      >
        <div
          className={cn(
            "@container/sources-actions mx-2 flex items-center border-b border-gray-500 bg-black/60 text-sm relative z-10 transition-all px-2",
            c.isMediaExpanded ? "py-1 rounded-t-md" : "rounded-b-md py-0.5",
            "rounded-t-md mt-2",
          )}
        >
          <h2 className="min-w-0 flex-1 font-semibold">Sources</h2>
          <div className="flex shrink-0 items-center">
            <Button
              variant="tertiary"
              svg={c.isMediaExpanded ? ChevronDown : ChevronUp}
              title={c.isMediaExpanded ? "Collapse Sources" : "Expand Sources"}
              aria-label={
                c.isMediaExpanded ? "Collapse Sources" : "Expand Sources"
              }
              onClick={() => {
                dispatch(setIsMediaExpanded(!c.isMediaExpanded));
                if (c.isMediaExpanded) {
                  c.setSearchTerm("");
                }
              }}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <MediaAddControl>
              <MediaSourceAddMenu
                onAddMedia={() => void c.requestMediaUpload()}
                onAddVideoInput={() => openVideoInputPicker("device")}
                onAddScreenShare={supportsDesktopCapture() ? () => openVideoInputPicker("desktop") : undefined}
                onImportFromCanva={canvaOauthConfigured ? openCanva : undefined}
                onDownloadVideo={isVideoDownloaderAvailable ? () => setIsVideoDownloadOpen(true) : undefined}
                onLinkVideo={window.electronAPI?.linkLocalVideoFile ? () => void linkLocalVideo() : undefined}
                mediaUploadDisabled={c.isMediaReadOnly || isLinkingLocalVideo}
                isGuestSession={c.isGuestSession}
              />
            </MediaAddControl>
            <Button
              variant="tertiary"
              svg={Maximize}
              onClick={() => c.setIsFullscreen(true)}
              title="Fullscreen"
              disabled={c.isMediaReadOnly}
            />
          </div>
        </div>
        <MediaUploadInput
          ref={c.mediaUploadInputRef}
          onLocalMediaAdded={addLocalMedia}
          onLocalMediaPatched={(id, patch) =>
            dispatch(updateMediaItemFields({ id, patch }))
          }
          showButton={false}
          uploadPreset="bpqu4ma5"
          onUploadComplete={notifyStorageUsageChanged}
          uploadDisabled={c.isMediaReadOnly}
        />
        {isVideoDownloaderAvailable ? (
          <DownloadVideoDialog
            open={isVideoDownloadOpen}
            onOpenChange={setIsVideoDownloadOpen}
            disabled={c.isMediaReadOnly}
            isGuestSession={c.isGuestSession}
            controllerProfileId={controllerProfile.id}
            folderId={c.uploadTargetFolderId}
            routePath={pathname}
          />
        ) : null}
        {isVideoInputOpen ? (
          <LocalVideoInputPicker
            hideTrigger
            open
            captureMode={videoInputMode}
            source={videoInputToEdit?.localVideoInput}
            hasThumbnail={Boolean(
              videoInputToEdit?.localImage || videoInputToEdit?.thumbnail,
            )}
            onOpenChange={(open) => {
              setIsVideoInputOpen(open);
              if (!open) setVideoInputToEdit(undefined);
            }}
            onLinked={addVideoInput}
            onSaveThumbnail={
              videoInputToEdit
                ? (frame) =>
                    saveVideoInputThumbnail(videoInputToEdit.id, frame)
                : undefined
            }
            onRemoveThumbnail={
              videoInputToEdit
                ? () => removeVideoInputThumbnail(videoInputToEdit.id)
                : undefined
            }
          />
        ) : null}
        {!c.isMediaReadOnly && c.isMediaExpanded && (
          <>
            <div className="w-full min-w-0">
              <div className="mx-2 flex flex-wrap items-center gap-2 border-b border-gray-500 bg-black/60 px-4 py-2">
                <Input
                  type="text"
                  label="Search"
                  hideLabel
                  value={c.searchTerm}
                  onChange={(value) => c.setSearchTerm(String(value))}
                  placeholder="Search..."
                  aria-label="Search"
                  className="flex min-w-48 flex-1 gap-4 items-center"
                  inputWidth="w-full"
                  inputTextSize="text-sm"
                  svg={c.searchTerm ? X : undefined}
                  svgAction={() => c.setSearchTerm("")}
                  svgActionAriaLabel="Clear search"
                />
                <Toggle
                  label="Show all"
                  icon={LayoutGrid}
                  value={c.showAll}
                  onChange={c.handleShowAllChange}
                />
                <MediaOriginFilter
                  value={c.originFilter}
                  onChange={c.setOriginFilter}
                  className="w-40 shrink-0"
                />
                {c.showOtherDeviceLocalMediaToggle ? (
                  <Toggle
                    label="Other devices"
                    icon={MonitorSmartphone}
                    value={c.showOtherDeviceLocalMedia}
                    onChange={c.setShowOtherDeviceLocalMedia}
                  />
                ) : null}
              </div>
              <div className="w-full">
                <MediaLibraryActionBar
                  detailsRow={c.actionBarDetails}
                  showFolderActions={selectedCount === 0}
                  showNewFolderAction={selectedCount > 0}
                  folderNew={{
                    open: c.newFolderOpen,
                    onOpenChange: c.setNewFolderOpen,
                    content: (
                      <MediaLibraryNewFolderForm
                        folders={c.folders}
                        list={c.list}
                        parentForNewFolder={c.parentForNewFolder}
                        onUpdateFoldersAndList={c.applyFoldersAndList}
                        onFolderCreated={handleNewFolderCreated}
                        onClose={() => c.setNewFolderOpen(false)}
                      />
                    ),
                    contentClassName: MEDIA_LIBRARY_FORM_POPOVER_CLASS,
                  }}
                  folderRename={
                    c.selectedRealFolder
                      ? {
                          open: c.folderRenameOpen,
                          onOpenChange: c.setFolderRenameOpen,
                          content: (
                            <MediaLibraryRenameFolderForm
                              folders={c.folders}
                              list={c.list}
                              folder={c.selectedRealFolder}
                              onUpdateFoldersAndList={c.applyFoldersAndList}
                              onClose={() => c.setFolderRenameOpen(false)}
                            />
                          ),
                          contentClassName: MEDIA_LIBRARY_FORM_POPOVER_CLASS,
                        }
                      : null
                  }
                  onDeleteFolder={c.handleRequestFolderDelete}
                  showFolderRenameDelete={Boolean(c.selectedRealFolder)}
                  showMediaRename={selectedCount === 1}
                  mediaRenameOpen={c.mediaRenameOpen}
                  onMediaRenameOpenChange={handleMediaRenameOpenChange}
                  renameMediaContent={null}
                  mediaActions={selectedCount > 0 ? c.mediaBarActions : []}
                  slideBackgroundFeedbackId={c.slideBackgroundFeedbackId}
                  showMoveSelect={selectedCount > 0}
                  moveSelectOptions={c.moveSelectOptions}
                  onMoveTo={c.handleMoveTo}
                  moveSelectResetKey={c.moveSelectKey}
                  moveToNewFolderOpen={c.moveToNewFolderOpen}
                  onMoveToNewFolderOpenChange={
                    c.handleActionBarMoveToNewFolderOpenChange
                  }
                  showMultiSelectDone={c.mediaMultiSelectMode}
                  onMultiSelectDone={c.clearSelection}
                  moveToNewFolderContent={
                    selectedCount > 0 ? (
                      <MediaLibraryNewFolderForm
                        folders={c.folders}
                        list={c.list}
                        parentForNewFolder={c.parentForNewFolder}
                        onUpdateFoldersAndList={c.applyFoldersAndList}
                        onFolderCreated={handleNewFolderCreated}
                        adjustListAfterCreate={(nf, _nextFolders, listBefore) =>
                          moveMediaToFolder(
                            c.selectedMediaIds,
                            nf.id,
                            listBefore,
                          )
                        }
                        onClose={() => {
                          c.closeMoveToNewFolderPopover();
                          c.setMoveSelectKey((k: number) => k + 1);
                          c.clearSelection();
                        }}
                      />
                    ) : null
                  }
                />
              </div>
            </div>
            <MediaLibraryFolderModals
              selectedLibraryFilter={c.selectedLibraryFilter}
              folders={c.folders}
              list={c.list}
              onUpdateFoldersAndList={c.applyFoldersAndList}
              onDeleteFolderSubtree={c.handleDeleteFolderSubtree}
              onDeleteFolderKeepContents={c.handleDeleteFolderKeepContents}
              folderDeleteOpen={c.folderDeleteOpen}
              onFolderDeleteOpenChange={c.setFolderDeleteOpen}
            />
          </>
        )}
        <MediaLibraryGrid
          isPanelVariant={c.isPanelVariant}
          isMediaExpanded={c.isMediaExpanded}
          isMediaLoading={c.isMediaLoading}
          hasMediaLoadError={c.hasMediaLoadError}
          mediaItemsPerRow={c.mediaItemsPerRow}
          mediaListRef={c.mediaListRef}
          mediaGridRef={c.mediaGridRef}
          filteredList={c.filteredList}
          showAll={c.showAll}
          showNamesInPanelGrid={c.showNamesInPanelGrid}
          searchTerm={c.searchTerm}
          childFolders={c.childFolders}
          canGoUp={c.canGoUp}
          currentFolderName={c.selectedRealFolder?.name}
          onGoUp={c.handleGoUp}
          onOpenFolder={c.navigateToFolder}
          selectedMedia={c.selectedMedia}
          selectedMediaIds={c.selectedMediaIds}
          mediaMultiSelectMode={c.mediaMultiSelectMode}
          onMediaTileClick={c.handleMediaClick}
          onEnterMediaMultiSelectMode={c.enterMediaMultiSelectMode}
          mediaDragEnabled={c.canDragMediaToSlides}
          orderedSelectedMediaIds={c.orderedSelectedMediaIds}
          nativeFileDropHandlers={fileDropHandlers}
          isFileDragOver={isFileDragOver}
        />

        <DeleteModal
          isOpen={c.showDeleteModal}
          onClose={c.handleCancelDelete}
          onConfirm={c.handleConfirmDelete}
          isConfirming={c.isDeleteInProgress}
          itemName={c.isDeletingMultiple ? undefined : c.mediaToDelete?.name}
          title="Delete Media"
          message={
            c.isDeletingMultiple
              ? `Are you sure you want to delete ${selectedCount} items`
              : "Are you sure you want to delete"
          }
          imagePreview={
            !c.isDeletingMultiple && c.showDeleteModal && c.mediaToDelete ? (
              <MediaLibraryMediaVisual
                mediaItem={c.mediaToDelete}
                imageAlt={c.mediaToDelete.name}
                imageClassName="w-full h-full object-cover"
              />
            ) : undefined
          }
        />

        <MediaProviderRetryModal
          isOpen={c.showProviderRetryModal}
          failedCount={c.providerRetryRows.length}
          isRetrying={c.providerRetryBusy}
          onRetry={c.handleProviderRetry}
          onDismiss={c.handleDismissProviderRetry}
        />

        <MediaModal
          isOpen={c.isFullscreen}
          onClose={() => c.setIsFullscreen(false)}
          mediaList={c.filteredList}
          routeKey={c.routeKey}
          pageMode={c.pageMode}
          selectedLibraryFilter={c.selectedLibraryFilter}
          onSelectLibraryFilter={c.navigateToFolder}
          folders={c.folders}
          fullList={c.list}
          onUpdateFoldersAndList={c.applyFoldersAndList}
          onDeleteFolderKeepContents={c.handleDeleteFolderKeepContents}
          onDeleteFolderSubtree={c.handleDeleteFolderSubtree}
          selectedMedia={c.selectedMedia}
          selectedMediaIds={c.selectedMediaIds}
          previewMedia={c.previewMedia}
          searchTerm={c.searchTerm}
          showName={c.showName}
          typeFilter={c.typeFilter}
          onTypeFilterChange={c.setTypeFilter}
          originFilter={c.originFilter}
          onOriginFilterChange={c.setOriginFilter}
          showOtherDeviceLocalMedia={c.showOtherDeviceLocalMedia}
          onShowOtherDeviceLocalMediaChange={c.setShowOtherDeviceLocalMedia}
          showOtherDeviceLocalMediaToggle={c.showOtherDeviceLocalMediaToggle}
          onMediaClick={c.handleMediaClick}
          onSearchChange={(value) => c.setSearchTerm(value)}
          onShowNameToggle={() => c.setShowName(!c.showName)}
          onDeleteClick={c.openSingleDeleteModal}
          onDeleteMultipleClick={c.openMultiDeleteModal}
          onPreviewChange={c.setPreviewMedia}
          mediaUploadInputRef={c.mediaUploadInputRef}
          onAddMediaClick={c.requestMediaUpload}
          onAddVideoInput={() => openVideoInputPicker("device")}
          onAddScreenShare={
            supportsDesktopCapture()
              ? () => openVideoInputPicker("desktop")
              : undefined
          }
          onRelinkVideoInput={relinkVideoInput}
          onRelinkLocalVideoFile={relinkLocalVideoFile}
          onLinkVideo={window.electronAPI?.linkLocalVideoFile ? () => void linkLocalVideo() : undefined}
          onImportFromCanva={canvaOauthConfigured ? openCanva : undefined}
          mediaUploadDisabled={c.isMediaReadOnly || isLinkingLocalVideo}
          isGuestSession={c.isGuestSession}
          onStorageUsageRefreshReady={registerStorageUsageRefresh}
          onStorageUsageChanged={notifyStorageUsageChanged}
        />
        {canvaOauthConfigured ? (
          <CanvaImportSheet
            open={isCanvaImportOpen}
            onOpenChange={(open) => {
              setIsCanvaImportOpen(open);
              if (!open) setCanvaSourceMedia(null);
            }}
            onImageComplete={(info) => {
              return c.addCanvaImage(info).then((media) => {
                notifyStorageUsageChanged();
                return media;
              });
            }}
            onVideoComplete={(info) => {
              return c.addCanvaVideo(info).then((media) => {
                notifyStorageUsageChanged();
                return media;
              });
            }}
            onImageRefresh={async (...args) => {
              const refreshed = await c.refreshCanvaImage(...args);
              notifyStorageUsageChanged();
              return refreshed;
            }}
            onVideoRefresh={async (...args) => {
              const refreshed = await c.refreshCanvaVideo(...args);
              notifyStorageUsageChanged();
              return refreshed;
            }}
            onUnprocessedAssetCleanup={c.cleanupCanvaAsset}
            onCreateDeckItem={c.createCanvaDeckItemFromMedia}
            existingMedia={c.list}
            getCurrentMedia={c.getCurrentMediaList}
            sourceMedia={canvaSourceMedia}
          />
        ) : null}
        {selectedCount === 1 && c.mediaRenameOpen ? (
          <FloatingWindow
            ref={mediaRenameWindowRef}
            title="Rename media"
            onClose={c.closeMediaRenamePopover}
            defaultWidth={320}
            defaultHeight={220}
            defaultPosition={mediaRenamePosition}
            autoHeight
          >
            <MediaLibraryRenameMediaForm
              media={c.selectedMedia}
              onSave={c.handleRenameMediaSave}
              onClose={c.closeMediaRenamePopover}
            />
          </FloatingWindow>
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default Media;
