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
import { ControllerInfoContext } from "../../context/controllerInfo";
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
import { supportsDesktopCapture } from "../../utils/desktopCapture";
import {
  deleteLocalImage,
  deleteLocalImageUploadJob,
  getLocalImageUploadJob,
  getRememberedLocalImagePolicy,
  putLocalImageUploadJob,
  saveLocalImage,
  type LocalImageUploadJob,
  type StoredLocalImage,
} from "../../utils/localImageAssets";
import {
  cancelLocalImageUpload,
  enqueueLocalImageUpload,
} from "../../utils/localImageUploadQueue";
import { extractPublicId } from "../../utils/cloudinaryUtils";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";
import generateRandomId from "../../utils/generateRandomId";
import type { LocalVideoThumbnailFrame } from "../../utils/localVideoInputThumbnail";
import { useNativeFileDrop } from "./useNativeFileDrop";
import { MediaAddControl } from "./MediaAddControl";
import { MediaSourceAddMenu } from "./MediaSourceAddMenu";

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
  const { churchId = "" } = useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const [isCanvaImportOpen, setIsCanvaImportOpen] = useState(false);
  const [canvaSourceMedia, setCanvaSourceMedia] = useState<MediaType | null>(
    null,
  );
  const [canvaOauthConfigured, setCanvaOauthConfigured] = useState(false);
  const [isVideoInputOpen, setIsVideoInputOpen] = useState(false);
  const [videoInputToEdit, setVideoInputToEdit] = useState<MediaType>();
  const [videoInputMode, setVideoInputMode] =
    useState<LocalVideoCaptureMode>("device");
  const storageUsageRefreshRef = useRef<() => void>(() => undefined);
  const notifyStorageUsageChanged = useCallback(
    () => storageUsageRefreshRef.current(),
    [],
  );
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
    folders,
    isGuestSession,
  } = c;

  const writeVideoInputMedia = useCallback(
    async (current: MediaType, next: MediaType) => {
      if (!db) throw new Error("Media storage is unavailable. Try again.");
      const list = getCurrentMediaList();
      if (!list.some((item) => item.id === current.id)) {
        throw new Error("This video input is no longer in Media.");
      }
      const nextList = list.map((item) =>
        item.id === current.id ? next : item,
      );
      const result = await flushMediaLibraryDocToPouch(
        db,
        nextList,
        folders,
      );
      if (!result.ok) {
        throw new Error("The thumbnail change could not be saved to Media.");
      }
      dispatch(updateMediaItemFields({ id: next.id, patch: next }));
    },
    [folders, getCurrentMediaList, db, dispatch],
  );

  const createThumbnailCleanupJob = useCallback(
    async ({
      assetId,
      mediaId,
      workspaceId,
      cloudPublicId,
    }: {
      assetId: string;
      mediaId: string;
      workspaceId: string;
      cloudPublicId?: string;
    }) => {
      const previous = await getLocalImageUploadJob(assetId);
      const now = new Date().toISOString();
      const job: LocalImageUploadJob = {
        ...(previous ?? {}),
        id: assetId,
        assetId,
        itemId: "",
        workspaceId,
        uploadPreset: "bpqu4ma5",
        mediaId: previous?.mediaId || generateRandomId(),
        status: "failed",
        phase: "failed",
        progress: null,
        cancelRequested: false,
        attemptCount: 0,
        nextAttemptAt: 0,
        cleanupOnly: true,
        cleanupReady: false,
        cleanupTargetMediaId: mediaId,
        cleanupCloudPublicId: cloudPublicId,
        cleanupCloudComplete: !cloudPublicId,
        leaseOwnerId: undefined,
        leaseExpiresAt: undefined,
        providerUploadId: undefined,
        providerExpectedPublicId: undefined,
        cloudMedia: undefined,
        lastError: undefined,
        lastErrorCode: undefined,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      };
      await putLocalImageUploadJob(job);
      return { job, previous };
    },
    [],
  );

  const activateThumbnailCleanupJob = useCallback(
    async (job: LocalImageUploadJob) => {
      await putLocalImageUploadJob({
        ...job,
        status: "pending",
        phase: "queued",
        cleanupReady: true,
        nextAttemptAt: 0,
        updatedAt: new Date().toISOString(),
      });
    },
    [],
  );

  const saveVideoInputThumbnail = useCallback(
    async (mediaId: string, frame: LocalVideoThumbnailFrame) => {
      const current = getCurrentMediaList()
        .find((item) => item.id === mediaId);
      if (!current?.localVideoInput) {
        throw new Error("This video input is no longer in Media.");
      }
      const ownerDeviceId = getOrCreateDeviceId();
      const workspaceId = churchId || ownerDeviceId;
      const storagePolicy =
        churchId && !isGuestSession
          ? getRememberedLocalImagePolicy(ownerDeviceId)
          : "local-only";
      const now = new Date().toISOString();
      const assetId = generateRandomId();
      const contentType = frame.blob.type || "image/jpeg";
      const fileName = `${current.name || "Video input"}-thumbnail.${contentType === "image/webp" ? "webp" : "jpg"}`;
      const storedImage: StoredLocalImage = {
        id: assetId,
        workspaceId,
        blob: frame.blob,
        fileName,
        contentType,
        size: frame.blob.size,
        width: frame.width,
        height: frame.height,
        createdAt: now,
      };
      await saveLocalImage(storedImage);

      const previousCloudPublicId =
        current.localImage?.cloudPublicId ||
        (current.localImage?.cloudUrl
          ? extractPublicId(current.localImage.cloudUrl)
          : current.thumbnail
            ? extractPublicId(current.thumbnail)
            : undefined);
      const next: MediaType = {
        ...current,
        updatedAt: now,
        localImage: {
          id: assetId,
          ownerDeviceId,
          ownerLabel: getTrustedDeviceLabel(),
          fileName,
          contentType,
          storagePolicy,
          ...(previousCloudPublicId
            ? { cloudPublicId: previousCloudPublicId }
            : {}),
        },
      };

      try {
        await writeVideoInputMedia(current, next);
      } catch (error) {
        await deleteLocalImage(assetId).catch(() => undefined);
        throw error;
      }

      if (storagePolicy === "local-and-cloud") {
        try {
          await enqueueLocalImageUpload({
            assetId,
            itemId: "",
            workspaceId,
            uploadPreset: "bpqu4ma5",
            localVideoInputThumbnail: {
              targetMediaId: current.id,
              ...(current.localImage?.id
                ? { previousAssetId: current.localImage.id }
                : {}),
              ...(previousCloudPublicId ? { previousCloudPublicId } : {}),
            },
          });
          notifyStorageUsageChanged();
          return "Thumbnail saved here. Uploading its cloud copy.";
        } catch {
          const latest = getCurrentMediaList()
            .find((item) => item.id === current.id);
          if (latest?.localImage?.id === assetId) {
            const localOnly = {
              ...latest,
              localImage: {
                ...latest.localImage,
                storagePolicy: "local-only" as const,
              },
            };
            await writeVideoInputMedia(latest, localOnly).catch(() => undefined);
          }
          return "Thumbnail saved on this computer. Cloud upload could not be queued.";
        }
      }

      if (current.localImage?.id) {
        try {
          if (churchId && !isGuestSession) {
            const cleanup = await createThumbnailCleanupJob({
              assetId: current.localImage.id,
              mediaId: current.id,
              workspaceId,
            });
            await activateThumbnailCleanupJob(cleanup.job);
          } else {
            await deleteLocalImage(current.localImage.id);
          }
        } catch {
          // The media reference already points to the new saved image. Cleanup
          // failures remain visible in the durable local-image job store.
        }
      }
      return "Thumbnail saved on this computer.";
    },
    [
      activateThumbnailCleanupJob,
      getCurrentMediaList,
      isGuestSession,
      churchId,
      createThumbnailCleanupJob,
      notifyStorageUsageChanged,
      writeVideoInputMedia,
    ],
  );

  const removeVideoInputThumbnail = useCallback(
    async (mediaId: string) => {
      const current = getCurrentMediaList()
        .find((item) => item.id === mediaId);
      if (!current?.localVideoInput) {
        throw new Error("This video input is no longer in Media.");
      }
      if (!current.localImage) {
        if (current.thumbnail) {
          await writeVideoInputMedia(current, {
            ...current,
            thumbnail: "",
            updatedAt: new Date().toISOString(),
          });
        }
        return;
      }

      const pendingJob = await getLocalImageUploadJob(current.localImage.id);
      if (
        pendingJob &&
        pendingJob.status !== "complete" &&
        pendingJob.status !== "cancelled" &&
        !pendingJob.cleanupOnly
      ) {
        await cancelLocalImageUpload(current.localImage.id);
      }
      const latest = getCurrentMediaList()
        .find((item) => item.id === mediaId);
      if (!latest?.localImage) return;
      const latestJob = await getLocalImageUploadJob(latest.localImage.id);
      const workspaceId = churchId || getOrCreateDeviceId();
      const cleanupAssets = new Map<
        string,
        { cloudPublicId?: string; workspaceId: string }
      >();
      const addCleanup = (assetId?: string, cloudPublicId?: string) => {
        if (!assetId) return;
        const previous = cleanupAssets.get(assetId);
        cleanupAssets.set(assetId, {
          workspaceId,
          cloudPublicId: cloudPublicId || previous?.cloudPublicId,
        });
      };
      const currentCloudPublicId =
        latest.localImage.cloudPublicId ||
        (latest.localImage.cloudUrl
          ? extractPublicId(latest.localImage.cloudUrl)
          : latest.thumbnail
            ? extractPublicId(latest.thumbnail)
            : undefined) ||
        latestJob?.cloudMedia?.publicId;
      addCleanup(latest.localImage.id, currentCloudPublicId);
      addCleanup(
        latestJob?.localVideoInputThumbnail?.previousAssetId,
        latestJob?.localVideoInputThumbnail?.previousCloudPublicId,
      );
      const cloudCleanupIds = [...cleanupAssets.values()].flatMap((asset) =>
        asset.cloudPublicId ? [asset.cloudPublicId] : [],
      );
      if (cloudCleanupIds.length > 0 && (!churchId || isGuestSession)) {
        throw new Error("Cloud storage is unavailable. Reconnect and try again.");
      }

      const staged: Array<{
        job: LocalImageUploadJob;
        previous?: LocalImageUploadJob;
      }> = [];
      try {
        for (const [assetId, cleanup] of cleanupAssets) {
          staged.push(
            await createThumbnailCleanupJob({
              assetId,
              mediaId: latest.id,
              workspaceId: cleanup.workspaceId,
              cloudPublicId: cleanup.cloudPublicId,
            }),
          );
        }
        await writeVideoInputMedia(latest, {
          ...latest,
          localImage: undefined,
          thumbnail: "",
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await Promise.all(
          staged.map(({ job, previous }) =>
            previous
              ? putLocalImageUploadJob(previous)
              : deleteLocalImageUploadJob(job.assetId),
          ),
        );
        throw error;
      }

      for (const { job } of staged) {
        await activateThumbnailCleanupJob(job);
      }
      if (staged.length === 0) {
        await deleteLocalImage(latest.localImage.id);
      }
    },
    [
      activateThumbnailCleanupJob,
      getCurrentMediaList,
      isGuestSession,
      churchId,
      createThumbnailCleanupJob,
      writeVideoInputMedia,
    ],
  );
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
      const media: MediaType = {
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
      };
      addLocalMedia(media);
      if (initialThumbnail) {
        await saveVideoInputThumbnail(media.id, initialThumbnail);
      }
    },
    [addLocalMedia, saveVideoInputThumbnail],
  );

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
                mediaUploadDisabled={c.isMediaReadOnly}
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
          onImportFromCanva={canvaOauthConfigured ? openCanva : undefined}
          mediaUploadDisabled={c.isMediaReadOnly}
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
