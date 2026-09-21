import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Cable, ExternalLink, Folder, MonitorUp } from "lucide-react";
import Button from "../../components/Button/Button";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector, useMediaSelection } from "../../hooks";
import { DBMedia, MediaFolder, MediaRouteKey, MediaType } from "../../types";
import {
  syncMediaFromRemote,
  addItemToMediaList,
  setMediaListAndFolders,
  updateMediaItemFields,
} from "../../store/mediaSlice";
import { mediaInfoType } from "./cloudinaryTypes";
import type { MediaUploadInputRef } from "./MediaUploadInput";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import { deleteLocalImage } from "../../utils/localImageAssets";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";
import {
  isDesktopCaptureKind,
  isDesktopCaptureSourceMissingError,
} from "../../utils/localVideoInput";
import {
  buildLocalVideoInputSendPresentation,
  isLocalVideoInputMedia,
  mediaHasSendableContent,
  sendLocalVideoInputWithWarmCapture,
} from "../../utils/localVideoMediaLibrary";
import generateRandomId from "../../utils/generateRandomId";
import {
  deleteFromCloudinary,
  extractPublicId,
} from "../../utils/cloudinaryUtils";
import { getApiBasePath } from "../../utils/environment";
import {
  setMediaItems,
  setMediaRouteFolder,
  replaceMediaReferencesInPreferences,
} from "../../store/preferencesSlice";
import { getMediaRouteKey } from "../../utils/mediaRouteKey";
import { normalizeMediaDoc } from "../../utils/mediaDocUtils";
import { sweepMediaReferencesBeforeDelete } from "../../utils/mediaReferenceSweep";
import {
  MEDIA_LIBRARY_ROOT_VIEW,
  collectSubtreeFolderIds,
  deleteFolderAndSubtree,
  deleteFolderKeepContents,
  getChildFolders,
  isMediaLibraryFolderEmpty,
  getMediaRouteFolderRepairs,
  moveMediaToFolder,
} from "../../utils/mediaFolderMutations";
import {
  buildFolderTreeSelectOptions,
  MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER,
} from "../../utils/mediaLibraryFolderOptions";
import {
  buildMediaActionRouteFlags,
  buildMediaLibraryBarActions,
} from "./mediaLibraryActions";
import {
  formatMediaDimensionsLine,
  mediaLibraryDisplayName,
  normalizeMediaLibraryStoredName,
  summarizeMultiSelectMetadata,
  truncatedMediaToastLabel,
} from "./mediaLibraryMeta";
import {
  mediaMatchesOriginFilter,
  type MediaOriginFilterValue,
} from "./mediaLibraryOrigin";
import type { MediaTypeFilterValue } from "./MediaTypeFilter";
import {
  MEDIA_LIBRARY_ORANGE_FOLDER_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";
import { useLocation, useNavigate } from "react-router-dom";
import {
  useActiveControllerProfile,
  useControllerBasePath,
} from "../../context/activeController";
import { getControllerOutputs } from "../../utils/controllerProfiles";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { getControllerItemPath } from "../../utils/outlineSlideSections";
import { RootState } from "../../store/store";
import {
  updateProjector,
  selectOutputSlot,
} from "../../store/presentationSlice";
import {
  replaceMediaReferencesInActiveItem,
  setActiveItem,
  updateSlides,
} from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { createNewFreeForm } from "../../utils/itemUtil";
import { createSlideFromMedia } from "../../utils/slideCreation";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";
import { alertMediaLibraryFlushFailed } from "./mediaLibraryFlushAlerts";
import { fill } from "@cloudinary/url-gen/actions/resize";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { ActionCreators } from "redux-undo";
import { useToast } from "../../context/toastContext";
import type { ToastVariant } from "../../components/Toast/Toast";
import { type VirtualMediaGridHandle } from "./VirtualMediaGrid";
import { getCanvaMediaSource } from "./canvaMediaSource";
import {
  replaceMediaReferencesForReplacement,
} from "../../utils/mediaReferenceSweep";
import { commitCanvaMediaReplacement } from "../../utils/canvaMediaReplacement";
import { useLocalMediaCloudShare } from "./localMediaCloudShare";
import { isLocalMediaVisibleByDefault } from "./mediaLibraryLocalAvailability";
import { buildVideoPlaybackCueForSend } from "../../utils/videoBackgroundPlayback";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useMediaLibraryFocus } from "./useMediaLibraryFocus";
import { replaceMediaReferencesInPresentation as replacePresentationMediaReferences } from "../../store/presentationSlice";

export type MediaLibraryPageMode = "default" | "overlayController";
export type MediaLibraryVariant = "default" | "panel";

export type UseMediaLibraryControllerArgs = {
  variant?: MediaLibraryVariant;
  pageMode?: MediaLibraryPageMode;
  onManageCanvaSource?: (media: MediaType) => void;
  onRelinkVideoInput?: (media: MediaType) => void;
};

export function useMediaLibraryController({
  variant = "default",
  pageMode = "default",
  onManageCanvaSource,
  onRelinkVideoInput,
}: UseMediaLibraryControllerArgs = {}) {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const { showToast, updateToast, removeToast } = useToast();
  const isPanelVariant = variant === "panel";

  const notifyMediaAction = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      showToast(message, variant);
    },
    [showToast],
  );

  const slideBackgroundFeedbackTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [slideBackgroundFeedbackId, setSlideBackgroundFeedbackId] = useState<
    string | null
  >(null);

  const triggerSlideBackgroundFeedback = useCallback((feedbackId: string) => {
    setSlideBackgroundFeedbackId(feedbackId);
    if (slideBackgroundFeedbackTimeoutRef.current != null) {
      clearTimeout(slideBackgroundFeedbackTimeoutRef.current);
    }
    slideBackgroundFeedbackTimeoutRef.current = setTimeout(() => {
      slideBackgroundFeedbackTimeoutRef.current = null;
      setSlideBackgroundFeedbackId(null);
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      if (slideBackgroundFeedbackTimeoutRef.current != null) {
        clearTimeout(slideBackgroundFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  const {
    db,
    cloud,
    isMobile,
    updater,
    isGuestSession = false,
  } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};

  const {
    list,
    folders,
    isInitialized: mediaStoreInitialized,
    loadStatus: mediaLoadStatus,
  } = useSelector((state: RootState) => state.media);
  const currentMediaListRef = useRef(list);
  const currentMediaFoldersRef = useRef(folders);
  currentMediaListRef.current = list;
  currentMediaFoldersRef.current = folders;
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const isLoading = item.isLoading;

  const itemSlideContext = useMemo(() => {
    if (!location.pathname.includes("item")) return undefined;
    const arrangement = item.arrangements[item.selectedArrangement];
    const slides = arrangement?.slides?.length
      ? arrangement.slides
      : item.slides;
    return {
      itemType: item.type,
      slides,
      selectedSlide: item.selectedSlide,
      backgroundTargetSlideIds: item.backgroundTargetSlideIds ?? [],
    };
  }, [
    item.arrangements,
    item.selectedArrangement,
    item.slides,
    item.type,
    item.selectedSlide,
    item.backgroundTargetSlideIds,
    location.pathname,
  ]);
  const { selectedOverlay } = useSelector(
    (state: RootState) => state.undoable.present.overlay,
  );

  const {
    isMediaExpanded,
    mediaItemsPerRow,
    selectedPreference,
    selectedQuickLink,
    mediaRouteFolders,
    focusMediaId,
    preferences: {
      defaultFreeFormBackgroundBrightness,
      defaultFreeFormFontMode,
    },
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  /**
   * Projector displays *this* controller drives.
   *
   * Sending without naming them fell back to the built-in projector, so "Send
   * to projector" from an auxiliary controller put media on the sanctuary
   * screen.
   */
  const controllerProfile = useActiveControllerProfile();
  const displayOutputs = useSelector(selectDisplayOutputs);
  const projectorTargets = useMemo(
    () =>
      getControllerOutputs(controllerProfile, displayOutputs).filter(
        (output) => output.type === "projector",
      ),
    [controllerProfile, displayOutputs],
  );
  const projectorTargetIds = useMemo(
    () => projectorTargets.map((output) => output.id),
    [projectorTargets],
  );
  /** Operator-facing name for the send action, so it never says "projector"
   * when the controller drives a display called something else. */
  const projectorTargetLabel =
    projectorTargets.length === 1 ? projectorTargets[0].name : "projectors";
  const isProjectorTransmitting = useSelector((state: RootState) =>
    projectorTargetIds.some(
      (id) => selectOutputSlot(state, id, "projector").isTransmitting,
    ),
  );
  const { list: allItemsList } = useSelector(
    (state: RootState) => state.allItems,
  );

  const routeKey = getMediaRouteKey(location.pathname, pageMode, item.type);
  const selectedLibraryFilter =
    mediaRouteFolders[routeKey] === undefined
      ? null
      : mediaRouteFolders[routeKey]!;

  const [typeFilter, setTypeFilter] = useState<MediaTypeFilterValue>("all");
  const [originFilter, setOriginFilter] =
    useState<MediaOriginFilterValue>("all");
  const [showOtherDeviceLocalMedia, setShowOtherDeviceLocalMedia] =
    useState(false);
  const { deviceId, getBarAction: getLocalMediaCloudShareBarAction } =
    useLocalMediaCloudShare();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<MediaType | null>(null);
  const [isDeletingMultiple, setIsDeletingMultiple] = useState(false);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(
    new Set(),
  );
  const [showProviderRetryModal, setShowProviderRetryModal] = useState(false);
  const [providerRetryRows, setProviderRetryRows] = useState<MediaType[]>([]);
  const [providerRetryBusy, setProviderRetryBusy] = useState(false);
  const deleteConfirmLockRef = useRef(false);
  /** Fullscreen Media modal only; panel grid shows names only while searching. */
  const [showName, setShowName] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    isUploading: boolean;
    progress: number;
  }>({ isUploading: false, progress: 0 });
  const mediaUploadInputRef = useRef<MediaUploadInputRef>(null);
  const mediaListRef = useRef<HTMLElement>(null);
  const mediaGridRef = useRef<VirtualMediaGridHandle>(null);
  const uploadPollingIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const lastBrowseFolderIdRef = useRef<string>(MEDIA_LIBRARY_ROOT_VIEW);
  const [folderRenameOpen, setFolderRenameOpen] = useState(false);
  const [mediaRenameOpen, setMediaRenameOpen] = useState(false);
  const mediaRenameOpenRef = useRef(false);
  const moveToNewFolderOpenRef = useRef(false);
  const ignoreRenameAutoCloseUntilRef = useRef(0);
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moveToNewFolderOpen, setMoveToNewFolderOpen] = useState(false);
  const [moveSelectKey, setMoveSelectKey] = useState(0);

  const isMediaLoading = Boolean(
    db && (mediaLoadStatus === "idle" || mediaLoadStatus === "loading"),
  );
  const hasMediaLoadError = mediaLoadStatus === "error";
  const isMediaReadOnly = !mediaStoreInitialized;

  useEffect(() => {
    if (selectedLibraryFilter !== null) {
      lastBrowseFolderIdRef.current = selectedLibraryFilter;
    }
  }, [selectedLibraryFilter]);

  useEffect(() => {
    setFolderRenameOpen(false);
  }, [selectedLibraryFilter]);

  const showAll = selectedLibraryFilter === null;
  const showNamesInPanelGrid = searchTerm.trim().length > 0;
  const parentForBrowseChildren =
    selectedLibraryFilter === null ||
    selectedLibraryFilter === MEDIA_LIBRARY_ROOT_VIEW
      ? null
      : selectedLibraryFilter;
  const childFolders = useMemo(
    () => getChildFolders(parentForBrowseChildren, folders),
    [parentForBrowseChildren, folders],
  );
  const selectedRealFolder =
    selectedLibraryFilter && selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? folders.find((f) => f.id === selectedLibraryFilter)
      : undefined;
  const canGoUp = Boolean(
    selectedLibraryFilter && selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW,
  );

  const hiddenOtherDeviceLocalCount = useMemo(
    () =>
      list.filter((item) => !isLocalMediaVisibleByDefault(item, deviceId))
        .length,
    [deviceId, list],
  );
  const showOtherDeviceLocalMediaToggle =
    hiddenOtherDeviceLocalCount > 0 || showOtherDeviceLocalMedia;

  const filteredList = useMemo(() => {
    return list.filter((item) => {
      if (pendingDeletionIds.has(item.id)) return false;
      const matchesSearch = item.name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (!mediaMatchesOriginFilter(item, originFilter)) return false;
      if (
        !showOtherDeviceLocalMedia &&
        !isLocalMediaVisibleByDefault(item, deviceId)
      ) {
        return false;
      }
      if (selectedLibraryFilter === MEDIA_LIBRARY_ROOT_VIEW) {
        return !item.folderId;
      }
      if (selectedLibraryFilter) {
        return item.folderId === selectedLibraryFilter;
      }
      return true;
    });
  }, [
    deviceId,
    list,
    originFilter,
    pendingDeletionIds,
    searchTerm,
    selectedLibraryFilter,
    showOtherDeviceLocalMedia,
  ]);

  // Use shared selection hook
  const {
    selectedMedia,
    selectedMediaIds,
    previewMedia,
    mediaMultiSelectMode,
    setSelectedMedia,
    setPreviewMedia,
    setSelectedMediaIds,
    handleMediaClick,
    enterMediaMultiSelectMode,
    clearSelection,
    reconcileSelectionWithMediaList,
  } = useMediaSelection({
    mediaList: list,
    filteredList,
    enableRangeSelection: true,
  });

  const canDragMediaToSlides =
    item.type === "free" && (access === "full" || access === "music");
  const orderedSelectedMediaIds = useMemo(
    () =>
      list
        .filter((media) => selectedMediaIds.has(media.id))
        .map((media) => media.id),
    [list, selectedMediaIds],
  );

  useEffect(() => {
    reconcileSelectionWithMediaList(list);
  }, [list, reconcileSelectionWithMediaList]);

  useMediaLibraryFocus({
    dispatch,
    focusMediaId,
    list,
    filteredList,
    isMediaLoading,
    isMediaExpanded,
    selectedLibraryFilter,
    pendingDeletionIds,
    deviceId,
    routeKey,
    mediaGridRef,
    setSearchTerm,
    setOriginFilter,
    setTypeFilter,
    setShowOtherDeviceLocalMedia,
    setSelectedMedia,
    setSelectedMediaIds,
    setPreviewMedia,
  });

  /** Keep ref in sync immediately — document click runs before useEffect after setState. */
  const setRenamePopoverOpen = useCallback((open: boolean) => {
    mediaRenameOpenRef.current = open;
    setMediaRenameOpen(open);
  }, []);

  const setMoveToNewFolderPopoverOpen = useCallback((open: boolean) => {
    moveToNewFolderOpenRef.current = open;
    setMoveToNewFolderOpen(open);
  }, []);

  const handleRenamePopoverOpenChange = useCallback(
    (open: boolean) => {
      if (!open && Date.now() < ignoreRenameAutoCloseUntilRef.current) {
        return;
      }
      setRenamePopoverOpen(open);
    },
    [setRenamePopoverOpen],
  );

  const handleMoveToNewFolderPopoverOpenChange = useCallback(
    (open: boolean) => {
      if (!open && Date.now() < ignoreRenameAutoCloseUntilRef.current) {
        return;
      }
      setMoveToNewFolderPopoverOpen(open);
    },
    [setMoveToNewFolderPopoverOpen],
  );

  useEffect(() => {
    if (selectedMediaIds.size !== 1) setRenamePopoverOpen(false);
  }, [selectedMediaIds.size, setRenamePopoverOpen]);

  useEffect(() => {
    if (selectedMediaIds.size === 0) setMoveToNewFolderPopoverOpen(false);
  }, [selectedMediaIds.size, setMoveToNewFolderPopoverOpen]);

  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      clearSelection();
      dispatch(setMediaRouteFolder({ key: routeKey, folderId }));
    },
    [clearSelection, dispatch, routeKey],
  );

  const handleShowAllChange = useCallback(
    (next: boolean) => {
      if (next) {
        if (selectedLibraryFilter !== null) {
          lastBrowseFolderIdRef.current = selectedLibraryFilter;
        }
        dispatch(setMediaRouteFolder({ key: routeKey, folderId: null }));
      } else {
        dispatch(
          setMediaRouteFolder({
            key: routeKey,
            folderId: lastBrowseFolderIdRef.current,
          }),
        );
      }
    },
    [dispatch, routeKey, selectedLibraryFilter],
  );

  const handleGoUp = useCallback(() => {
    if (!selectedRealFolder) return;
    navigateToFolder(selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
  }, [navigateToFolder, selectedRealFolder]);

  const openSingleDeleteModal = useCallback((mediaItem: MediaType) => {
    setMediaToDelete(mediaItem);
    setIsDeletingMultiple(false);
    setShowDeleteModal(true);
  }, []);

  /** Fullscreen modal keeps selection in MediaModal; copy into parent before bulk delete. */
  const openMultiDeleteModal = (ids: Set<string>) => {
    setSelectedMediaIds(new Set(ids));
    setMediaToDelete(null);
    setIsDeletingMultiple(true);
    setShowDeleteModal(true);
  };

  useEffect(() => {
    if (isMobile) {
      dispatch(setMediaItems(3));
    } else {
      dispatch(setMediaItems(4));
    }
  }, [isMobile, dispatch]);

  const uploadTargetFolderId =
    selectedLibraryFilter && selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? selectedLibraryFilter
      : null;

  const applyFoldersAndList = useCallback(
    (next: { list: MediaType[]; folders: MediaFolder[] }) => {
      dispatch(setMediaListAndFolders(next));
    },
    [dispatch],
  );

  const handleMoveTo = useCallback(
    (targetFolderId: string | null) => {
      if (selectedMediaIds.size === 0) return;
      applyFoldersAndList({
        folders,
        list: moveMediaToFolder(selectedMediaIds, targetFolderId, list),
      });
      setMoveSelectKey((k) => k + 1);
      clearSelection();
    },
    [selectedMediaIds, folders, list, applyFoldersAndList, clearSelection],
  );

  const moveSelectOptions = useMemo(
    () => [
      {
        value: MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER,
        label: "New folder…",
      },
      ...buildFolderTreeSelectOptions(folders).selectOptions,
    ],
    [folders],
  );

  const handleSendSelectedMediaToProjector = useCallback(() => {
    const m = selectedMedia;
    if (!mediaHasSendableContent(m) || !isProjectorTransmitting) return;
    const displayName = mediaLibraryDisplayName(m);

    if (isLocalVideoInputMedia(m)) {
      const built = buildLocalVideoInputSendPresentation({
        source: m.localVideoInput,
        name: displayName,
        outputIds: projectorTargetIds,
        brightness: defaultFreeFormBackgroundBrightness,
      });
      if (!built.ok) {
        showToast(built.message, "warning");
        return;
      }
      void sendLocalVideoInputWithWarmCapture({
        sourceId: built.sourceId,
        captureKind: m.localVideoInput.captureKind,
        send: () => {
          dispatch(updateProjector(built.presentation));
          showToast(
            `Sent "${truncatedMediaToastLabel(m)}" to ${projectorTargetLabel}. Only this computer can show the live share.`,
            "success",
          );
        },
        onError: (message, error) => {
          if (!isDesktopCaptureSourceMissingError(error)) {
            showToast(message, "warning");
            return;
          }
          const shareTarget =
            m.localVideoInput?.captureKind === "window" ? "window" : "screen";
          showToast({
            message: `This ${shareTarget} share is unavailable on this computer.`,
            variant: "warning",
            duration: 15000,
            children: (toastId) => (
              <Button
                type="button"
                variant="secondary"
                className="mx-auto mt-2 text-xs"
                onClick={() => {
                  removeToast(toastId);
                  onRelinkVideoInput?.(m);
                }}
              >
                Choose share again
              </Button>
            ),
          });
        },
      });
      return;
    }

    if (!m.background) return;
    const slide = createSlideFromMedia(m, {
      name: "Section 1",
      brightness: defaultFreeFormBackgroundBrightness,
      overflow: defaultFreeFormFontMode,
    });
    dispatch(
      updateProjector({
        slide,
        type: "free",
        name: displayName,
        outputIds: projectorTargetIds,
        videoPlayback: buildVideoPlaybackCueForSend(slide),
      }),
    );
    showToast(
      `Sent "${truncatedMediaToastLabel(m)}" to ${projectorTargetLabel}.`,
      "success",
    );
  }, [
    selectedMedia,
    isProjectorTransmitting,
    projectorTargetIds,
    projectorTargetLabel,
    defaultFreeFormBackgroundBrightness,
    defaultFreeFormFontMode,
    dispatch,
    showToast,
    removeToast,
    onRelinkVideoInput,
  ]);

  const handleCreateCustomItemFromMedia = useCallback(async () => {
    const selectedMediaItems = list.filter((media) =>
      selectedMediaIds.has(media.id),
    );
    if (
      !db ||
      selectedMediaItems.length === 0 ||
      !selectedMediaItems.every(mediaHasSendableContent)
    )
      return;
    const m = selectedMediaItems[0];
    const displayName =
      selectedMediaItems.length === 1
        ? mediaLibraryDisplayName(m)
        : "Media presentation";
    const isLiveInput =
      selectedMediaItems.length === 1 && isLocalVideoInputMedia(m);
    try {
      const newItem = await createNewFreeForm({
        name: displayName,
        text: "",
        list: allItemsList,
        db,
        background: isLiveInput ? "" : m.background,
        mediaInfo: isLiveInput ? undefined : m,
        mediaSource: isLiveInput ? m.localVideoInput : undefined,
        brightness: defaultFreeFormBackgroundBrightness,
        overflow: defaultFreeFormFontMode,
        emptyBodyText: true,
        slideDefs:
          selectedMediaItems.length > 1
            ? selectedMediaItems.map((media, index) => ({
                name: mediaLibraryDisplayName(media) || `Slide ${index + 1}`,
                background: isLocalVideoInputMedia(media)
                  ? ""
                  : media.background,
                mediaInfo: isLocalVideoInputMedia(media) ? undefined : media,
                mediaSource: isLocalVideoInputMedia(media)
                  ? media.localVideoInput
                  : undefined,
              }))
            : undefined,
      });
      const listItem = {
        name: newItem.name,
        type: newItem.type,
        background: newItem.background,
        localImage: isLiveInput ? undefined : m.localImage,
        localVideoFile: isLiveInput ? undefined : m.localVideoFile,
        _id: newItem._id,
        listId: "",
      };
      dispatch(setActiveItem(newItem));
      const addedAction = dispatch(addItemToItemList(listItem));
      dispatch(addItemToAllItemsList(listItem));
      navigate(
        getControllerItemPath(
          { _id: newItem._id, listId: addedAction.payload.listId },
          controllerBasePath,
        ),
      );
      showToast(
        isLiveInput
          ? `Live input item "${truncatedMediaToastLabel({ name: newItem.name })}" created. Select its slide to send the share to your displays.`
          : `Custom item "${truncatedMediaToastLabel({ name: newItem.name })}" created and added to the outline.`,
        "success",
      );
    } catch {
      showToast("Could not create the item. Try again.", "error");
    }
  }, [
    controllerBasePath,
    selectedMediaIds,
    list,
    db,
    allItemsList,
    defaultFreeFormBackgroundBrightness,
    defaultFreeFormFontMode,
    dispatch,
    navigate,
    showToast,
  ]);

  const handleAddSlidesFromMedia = useCallback(() => {
    if (!itemSlideContext || item.type !== "free") return;
    const selectedMediaItems = list.filter((media) =>
      selectedMediaIds.has(media.id),
    );
    if (
      !selectedMediaItems.length ||
      !selectedMediaItems.every(mediaHasSendableContent)
    )
      return;
    const slides = selectedMediaItems.map((media) =>
      createSlideFromMedia(media, {
        brightness: defaultFreeFormBackgroundBrightness,
        overflow: defaultFreeFormFontMode,
      }),
    );
    dispatch(updateSlides({ slides: [...itemSlideContext.slides, ...slides] }));
    showToast(
      `${slides.length === 1 ? "Slide" : `${slides.length} slides`} added to this custom item.`,
      "success",
    );
  }, [
    defaultFreeFormBackgroundBrightness,
    defaultFreeFormFontMode,
    dispatch,
    item.type,
    itemSlideContext,
    list,
    selectedMediaIds,
    showToast,
  ]);

  const routeFlags = useMemo(
    () =>
      buildMediaActionRouteFlags(
        location.pathname,
        pageMode,
        selectedOverlay,
        selectedPreference,
        selectedQuickLink,
      ),
    [
      location.pathname,
      pageMode,
      selectedOverlay,
      selectedPreference,
      selectedQuickLink,
    ],
  );

  const mediaBarActions = useMemo(() => {
    const actions = buildMediaLibraryBarActions({
      flags: routeFlags,
      db,
      isLoading: Boolean(isLoading),
      selectedPreference,
      selectedQuickLink,
      selectedOverlay,
      primaryMedia: selectedMedia,
      hasMultipleSelection: selectedMediaIds.size > 1,
      selectedCount: selectedMediaIds.size,
      dispatch,
      onDeleteSingle: () => {
        openSingleDeleteModal(selectedMedia);
      },
      onDeleteMultiple: () => {
        setMediaToDelete(null);
        setIsDeletingMultiple(true);
        setShowDeleteModal(true);
      },
      itemSlideContext,
      controllerFromSelectedMedia:
        selectedMediaIds.size > 0
          ? {
              isProjectorTransmitting,
              sendTargetLabel: projectorTargetLabel,
              onSendToProjector: handleSendSelectedMediaToProjector,
              onCreateCustomItem: handleCreateCustomItemFromMedia,
              onAddSlides: canDragMediaToSlides
                ? handleAddSlidesFromMedia
                : undefined,
            }
          : undefined,
      notify: notifyMediaAction,
      onItemSlideBackgroundFeedback: triggerSlideBackgroundFeedback,
    });
    if (
      selectedMediaIds.size === 1 &&
      getCanvaMediaSource(selectedMedia) &&
      onManageCanvaSource
    ) {
      actions.push({
        id: "manage-canva-source",
        label: "Manage Canva source",
        icon: <ExternalLink className="size-4" />,
        onClick: () => onManageCanvaSource(selectedMedia),
      });
    }
    if (
      selectedMediaIds.size === 1 &&
      selectedMedia.localVideoInput &&
      onRelinkVideoInput
    ) {
      const isShare = isDesktopCaptureKind(
        selectedMedia.localVideoInput.captureKind,
      );
      actions.push({
        id: "relink-video-input",
        label: isShare ? "Choose share again" : "Relink input",
        icon: isShare ? (
          <MonitorUp className="size-4" />
        ) : (
          <Cable className="size-4" />
        ),
        onClick: () => onRelinkVideoInput(selectedMedia),
      });
    }
    const cloudShareAction = getLocalMediaCloudShareBarAction(
      selectedMedia,
      selectedMediaIds.size,
    );
    if (cloudShareAction) actions.push(cloudShareAction);
    return actions;
  }, [
    routeFlags,
    db,
    isLoading,
    projectorTargetLabel,
    selectedPreference,
    selectedQuickLink,
    selectedOverlay,
    selectedMedia,
    selectedMediaIds.size,
    dispatch,
    itemSlideContext,
    isProjectorTransmitting,
    handleSendSelectedMediaToProjector,
    handleCreateCustomItemFromMedia,
    handleAddSlidesFromMedia,
    canDragMediaToSlides,
    notifyMediaAction,
    triggerSlideBackgroundFeedback,
    onManageCanvaSource,
    onRelinkVideoInput,
    getLocalMediaCloudShareBarAction,
    openSingleDeleteModal,
  ]);

  const actionBarDetails = useMemo(() => {
    /** Matches single-item title so browse / folder / selection headers don’t shift layout. */
    const headerLine = (primary: string, title?: string) => (
      <div
        className="min-w-0 truncate text-xs font-medium text-white"
        title={title ?? primary}
      >
        {primary}
      </div>
    );

    if (selectedMediaIds.size === 0) {
      if (selectedLibraryFilter === null) {
        return headerLine(
          "All media",
          "All media — turn off Show all to browse folders.",
        );
      }
      if (selectedLibraryFilter === MEDIA_LIBRARY_ROOT_VIEW) {
        return headerLine("Library root");
      }
      const folderName = selectedRealFolder?.name ?? "—";
      return (
        <div
          className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white"
          title={folderName}
        >
          <Folder
            {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
            className={MEDIA_LIBRARY_ORANGE_FOLDER_CLASS}
            aria-hidden
          />
          <span className="min-w-0 truncate">{folderName}</span>
        </div>
      );
    }
    if (selectedMediaIds.size === 1) {
      const m = selectedMedia;
      const shown = mediaLibraryDisplayName(m);
      const metaLine = formatMediaDimensionsLine(m);
      const metaSuffix = metaLine
        ? ` · ${m.type} · ${metaLine}`
        : ` · ${m.type}`;
      return (
        <div className="min-w-0 truncate text-xs" title={m.name}>
          <span className="font-medium text-white">{shown}</span>
          <span className="font-normal text-gray-400">{metaSuffix}</span>
        </div>
      );
    }
    const items = list.filter((x) => selectedMediaIds.has(x.id));
    const multiMeta = summarizeMultiSelectMetadata(items);
    const showSelectionAccent =
      mediaMultiSelectMode || selectedMediaIds.size > 1;
    return (
      <div
        className="min-w-0 truncate text-xs"
        title={
          multiMeta
            ? `${selectedMediaIds.size} selected · ${multiMeta}`
            : `${selectedMediaIds.size} selected`
        }
      >
        <span
          className={
            showSelectionAccent
              ? "font-medium text-cyan-400"
              : "font-medium text-white"
          }
        >
          {selectedMediaIds.size} selected
        </span>
        {multiMeta ? (
          <span className="font-normal text-gray-400"> · {multiMeta}</span>
        ) : null}
      </div>
    );
  }, [
    list,
    selectedLibraryFilter,
    selectedMedia,
    selectedMediaIds,
    selectedRealFolder?.name,
    mediaMultiSelectMode,
  ]);

  const parentForNewFolder =
    selectedLibraryFilter && selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? selectedLibraryFilter
      : null;

  const deleteFromProviders = useCallback(
    async (rows: MediaType[]): Promise<MediaType[]> => {
      const failed: MediaType[] = [];
      for (const row of rows) {
        if (row.source === "cloudinary") {
          if (!cloud) {
            failed.push(row);
            continue;
          }
          let publicId = row.publicId;
          if (!publicId) {
            publicId = extractPublicId(row.background) || "";
          }
          if (!publicId) continue;
          const ok = await deleteFromCloudinary(cloud, publicId, row.type);
          if (!ok) failed.push(row);
        } else if (row.source === "mux" && row.muxAssetId) {
          try {
            const res = await fetch(
              `${getApiBasePath()}api/mux/asset/${row.muxAssetId}`,
              { method: "DELETE" },
            );
            if (!res.ok) failed.push(row);
          } catch (error) {
            console.warn("Error deleting from Mux:", error);
            failed.push(row);
          }
        } else if (row.source === "local") {
          try {
            if (row.localImage?.cloudUrl && row.publicId) {
              if (!cloud) {
                failed.push(row);
                continue;
              }
              const removedCloudCopy = await deleteFromCloudinary(
                cloud,
                row.publicId,
                "image",
              );
              if (!removedCloudCopy) {
                failed.push(row);
                continue;
              }
            }
            if (row.localImage) await deleteLocalImage(row.localImage.id);
            if (row.localVideoFile) {
              await deleteLocalVideoFile(row.localVideoFile.id);
            }
          } catch (error) {
            console.warn("Error deleting local media:", error);
            failed.push(row);
          }
        }
      }
      return failed;
    },
    [cloud],
  );

  const providerIdentity = useCallback(
    (row: MediaType) => {
      if (row.source === "mux") return row.muxAssetId || "";
      if (row.source === "cloudinary") {
        return row.publicId || extractPublicId(row.background) || "";
      }
      return "";
    },
    [],
  );

  const deleteCanvaProvider = useCallback(
    async (row: MediaType, protectedRow?: MediaType) => {
      if (
        protectedRow &&
        row.source === protectedRow.source &&
        providerIdentity(row) &&
        providerIdentity(row) === providerIdentity(protectedRow)
      ) {
        return true;
      }
      const failed = await deleteFromProviders([row]);
      return failed.length === 0;
    },
    [deleteFromProviders, providerIdentity],
  );

  const showProviderCleanupRetry = useCallback((rows: MediaType[]) => {
    if (rows.length === 0) return;
    setProviderRetryRows((current) => {
      const next = [...current];
      for (const row of rows) {
        if (!next.some((existing) => existing.id === row.id)) next.push(row);
      }
      return next;
    });
    setShowProviderRetryModal(true);
  }, []);

  const commitCanvaReplacement = useCallback(
    async (oldMedia: MediaType, newMedia: MediaType) => {
      if (!db) throw new Error("Could not save Canva media replacement.");
      const folders = currentMediaFoldersRef.current;
      await commitCanvaMediaReplacement({
        oldMedia,
        newMedia,
        currentList: currentMediaListRef.current,
        folders,
        replaceReferences: async (replacement) =>
          replaceMediaReferencesForReplacement(db, replacement),
        flushMedia: (nextList, nextFolders) =>
          flushMediaLibraryDocToPouch(db, nextList, nextFolders),
        deleteProvider: deleteCanvaProvider,
        applyList: (nextList, nextFolders) => {
          currentMediaListRef.current = nextList;
          dispatch(setMediaListAndFolders({
            list: nextList,
            folders: nextFolders,
          }));
        },
        applyLiveReferences: (replacement) => {
          dispatch(replaceMediaReferencesInActiveItem(replacement));
          dispatch(replacePresentationMediaReferences(replacement));
          dispatch(replaceMediaReferencesInPreferences(replacement));
        },
        onCleanupFailure: showProviderCleanupRetry,
      });
    },
    [
      db,
      deleteCanvaProvider,
      dispatch,
      showProviderCleanupRetry,
    ],
  );

  const removeMediaRowsAfterSweep = useCallback(
    async (
      rows: MediaType[],
    ): Promise<
      { phase: "sweep_failed" } | { phase: "ok"; providerFailed: MediaType[] }
    > => {
      if (rows.length === 0) return { phase: "ok", providerFailed: [] };
      if (!db) {
        window.alert("Could not update references before delete.");
        return { phase: "sweep_failed" };
      }
      const sweep = await sweepMediaReferencesBeforeDelete(
        db,
        new Set(rows.map((r) => r.id)),
        rows,
      );
      if (!sweep.ok) {
        window.alert(
          sweep.message || "Could not update references before delete.",
        );
        return { phase: "sweep_failed" };
      }
      const providerFailed = await deleteFromProviders(rows);
      return { phase: "ok", providerFailed };
    },
    [db, deleteFromProviders],
  );

  const handleDeleteFolderKeepContents = useCallback(
    (folderId: string) => {
      const target = folders.find((f) => f.id === folderId);
      const fallback =
        target?.parentId == null ? MEDIA_LIBRARY_ROOT_VIEW : target.parentId;
      const repairs = getMediaRouteFolderRepairs(
        mediaRouteFolders,
        new Set([folderId]),
        fallback,
      );
      for (const key of Object.keys(repairs) as MediaRouteKey[]) {
        const nextFolder = repairs[key];
        if (nextFolder !== undefined) {
          dispatch(setMediaRouteFolder({ key, folderId: nextFolder }));
        }
      }
      const next = deleteFolderKeepContents(folderId, folders, list);
      dispatch(setMediaListAndFolders(next));
      void flushMediaLibraryDocToPouch(db, next.list, next.folders).then(
        (r) => {
          if (!r.ok) {
            alertMediaLibraryFlushFailed(r.error, "folder");
          }
        },
      );
    },
    [db, dispatch, folders, list, mediaRouteFolders],
  );

  const handleRequestFolderDelete = useCallback(() => {
    if (
      !selectedLibraryFilter ||
      selectedLibraryFilter === MEDIA_LIBRARY_ROOT_VIEW
    ) {
      return;
    }
    const folder = folders.find((f) => f.id === selectedLibraryFilter);
    if (!folder) return;
    if (isMediaLibraryFolderEmpty(folder.id, folders, list)) {
      handleDeleteFolderKeepContents(folder.id);
      navigateToFolder(folder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
      return;
    }
    setFolderDeleteOpen(true);
  }, [
    selectedLibraryFilter,
    folders,
    list,
    handleDeleteFolderKeepContents,
    navigateToFolder,
    setFolderDeleteOpen,
  ]);

  const handleDeleteFolderSubtree = useCallback(
    async (folderId: string) => {
      const target = folders.find((f) => f.id === folderId);
      const subtree = collectSubtreeFolderIds(folderId, folders);
      const fallback =
        target?.parentId == null ? MEDIA_LIBRARY_ROOT_VIEW : target.parentId;
      const repairs = getMediaRouteFolderRepairs(
        mediaRouteFolders,
        subtree,
        fallback,
      );

      const next = deleteFolderAndSubtree(folderId, folders, list);
      const removedRows = list.filter((m) =>
        next.removedMediaIds.includes(m.id),
      );
      const result = await removeMediaRowsAfterSweep(removedRows);
      if (result.phase !== "ok") return false;

      for (const key of Object.keys(repairs) as MediaRouteKey[]) {
        const nextFolder = repairs[key];
        if (nextFolder !== undefined) {
          dispatch(setMediaRouteFolder({ key, folderId: nextFolder }));
        }
      }
      dispatch(
        setMediaListAndFolders({
          list: next.list,
          folders: next.folders,
        }),
      );
      const flushResult = await flushMediaLibraryDocToPouch(
        db,
        next.list,
        next.folders,
      );
      if (!flushResult.ok) {
        alertMediaLibraryFlushFailed(flushResult.error, "library");
      }
      if (result.providerFailed.length > 0) {
        setProviderRetryRows(result.providerFailed);
        setShowProviderRetryModal(true);
      }
      clearSelection();
      dispatch(ActionCreators.clearHistory());
      return true;
    },
    [
      folders,
      list,
      db,
      dispatch,
      mediaRouteFolders,
      removeMediaRowsAfterSweep,
      clearSelection,
    ],
  );

  // Poll upload status only while an upload is in progress; start/stop via MediaUploadInput callback
  const handleUploadActiveChange = useCallback((active: boolean) => {
    if (!active) {
      if (uploadPollingIntervalRef.current) {
        clearInterval(uploadPollingIntervalRef.current);
        uploadPollingIntervalRef.current = null;
      }
      setUploadProgress({ isUploading: false, progress: 0 });
      return;
    }
    if (uploadPollingIntervalRef.current) return;
    uploadPollingIntervalRef.current = setInterval(() => {
      const status = mediaUploadInputRef.current?.getUploadStatus();
      if (status) {
        setUploadProgress({
          isUploading: status.isUploading,
          progress: status.progress,
        });
      }
    }, 500);
  }, []);

  const updateMediaListFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "media") {
            console.log("updating media list from remote");
            const update = _update as DBMedia;
            const normalized = normalizeMediaDoc(update);
            dispatch(syncMediaFromRemote(normalized));
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateMediaListFromExternal);

    return () => {
      updater.removeEventListener("update", updateMediaListFromExternal);
    };
  }, [updater, updateMediaListFromExternal]);

  useGlobalBroadcast(updateMediaListFromExternal);

  const dismissDeleteModal = useCallback(() => {
    setShowDeleteModal(false);
    setMediaToDelete(null);
    setIsDeletingMultiple(false);
  }, []);

  const finishOptimisticDeletion = useCallback(
    async (
      rows: MediaType[],
      toastId: string,
    ): Promise<{ succeeded: MediaType[]; failed: MediaType[] }> => {
      if (!db || rows.length === 0) {
        setPendingDeletionIds((current) => {
          const next = new Set(current);
          rows.forEach((row) => next.delete(row.id));
          return next;
        });
        updateToast(toastId, {
          message: "Media could not be deleted.",
          variant: "error",
          persist: false,
          duration: 7000,
        });
        return { succeeded: [], failed: rows };
      }

      try {
        const result = await removeMediaRowsAfterSweep(rows);
        if (result.phase !== "ok") {
          setPendingDeletionIds((current) => {
            const next = new Set(current);
            rows.forEach((row) => next.delete(row.id));
            return next;
          });
          updateToast(toastId, {
            message: "Media could not be deleted.",
            variant: "error",
            persist: false,
            duration: 7000,
          });
          return { succeeded: [], failed: rows };
        }

        const failedIds = new Set(result.providerFailed.map((row) => row.id));
        const succeeded = rows.filter((row) => !failedIds.has(row.id));
        const failed = rows.filter((row) => failedIds.has(row.id));
        const updatedList = currentMediaListRef.current.filter(
          (item) => !succeeded.some((row) => row.id === item.id),
        );
        const currentFolders = currentMediaFoldersRef.current;

        dispatch(
          setMediaListAndFolders({
            list: updatedList,
            folders: currentFolders,
          }),
        );

        const flushResult = await flushMediaLibraryDocToPouch(
          db,
          updatedList,
          currentFolders,
        );
        if (!flushResult.ok) {
          alertMediaLibraryFlushFailed(flushResult.error, "library");
          // Keep the optimistic rows hidden while the local library is out of
          // sync. This also prevents a stale remote echo from making a
          // provider-deleted asset look available again during reconciliation.
          updateToast(toastId, {
            message:
              "Media deletion was not saved. The items remain pending until the library can be reconciled.",
            variant: "error",
            persist: true,
            showCloseButton: true,
          });
          if (failed.length > 0) {
            setProviderRetryRows(failed);
            setShowProviderRetryModal(true);
          }
          return { succeeded, failed };
        }

        setPendingDeletionIds((current) => {
          const next = new Set(current);
          rows.forEach((row) => next.delete(row.id));
          return next;
        });
        if (failed.length > 0) {
          setProviderRetryRows(failed);
          setShowProviderRetryModal(true);
        }

        updateToast(toastId, {
          message:
            failed.length > 0
              ? `${succeeded.length} ${succeeded.length === 1 ? "item" : "items"} deleted. ${failed.length} could not be deleted.`
              : `${succeeded.length} ${succeeded.length === 1 ? "item" : "items"} deleted`,
          variant: failed.length > 0 ? "error" : "success",
          persist: false,
          duration: 7000,
        });
        if (succeeded.length > 0) dispatch(ActionCreators.clearHistory());
        return { succeeded, failed };
      } catch (error) {
        console.error("Error deleting media:", error);
        setPendingDeletionIds((current) => {
          const next = new Set(current);
          rows.forEach((row) => next.delete(row.id));
          return next;
        });
        updateToast(toastId, {
          message: "Media could not be deleted.",
          variant: "error",
          persist: false,
          duration: 7000,
        });
        return { succeeded: [], failed: rows };
      }
    },
    [db, dispatch, removeMediaRowsAfterSweep, updateToast],
  );

  const handleConfirmDelete = async () => {
    if (deleteConfirmLockRef.current) return;
    deleteConfirmLockRef.current = true;
    setIsDeleteInProgress(true);
    const deletingMultiple = isDeletingMultiple;
    const singleTarget = mediaToDelete;
    const rows = deletingMultiple
      ? list.filter((item) => selectedMediaIds.has(item.id))
      : singleTarget
        ? [singleTarget]
        : [];
    if (rows.length === 0) {
      deleteConfirmLockRef.current = false;
      setIsDeleteInProgress(false);
      dismissDeleteModal();
      return;
    }
    const itemLabel = rows.length === 1 ? "item" : "items";
    const toastId = showToast({
      message: `Deleting ${rows.length} ${itemLabel}...`,
      variant: "info",
      persist: true,
    });
    setPendingDeletionIds(
      (current) => new Set([...current, ...rows.map((row) => row.id)]),
    );
    clearSelection();
    // Dismiss immediately so a long reference sweep cannot leave Confirm locked.
    dismissDeleteModal();
    try {
      await finishOptimisticDeletion(rows, toastId);
    } finally {
      deleteConfirmLockRef.current = false;
      setIsDeletingMultiple(false);
      setIsDeleteInProgress(false);
    }
  };

  const handleCancelDelete = () => {
    if (isDeleteInProgress) return;
    dismissDeleteModal();
  };

  const addNewBackground = ({
    public_id,
    secure_url,
    playback_url,
    resource_type,
    created_at,
    format,
    height,
    width,
    original_filename,
    frame_rate,
    duration,
    is_audio,
    canvaImportKey,
    canvaSource,
  }: mediaInfoType): MediaType | undefined => {
    if (isGuestSession) {
      notifyMediaAction(
        "Guest mode uses sample media only. Sign in to upload images or videos.",
        "error",
      );
      return undefined;
    }
    if (
      canvaImportKey &&
      list.some((mediaItem) => mediaItem.canvaImportKey === canvaImportKey)
    ) {
      notifyMediaAction("That Canva page is already in Media.", "error");
      return undefined;
    }
    let placeholderImage = "";
    let thumbnailUrl = "";
    if (resource_type === "video") {
      // replace extension to get a static image:
      placeholderImage = secure_url.replace(/\.[^.]*$/, ".png");
      const smallVideo =
        cloud?.video(public_id).resize(fill().width(250)).toURL() || "";
      thumbnailUrl = smallVideo
        .replace(/\?.*$/, "") // Remove query string
        .replace(/\/([^/]+)$/, "/$1.png");
    } else {
      thumbnailUrl =
        cloud?.image(public_id).resize(fill().width(250)).toURL() || "";
    }

    const newMedia: MediaType = {
      path: "",
      createdAt: created_at,
      updatedAt: created_at,
      format,
      height,
      width,
      publicId: public_id,
      name: normalizeMediaLibraryStoredName(original_filename),
      type: resource_type,
      id: generateRandomId(),
      background: playback_url || secure_url,
      thumbnail: thumbnailUrl,
      placeholderImage,
      frameRate: frame_rate,
      duration,
      hasAudio: is_audio,
      source: "cloudinary",
      folderId: uploadTargetFolderId,
      ...(canvaImportKey ? { canvaImportKey } : {}),
      ...(canvaSource ? { canvaSource } : {}),
    };

    dispatch(addItemToMediaList(newMedia));
    return newMedia;
  };

  const createCanvaDeckItemFromMedia = useCallback(
    async (pages: MediaType[], designTitle: string) => {
      if (!db || pages.length === 0) return;
      // Prefer live list entries so refreshed Canva backgrounds are current.
      const resolvedPages = pages.map(
        (page) => list.find((mediaItem) => mediaItem.id === page.id) ?? page,
      );
      try {
        const newItem = await createNewFreeForm({
          name: designTitle || "Canva presentation",
          text: "",
          list: allItemsList,
          db,
          background: resolvedPages[0].background,
          mediaInfo: resolvedPages[0],
          brightness: defaultFreeFormBackgroundBrightness,
          overflow: defaultFreeFormFontMode,
          emptyBodyText: true,
          slideDefs: resolvedPages.map((page, index) => ({
            name: `Page ${index + 1}`,
            background: page.background,
            mediaInfo: page,
          })),
        });
        const listItem = {
          name: newItem.name,
          type: newItem.type,
          background: newItem.background,
          _id: newItem._id,
          listId: "",
        };
        dispatch(setActiveItem(newItem));
        const addedAction = dispatch(addItemToItemList(listItem));
        dispatch(addItemToAllItemsList(listItem));
        navigate(
          getControllerItemPath(
            { _id: newItem._id, listId: addedAction.payload.listId },
            controllerBasePath,
          ),
        );
        showToast(
          `Custom item "${truncatedMediaToastLabel({ name: newItem.name })}" created with ${resolvedPages.length} slides.`,
          "success",
        );
      } catch {
        showToast(
          "Canva media was imported, but the custom item could not be created. Try Create custom item from Media.",
          "error",
        );
      }
    },
    [
      allItemsList,
      controllerBasePath,
      db,
      defaultFreeFormBackgroundBrightness,
      defaultFreeFormFontMode,
      dispatch,
      list,
      navigate,
      showToast,
    ],
  );

  const addMuxVideo = ({
    playbackId,
    assetId,
    playbackUrl,
    thumbnailUrl,
    name,
    canvaImportKey,
    canvaSource,
  }: MuxUploadResult) => {
    if (isGuestSession) {
      notifyMediaAction(
        "Guest mode uses sample media only. Sign in to upload videos.",
        "error",
      );
      return;
    }
    if (
      canvaImportKey &&
      list.some((mediaItem) => mediaItem.canvaImportKey === canvaImportKey)
    ) {
      notifyMediaAction("That Canva video is already in Media.", "error");
      return;
    }
    const currentTime = new Date().toISOString();

    const newMedia: MediaType = {
      path: "",
      createdAt: currentTime,
      updatedAt: currentTime,
      format: "m3u8",
      height: 1920,
      width: 1080,
      publicId: playbackId,
      name: normalizeMediaLibraryStoredName(name),
      type: "video",
      id: generateRandomId(),
      background: playbackUrl,
      thumbnail: thumbnailUrl,
      placeholderImage: thumbnailUrl,
      source: "mux",
      muxPlaybackId: playbackId,
      muxAssetId: assetId,
      folderId: uploadTargetFolderId,
      ...(canvaImportKey ? { canvaImportKey } : {}),
      ...(canvaSource ? { canvaSource } : {}),
    };

    dispatch(addItemToMediaList(newMedia));
    return newMedia;
  };

  const refreshCanvaImage = useCallback(
    async (info: mediaInfoType, mediaId: string) => {
      const current = currentMediaListRef.current.find(
        (mediaItem) => mediaItem.id === mediaId,
      );
      if (!current || !info.canvaImportKey || !info.canvaSource) return;
      const thumbnail =
        cloud?.image(info.public_id).resize(fill().width(250)).toURL() ||
        info.thumbnail_url ||
        info.secure_url;
      const nextMedia: MediaType = {
        ...current,
        updatedAt: new Date().toISOString(),
        format: info.format || current.format,
        height: info.height ?? current.height,
        width: info.width ?? current.width,
        publicId: info.public_id || current.publicId,
        type: "image",
        background: info.secure_url || current.background,
        thumbnail: thumbnail || current.thumbnail,
        placeholderImage: "",
        source: "cloudinary",
        canvaImportKey: info.canvaImportKey,
        canvaSource: info.canvaSource,
      };
      await commitCanvaReplacement(current, nextMedia);
    },
    [cloud, commitCanvaReplacement],
  );

  const refreshCanvaVideo = useCallback(
    async (info: MuxUploadResult, mediaId: string) => {
      const current = currentMediaListRef.current.find(
        (mediaItem) => mediaItem.id === mediaId,
      );
      if (!current || !info.canvaImportKey || !info.canvaSource) return;
      const nextMedia: MediaType = {
        ...current,
        updatedAt: new Date().toISOString(),
        format: "m3u8",
        height: current.height || 1920,
        width: current.width || 1080,
        publicId: info.playbackId,
        type: "video",
        background: info.playbackUrl,
        thumbnail: info.thumbnailUrl,
        placeholderImage: info.thumbnailUrl,
        source: "mux",
        muxPlaybackId: info.playbackId,
        muxAssetId: info.assetId,
        canvaImportKey: info.canvaImportKey,
        canvaSource: info.canvaSource,
      };
      await commitCanvaReplacement(current, nextMedia);
    },
    [commitCanvaReplacement],
  );

  const requestMediaUpload = useCallback(() => {
    mediaUploadInputRef.current?.openModal();
  }, []);

  const handleProviderRetry = async () => {
    setProviderRetryBusy(true);
    try {
      const failed = await deleteFromProviders(providerRetryRows);
      if (failed.length === 0) {
        setShowProviderRetryModal(false);
        setProviderRetryRows([]);
      } else {
        setProviderRetryRows(failed);
      }
    } finally {
      setProviderRetryBusy(false);
    }
  };

  const handleDismissProviderRetry = () => {
    if (providerRetryBusy) return;
    setShowProviderRetryModal(false);
    setProviderRetryRows([]);
  };

  const handleRenameMediaSave = useCallback(
    (name: string) => {
      dispatch(
        updateMediaItemFields({
          id: selectedMedia.id,
          patch: {
            name,
            updatedAt: new Date().toISOString(),
          },
        }),
      );
    },
    [dispatch, selectedMedia.id],
  );

  const handleActionBarMediaRenameOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        ignoreRenameAutoCloseUntilRef.current = Date.now() + 750;
        setMoveToNewFolderPopoverOpen(false);
        setRenamePopoverOpen(true);
        return;
      }
      handleRenamePopoverOpenChange(false);
    },
    [
      setRenamePopoverOpen,
      setMoveToNewFolderPopoverOpen,
      handleRenamePopoverOpenChange,
    ],
  );

  const handleActionBarMoveToNewFolderOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        ignoreRenameAutoCloseUntilRef.current = Date.now() + 750;
        setRenamePopoverOpen(false);
        setMoveSelectKey((k) => k + 1);
        setMoveToNewFolderPopoverOpen(true);
        return;
      }
      handleMoveToNewFolderPopoverOpenChange(false);
    },
    [
      setRenamePopoverOpen,
      setMoveSelectKey,
      setMoveToNewFolderPopoverOpen,
      handleMoveToNewFolderPopoverOpenChange,
    ],
  );

  return {
    dispatch,
    isPanelVariant,
    isGuestSession,
    isMediaExpanded,
    setSearchTerm,
    mediaUploadInputRef,
    uploadProgress,
    requestMediaUpload,
    addNewBackground,
    createCanvaDeckItemFromMedia,
    addMuxVideo,
    refreshCanvaImage,
    refreshCanvaVideo,
    handleUploadActiveChange,
    isMediaLoading,
    hasMediaLoadError,
    isMediaReadOnly,
    searchTerm,
    showAll,
    handleShowAllChange,
    actionBarDetails,
    newFolderOpen,
    setNewFolderOpen,
    folders,
    list,
    parentForNewFolder,
    applyFoldersAndList,
    folderRenameOpen,
    setFolderRenameOpen,
    selectedRealFolder,
    setFolderDeleteOpen,
    handleRequestFolderDelete,
    handleActionBarMediaRenameOpenChange,
    handleRenameMediaSave,
    closeMediaRenamePopover: () => setRenamePopoverOpen(false),
    mediaRenameOpen,
    selectedMediaIds,
    selectedMedia,
    mediaBarActions,
    slideBackgroundFeedbackId,
    moveSelectOptions,
    handleMoveTo,
    moveSelectKey,
    selectedLibraryFilter,
    uploadTargetFolderId,
    navigateToFolder,
    handleDeleteFolderSubtree,
    handleDeleteFolderKeepContents,
    folderDeleteOpen,
    filteredList,
    showNamesInPanelGrid,
    childFolders,
    canGoUp,
    handleGoUp,
    handleMediaClick,
    enterMediaMultiSelectMode,
    mediaMultiSelectMode,
    moveToNewFolderOpen,
    handleActionBarMoveToNewFolderOpenChange,
    closeMoveToNewFolderPopover: () => setMoveToNewFolderPopoverOpen(false),
    clearSelection,
    setMoveSelectKey,
    showDeleteModal,
    handleCancelDelete,
    handleConfirmDelete,
    isDeleteInProgress,
    isDeletingMultiple,
    mediaToDelete,
    showProviderRetryModal,
    providerRetryRows,
    providerRetryBusy,
    handleProviderRetry,
    handleDismissProviderRetry,
    isFullscreen,
    setIsFullscreen,
    routeKey,
    pageMode,
    previewMedia,
    showName,
    setShowName,
    typeFilter,
    setTypeFilter,
    originFilter,
    setOriginFilter,
    showOtherDeviceLocalMedia,
    setShowOtherDeviceLocalMedia,
    showOtherDeviceLocalMediaToggle,
    setPreviewMedia,
    setMediaToDelete,
    setShowDeleteModal,
    openSingleDeleteModal,
    openMultiDeleteModal,
    mediaItemsPerRow,
    mediaListRef,
    mediaGridRef,
    canDragMediaToSlides,
    orderedSelectedMediaIds,
  };
}
