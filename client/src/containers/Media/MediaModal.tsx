import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "../../context/toastContext";
import type { ToastVariant } from "../../components/Toast/Toast";
import { useLocation } from "react-router-dom";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import Toggle from "../../components/Toggle/Toggle";
import {
  Eye,
  X,
  Minus,
  Maximize,
  Minimize,
  Plus,
  ImageUp,
  HardDrive,
  MonitorUp,
  Video,
  Folder,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Cable,
  LayoutGrid,
  MonitorSmartphone,
} from "lucide-react";
import { useDispatch, useSelector, useMediaSelection } from "../../hooks";
import type { MediaFolder, MediaRouteKey, MediaType } from "../../types";
import cn from "classnames";
import { RootState } from "../../store/store";
import { updateMediaItemFields } from "../../store/mediaSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { MediaUploadInputRef } from "./MediaUploadInput";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import {
  useCachedMediaUrl,
  useCachedVideoUrl,
} from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import LocalVideoInputView from "../../components/DisplayWindow/LocalVideoInputView";
import {
  buildLocalVideoInputPresentation,
  isDesktopCaptureKind,
} from "../../utils/localVideoInput";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import {
  MEDIA_LIBRARY_ROOT_VIEW,
  getChildFolders,
  isMediaLibraryFolderEmpty,
  moveMediaToFolder,
} from "../../utils/mediaFolderMutations";
import {
  buildFolderTreeSelectOptions,
  MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER,
} from "../../utils/mediaLibraryFolderOptions";
import MediaLibraryToolbar from "./MediaLibraryToolbar";
import MediaTypeFilter, { type MediaTypeFilterValue } from "./MediaTypeFilter";
import MediaOriginFilter from "./MediaOriginFilter";
import type { MediaOriginFilterValue } from "./mediaLibraryOrigin";
import { calculateMediaLibraryGridColumns } from "./mediaLibraryGridColumns";
import { Slider } from "../../components/ui/Slider";
import { VirtualMediaGrid } from "./VirtualMediaGrid";
import { getCanvaMediaSource } from "./canvaMediaSource";
import { useLocalMediaCloudShare } from "./localMediaCloudShare";
import MediaLibraryActionBar from "./MediaLibraryActionBar";
import {
  MediaLibraryFolderModals,
  MediaLibraryNewFolderForm,
  MediaLibraryRenameFolderForm,
  MediaLibraryRenameMediaForm,
} from "./MediaLibraryFolderModals";
import {
  buildMediaActionRouteFlags,
  buildMediaLibraryBarActions,
} from "./mediaLibraryActions";
import {
  formatMediaDimensionsLine,
  summarizeMultiSelectMetadata,
} from "./mediaLibraryMeta";
import {
  MEDIA_LIBRARY_ORANGE_FOLDER_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";

type MediaModalGridZoomSliderProps = {
  modalZoomLevel: number;
  modalZoomSliderMax: number;
  disabled: boolean;
  onZoomChange: (next: number) => void;
};

function MediaModalGridZoomSlider({
  modalZoomLevel,
  modalZoomSliderMax,
  disabled,
  onZoomChange,
}: MediaModalGridZoomSliderProps) {
  const safeMax = Math.max(modalZoomSliderMax, 1);
  const value = Math.min(Math.max(modalZoomLevel, 0), modalZoomSliderMax);
  const changeZoomBy = (delta: number) => {
    onZoomChange(Math.min(safeMax, Math.max(0, value + delta)));
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="tertiary"
        className="h-7 w-7 min-h-7 max-md:min-h-7 justify-center p-0"
        svg={ZoomOut}
        title="Zoom out"
        aria-label="Zoom out media grid"
        disabled={disabled || value <= 0}
        onClick={() => changeZoomBy(-1)}
      />
      <div className="w-24 shrink-0 sm:w-36">
        <Slider
          className="w-full"
          value={[value]}
          min={0}
          max={safeMax}
          step={1}
          onValueChange={(v: number[]) => onZoomChange(v[0] ?? 0)}
          disabled={disabled}
          aria-label="Media grid zoom"
        />
      </div>
      <Button
        variant="tertiary"
        className="h-7 w-7 min-h-7 max-md:min-h-7 justify-center p-0"
        svg={ZoomIn}
        title="Zoom in"
        aria-label="Zoom in media grid"
        disabled={disabled || value >= safeMax}
        onClick={() => changeZoomBy(1)}
      />
    </div>
  );
}

type MediaModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Items visible in the grid (search + folder + type applied by parent). */
  mediaList: MediaType[];
  fullList: MediaType[];
  folders: MediaFolder[];
  routeKey: MediaRouteKey;
  pageMode?: "default" | "overlayController";
  selectedLibraryFilter: string | null;
  onSelectLibraryFilter: (folderId: string | null) => void;
  onUpdateFoldersAndList: (next: {
    list: MediaType[];
    folders: MediaFolder[];
  }) => void;
  onDeleteFolderKeepContents: (folderId: string) => void;
  onDeleteFolderSubtree: (folderId: string) => boolean | Promise<boolean>;
  selectedMedia: MediaType;
  selectedMediaIds: Set<string>;
  previewMedia: MediaType | null;
  searchTerm: string;
  showName: boolean;
  typeFilter: MediaTypeFilterValue;
  onTypeFilterChange: (v: MediaTypeFilterValue) => void;
  originFilter: MediaOriginFilterValue;
  onOriginFilterChange: (v: MediaOriginFilterValue) => void;
  showOtherDeviceLocalMedia?: boolean;
  onShowOtherDeviceLocalMediaChange?: (next: boolean) => void;
  showOtherDeviceLocalMediaToggle?: boolean;
  onMediaClick: (
    e: React.MouseEvent,
    mediaItem: MediaType,
    index: number,
  ) => void;
  onSearchChange: (value: string) => void;
  onShowNameToggle: () => void;
  onDeleteClick: (mediaItem: MediaType) => void;
  onDeleteMultipleClick: (selectedIds: Set<string>) => void;
  onPreviewChange: (media: MediaType | null) => void;
  mediaUploadInputRef?: React.MutableRefObject<MediaUploadInputRef | null>;
  uploadProgress?: { isUploading: boolean; progress: number };
  onAddMediaClick?: () => void;
  onAddVideoInput?: () => void;
  /** Screens and windows on this computer, offered next to hardware inputs. */
  onAddScreenShare?: () => void;
  onRelinkVideoInput?: (media: MediaType) => void;
  onImportFromCanva?: (sourceMedia?: MediaType) => void;
  /** When true, adding media is blocked (library still loading or failed). */
  mediaUploadDisabled?: boolean;
  isGuestSession?: boolean;
};

const MediaModal = ({
  isOpen,
  onClose,
  mediaList,
  fullList,
  folders,
  pageMode = "default",
  selectedLibraryFilter,
  onSelectLibraryFilter,
  onUpdateFoldersAndList,
  onDeleteFolderKeepContents,
  onDeleteFolderSubtree,
  selectedMedia,
  selectedMediaIds,
  previewMedia,
  searchTerm,
  showName,
  typeFilter,
  onTypeFilterChange,
  originFilter,
  onOriginFilterChange,
  showOtherDeviceLocalMedia = false,
  onShowOtherDeviceLocalMediaChange,
  showOtherDeviceLocalMediaToggle = false,
  onMediaClick,
  onSearchChange,
  onShowNameToggle,
  onDeleteClick,
  onDeleteMultipleClick,
  mediaUploadInputRef,
  uploadProgress,
  onAddMediaClick,
  onAddVideoInput,
  onAddScreenShare,
  onRelinkVideoInput,
  onImportFromCanva,
  mediaUploadDisabled = false,
  isGuestSession = false,
}: MediaModalProps) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { showToast } = useToast();
  const { db } = useContext(ControllerInfoContext) || {};
  const { getBarAction: getLocalMediaCloudShareBarAction } =
    useLocalMediaCloudShare();

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

  const fullscreenAddMediaTitle = useMemo(() => {
    if (uploadProgress?.isUploading) {
      return `Uploading... ${Math.round(uploadProgress.progress)}%`;
    }
    return "Add Media";
  }, [uploadProgress?.isUploading, uploadProgress?.progress]);

  const addMediaMenu = mediaUploadInputRef ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="tertiary"
          svg={Plus}
          title={fullscreenAddMediaTitle}
          aria-label="Add media"
          disabled={uploadProgress?.isUploading || mediaUploadDisabled}
        >
          {uploadProgress?.isUploading
            ? `${Math.round(uploadProgress.progress)}%`
            : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onAddMediaClick ? (
          <DropdownMenuItem
            disabled={mediaUploadDisabled}
            onSelect={() => onAddMediaClick()}
          >
            <HardDrive /> Add files
          </DropdownMenuItem>
        ) : null}
        {onAddVideoInput ? (
          <DropdownMenuItem
            disabled={mediaUploadDisabled}
            onSelect={onAddVideoInput}
          >
            <Video /> Add video input
          </DropdownMenuItem>
        ) : null}
        {onAddScreenShare ? (
          <DropdownMenuItem
            disabled={mediaUploadDisabled}
            onSelect={onAddScreenShare}
          >
            <MonitorUp /> Add screen or window
          </DropdownMenuItem>
        ) : null}
        {onImportFromCanva ? (
          <DropdownMenuItem
            disabled={mediaUploadDisabled || isGuestSession}
            onSelect={() => onImportFromCanva()}
          >
            <ImageUp /> Import from Canva
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

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
  const { selectedPreference, selectedQuickLink } = useSelector(
    (state: RootState) => state.undoable.present.preferences,
  );

  const [modalZoomLevel, setModalZoomLevel] = useState(0);
  const [modalLayoutBaseCols, setModalLayoutBaseCols] = useState(() =>
    typeof window === "undefined"
      ? 4
      : calculateMediaLibraryGridColumns(window.innerWidth),
  );
  const modalGridRef = useRef<HTMLElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const calculatedGridCols = useMemo(() => {
    const maxZ = Math.max(0, modalLayoutBaseCols - 2);
    const z = Math.min(modalZoomLevel, maxZ);
    return Math.max(2, modalLayoutBaseCols - z);
  }, [modalLayoutBaseCols, modalZoomLevel]);

  const modalZoomSliderMax = Math.max(0, modalLayoutBaseCols - 2);

  const filteredList = useMemo(() => {
    if (typeFilter === "all") return mediaList;
    return mediaList.filter((item) => item.type === typeFilter);
  }, [mediaList, typeFilter]);

  // Use shared selection hook for modal - independent from Media component
  const {
    selectedMedia: modalSelectedMedia,
    selectedMediaIds: modalSelectedMediaIds,
    previewMedia: modalPreviewMedia,
    mediaMultiSelectMode: modalMediaMultiSelectMode,
    setSelectedMedia: setModalSelectedMedia,
    setSelectedMediaIds: setModalSelectedMediaIds,
    setPreviewMedia: setModalPreviewMedia,
    handleMediaClick: handleModalMediaClick,
    enterMediaMultiSelectMode: enterModalMediaMultiSelectMode,
    clearSelection: clearModalSelection,
    reconcileSelectionWithMediaList: reconcileModalSelectionWithMediaList,
  } = useMediaSelection({
    mediaList: fullList,
    filteredList,
    enableRangeSelection: true,
  });

  const handleModalDeleteClick = useCallback(
    (mediaItem: MediaType) => {
      onMediaClick(
        { ctrlKey: false, metaKey: false, shiftKey: false } as React.MouseEvent,
        mediaItem,
        fullList.findIndex((item) => item.id === mediaItem.id),
      );
      onDeleteClick(mediaItem);
    },
    [fullList, onDeleteClick, onMediaClick],
  );

  const handleModalDeleteMultipleClick = useCallback(() => {
    onDeleteMultipleClick(modalSelectedMediaIds);
  }, [modalSelectedMediaIds, onDeleteMultipleClick]);

  const wasModalOpenRef = useRef(false);
  const lastBrowseFolderIdRef = useRef<string>(MEDIA_LIBRARY_ROOT_VIEW);
  const [folderRenameOpen, setFolderRenameOpen] = useState(false);
  const [mediaRenameOpen, setMediaRenameOpen] = useState(false);
  const ignoreRenameAutoCloseUntilRef = useRef(0);
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moveSelectKey, setMoveSelectKey] = useState(0);
  const [moveToNewFolderOpen, setMoveToNewFolderOpen] = useState(false);

  const setMoveToNewFolderPopoverOpen = useCallback((open: boolean) => {
    setMoveToNewFolderOpen(open);
  }, []);

  useEffect(() => {
    if (selectedLibraryFilter !== null) {
      lastBrowseFolderIdRef.current = selectedLibraryFilter;
    }
  }, [selectedLibraryFilter]);

  useEffect(() => {
    setFolderRenameOpen(false);
  }, [selectedLibraryFilter]);

  useEffect(() => {
    if (modalSelectedMediaIds.size !== 1) setMediaRenameOpen(false);
  }, [modalSelectedMediaIds.size]);

  useEffect(() => {
    if (modalSelectedMediaIds.size === 0) setMoveToNewFolderPopoverOpen(false);
  }, [modalSelectedMediaIds.size, setMoveToNewFolderPopoverOpen]);

  const handleRenamePopoverOpenChange = useCallback((open: boolean) => {
    if (!open && Date.now() < ignoreRenameAutoCloseUntilRef.current) {
      return;
    }
    setMediaRenameOpen(open);
  }, []);

  const handleMoveToNewFolderPopoverOpenChange = useCallback(
    (open: boolean) => {
      if (!open && Date.now() < ignoreRenameAutoCloseUntilRef.current) {
        return;
      }
      setMoveToNewFolderPopoverOpen(open);
    },
    [setMoveToNewFolderPopoverOpen],
  );

  const handleActionBarMoveToNewFolderOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        ignoreRenameAutoCloseUntilRef.current = Date.now() + 750;
        setMediaRenameOpen(false);
        setMoveSelectKey((k) => k + 1);
        setMoveToNewFolderPopoverOpen(true);
        return;
      }
      handleMoveToNewFolderPopoverOpenChange(false);
    },
    [
      setMediaRenameOpen,
      setMoveSelectKey,
      setMoveToNewFolderPopoverOpen,
      handleMoveToNewFolderPopoverOpenChange,
    ],
  );

  const showAll = selectedLibraryFilter === null;
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

  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      clearModalSelection();
      onSelectLibraryFilter(folderId);
    },
    [clearModalSelection, onSelectLibraryFilter],
  );

  const handleRequestFolderDelete = useCallback(() => {
    if (!selectedRealFolder) return;
    if (isMediaLibraryFolderEmpty(selectedRealFolder.id, folders, fullList)) {
      onDeleteFolderKeepContents(selectedRealFolder.id);
      navigateToFolder(selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
      return;
    }
    setFolderDeleteOpen(true);
  }, [
    selectedRealFolder,
    folders,
    fullList,
    onDeleteFolderKeepContents,
    navigateToFolder,
  ]);

  const handleNewFolderCreated = useCallback(
    (nf: MediaFolder) => {
      if (!showAll) return;
      navigateToFolder(nf.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
    },
    [showAll, navigateToFolder],
  );

  const handleShowAllChange = useCallback(
    (next: boolean) => {
      if (next) {
        if (selectedLibraryFilter !== null) {
          lastBrowseFolderIdRef.current = selectedLibraryFilter;
        }
        onSelectLibraryFilter(null);
      } else {
        onSelectLibraryFilter(lastBrowseFolderIdRef.current);
      }
    },
    [onSelectLibraryFilter, selectedLibraryFilter],
  );

  const handleGoUp = useCallback(() => {
    if (!selectedRealFolder) return;
    navigateToFolder(selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW);
  }, [navigateToFolder, selectedRealFolder]);

  const handleMoveTo = useCallback(
    (targetFolderId: string | null) => {
      if (modalSelectedMediaIds.size === 0) return;
      onUpdateFoldersAndList({
        folders,
        list: moveMediaToFolder(
          modalSelectedMediaIds,
          targetFolderId,
          fullList,
        ),
      });
      setMoveSelectKey((k) => k + 1);
      clearModalSelection();
    },
    [
      modalSelectedMediaIds,
      folders,
      fullList,
      onUpdateFoldersAndList,
      clearModalSelection,
    ],
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
      primaryMedia: modalSelectedMedia,
      hasMultipleSelection: modalSelectedMediaIds.size > 1,
      selectedCount: modalSelectedMediaIds.size,
      dispatch,
      onDeleteSingle: () => {
        handleModalDeleteClick(modalSelectedMedia);
      },
      onDeleteMultiple: handleModalDeleteMultipleClick,
      itemSlideContext,
      notify: notifyMediaAction,
      onItemSlideBackgroundFeedback: triggerSlideBackgroundFeedback,
    });
    if (
      modalSelectedMediaIds.size === 1 &&
      getCanvaMediaSource(modalSelectedMedia) &&
      onImportFromCanva
    ) {
      actions.push({
        id: "manage-canva-source",
        label: "Manage Canva source",
        icon: <ExternalLink className="size-4" />,
        onClick: () => onImportFromCanva(modalSelectedMedia),
      });
    }
    if (
      modalSelectedMediaIds.size === 1 &&
      modalSelectedMedia.localVideoInput &&
      onRelinkVideoInput
    ) {
      const isShare = isDesktopCaptureKind(
        modalSelectedMedia.localVideoInput.captureKind,
      );
      actions.push({
        id: "relink-video-input",
        label: isShare ? "Choose share again" : "Relink input",
        icon: isShare ? (
          <MonitorUp className="size-4" />
        ) : (
          <Cable className="size-4" />
        ),
        onClick: () => onRelinkVideoInput(modalSelectedMedia),
      });
    }
    const cloudShareAction = getLocalMediaCloudShareBarAction(
      modalSelectedMedia,
      modalSelectedMediaIds.size,
    );
    if (cloudShareAction) actions.push(cloudShareAction);
    return actions;
  }, [
    routeFlags,
    db,
    isLoading,
    selectedPreference,
    selectedQuickLink,
    selectedOverlay,
    modalSelectedMedia,
    modalSelectedMediaIds.size,
    dispatch,
    handleModalDeleteClick,
    handleModalDeleteMultipleClick,
    itemSlideContext,
    notifyMediaAction,
    triggerSlideBackgroundFeedback,
    onImportFromCanva,
    onRelinkVideoInput,
    getLocalMediaCloudShareBarAction,
  ]);

  const actionBarDetails = useMemo(() => {
    const headerLine = (primary: string, title?: string) => (
      <div
        className="min-w-0 truncate text-xs font-medium text-white"
        title={title ?? primary}
      >
        {primary}
      </div>
    );

    if (modalSelectedMediaIds.size === 0) {
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
    if (modalSelectedMediaIds.size === 1) {
      const m = modalSelectedMedia;
      const shown = m.name.includes("/")
        ? m.name.split("/").slice(1).join("/")
        : m.name;
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
    const items = fullList.filter((x) => modalSelectedMediaIds.has(x.id));
    const multiMeta = summarizeMultiSelectMetadata(items);
    const showSelectionAccent =
      modalMediaMultiSelectMode || modalSelectedMediaIds.size > 1;
    return (
      <div
        className="min-w-0 truncate text-xs"
        title={
          multiMeta
            ? `${modalSelectedMediaIds.size} selected · ${multiMeta}`
            : `${modalSelectedMediaIds.size} selected`
        }
      >
        <span
          className={
            showSelectionAccent
              ? "font-medium text-cyan-400"
              : "font-medium text-white"
          }
        >
          {modalSelectedMediaIds.size} selected
        </span>
        {multiMeta ? (
          <span className="font-normal text-gray-400"> · {multiMeta}</span>
        ) : null}
      </div>
    );
  }, [
    fullList,
    modalSelectedMedia,
    modalSelectedMediaIds,
    selectedLibraryFilter,
    selectedRealFolder?.name,
    modalMediaMultiSelectMode,
  ]);

  const parentForNewFolder =
    selectedLibraryFilter && selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? selectedLibraryFilter
      : null;

  const resolvedPreviewImageUrl = useCachedMediaUrl(
    modalPreviewMedia?.type === "image"
      ? modalPreviewMedia.background
      : undefined,
  );
  const resolvedPreviewVideoUrl = useCachedVideoUrl(
    modalPreviewMedia?.type === "video"
      ? modalPreviewMedia.background
      : undefined,
  );
  const localPreviewImage = useLocalImageUrl(modalPreviewMedia?.localImage);
  const localPreviewVideo = useLocalVideoFileUrl(
    modalPreviewMedia?.localVideoFile,
  );
  const localVideoInputPreview = useMemo(
    () =>
      modalPreviewMedia?.localVideoInput
        ? buildLocalVideoInputPresentation(
          modalPreviewMedia.localVideoInput,
          getOrCreateDeviceId(),
          getTrustedDeviceLabel(),
        )
        : undefined,
    [modalPreviewMedia?.localVideoInput],
  );

  useEffect(() => {
    if (!isOpen || !modalGridRef.current) return;
    const el = modalGridRef.current;
    const updateLayoutBaseCols = () => {
      const width = el.offsetWidth;
      setModalLayoutBaseCols(calculateMediaLibraryGridColumns(width));
    };
    updateLayoutBaseCols();
    const resizeObserver = new ResizeObserver(updateLayoutBaseCols);
    resizeObserver.observe(el);
    window.addEventListener("resize", updateLayoutBaseCols);
    return () => {
      window.removeEventListener("resize", updateLayoutBaseCols);
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  useEffect(() => {
    const maxZ = Math.max(0, modalLayoutBaseCols - 2);
    setModalZoomLevel((z) => Math.min(z, maxZ));
  }, [modalLayoutBaseCols]);

  // Initialize modal selection from the parent only on open; avoid snapping back when parent props refresh while open.
  useEffect(() => {
    if (isOpen && !wasModalOpenRef.current) {
      setModalSelectedMedia(selectedMedia);
      setModalSelectedMediaIds(new Set(selectedMediaIds));
      setModalPreviewMedia(previewMedia);
    }
    if (!isOpen && wasModalOpenRef.current) {
      clearModalSelection();
      setIsExpanded(false);
    }
    wasModalOpenRef.current = isOpen;
  }, [
    isOpen,
    selectedMedia,
    selectedMediaIds,
    previewMedia,
    setModalSelectedMedia,
    setModalSelectedMediaIds,
    setModalPreviewMedia,
    clearModalSelection,
  ]);

  // Modal keeps its own selection; after deletes the list updates but parent clearSelection does not reach here.
  useEffect(() => {
    if (!isOpen) return;
    reconcileModalSelectionWithMediaList(fullList);
  }, [isOpen, fullList, reconcileModalSelectionWithMediaList]);

  // Reset expanded mode if preview media changes to video or is cleared
  useEffect(() => {
    if (!modalPreviewMedia || modalPreviewMedia.type !== "image") {
      setIsExpanded(false);
    }
  }, [modalPreviewMedia]);

  useEffect(() => {
    if (!isOpen) setMoveToNewFolderPopoverOpen(false);
  }, [isOpen, setMoveToNewFolderPopoverOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Media Library"
      size="full"
      contentPadding="p-0"
      surfaceClassName="relative flex w-full min-h-0 flex-1 flex-col overflow-hidden bg-homepage-canvas shadow-2xl max-md:h-full max-md:max-h-[95vh] max-md:rounded-none rounded-lg"
      headerClassName="bg-homepage-canvas px-4 pb-0 pt-2"
      titleClassName="text-lg"
    >
      <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {/* Expanded fullscreen view */}
        <div
          className={cn(
            "absolute inset-0 bg-black/55 transition-all duration-300 ease-in-out",
            isExpanded &&
              modalPreviewMedia &&
              modalPreviewMedia.type === "image"
              ? "opacity-100 z-10"
              : "opacity-0 z-0 pointer-events-none",
          )}
        >
          {modalPreviewMedia && modalPreviewMedia.type === "image" && (
            <>
              <div className="absolute top-2 right-2 z-10 flex gap-2">
                <Button
                  variant="secondary"
                  svg={Minimize}
                  onClick={() => setIsExpanded(false)}
                  title="Exit Expanded View"
                />
                <Button
                  variant="secondary"
                  svg={Minus}
                  onClick={() => {
                    setIsExpanded(false);
                    setModalPreviewMedia(null);
                  }}
                  title="Hide Preview"
                />
              </div>
              <img
                src={resolvedPreviewImageUrl ?? modalPreviewMedia.background}
                alt={modalPreviewMedia.name}
                className="w-full h-full object-contain transition-transform duration-300 ease-in-out"
                style={{
                  transform: isExpanded ? "scale(1)" : "scale(0.95)",
                }}
              />
            </>
          )}
        </div>

        {/* Normal view */}
        <div
          className={cn(
            "flex h-full min-h-0 flex-col transition-all duration-300 ease-in-out",
            isExpanded &&
              modalPreviewMedia &&
              modalPreviewMedia.type === "image"
              ? "opacity-0 z-0 pointer-events-none"
              : "opacity-100 z-10",
          )}
        >
          <div
            className={cn(
              "relative w-full flex flex-col items-center gap-2 overflow-hidden border-b border-gray-500 bg-homepage-canvas px-4 py-1 transition-all duration-300 ease-in-out",
              modalPreviewMedia
                ? "h-[40vh] max-h-[40vh] shrink-0 opacity-100"
                : "h-0 shrink-0 opacity-0",
            )}
          >
            {modalPreviewMedia && (
              <div className="relative flex max-h-full w-full max-w-full flex-1 min-h-0 items-center justify-center">
                <div className="relative aspect-video max-h-full w-full max-w-full overflow-hidden rounded-md bg-black/25">
                  <div className="absolute right-2 top-2 z-10 flex gap-2">
                    {modalPreviewMedia.type === "image" && (
                      <Button
                        variant="secondary"
                        svg={Maximize}
                        onClick={() => setIsExpanded(true)}
                        title="Expand to Fill Modal"
                      />
                    )}
                    <Button
                      variant="secondary"
                      svg={Minus}
                      onClick={() => setModalPreviewMedia(null)}
                      title="Hide Preview"
                    />
                  </div>
                  <div className="flex h-full w-full items-center justify-center">
                    {localVideoInputPreview ? (
                      <LocalVideoInputView
                        input={localVideoInputPreview}
                        playAudio={false}
                        captureEnabled
                        receiveHighQuality
                        publishPreview
                        showErrors
                      />
                    ) : modalPreviewMedia.type === "video" ? (
                      <video
                        src={
                          localPreviewVideo.isLocalVideoFile
                            ? localPreviewVideo.url
                            : (resolvedPreviewVideoUrl ??
                              modalPreviewMedia.background)
                        }
                        className="max-h-full max-w-full w-full h-full object-contain"
                        controls
                        autoPlay
                      />
                    ) : (
                      <img
                        src={
                          localPreviewImage.isLocalImage
                            ? localPreviewImage.url
                            : (resolvedPreviewImageUrl ??
                              modalPreviewMedia.background)
                        }
                        alt={modalPreviewMedia.name}
                        className="max-h-full max-w-full h-full w-full object-contain"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-black/60 px-4 py-2">
            <div className="flex flex-col gap-2 lg:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  type="text"
                  label="Search"
                  hideLabel
                  value={searchTerm}
                  onChange={(value) => onSearchChange(value as string)}
                  placeholder="Search by name"
                  className="flex min-w-0 flex-1 items-center gap-2"
                  inputWidth="w-full"
                  inputTextSize="text-sm"
                  svg={searchTerm ? X : undefined}
                  svgAction={() => onSearchChange("")}
                  svgActionAriaLabel="Clear search"
                  aria-label="Search media by name"
                />
                <Toggle
                  icon={Eye}
                  value={showName}
                  onChange={onShowNameToggle}
                />
                {mediaUploadInputRef ? (
                  <div className="shrink-0">{addMediaMenu}</div>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Toggle
                  label="Show all"
                  icon={LayoutGrid}
                  value={showAll}
                  onChange={handleShowAllChange}
                />
                <MediaOriginFilter
                  value={originFilter}
                  onChange={onOriginFilterChange}
                  className="min-w-0 flex-1"
                />
                {showOtherDeviceLocalMediaToggle &&
                  onShowOtherDeviceLocalMediaChange ? (
                  <Toggle
                    label="Other devices"
                    icon={MonitorSmartphone}
                    value={showOtherDeviceLocalMedia}
                    onChange={onShowOtherDeviceLocalMediaChange}
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <MediaTypeFilter
                  value={typeFilter}
                  onChange={onTypeFilterChange}
                  fullWidth
                />
                {modalZoomSliderMax > 0 ? (
                  <MediaModalGridZoomSlider
                    modalZoomLevel={modalZoomLevel}
                    modalZoomSliderMax={modalZoomSliderMax}
                    disabled={false}
                    onZoomChange={(next) => setModalZoomLevel(next)}
                  />
                ) : null}
              </div>
            </div>

            <div className="flex max-lg:hidden min-w-0 w-full flex-nowrap items-center gap-2">
              <MediaModalGridZoomSlider
                modalZoomLevel={modalZoomLevel}
                modalZoomSliderMax={modalZoomSliderMax}
                disabled={modalZoomSliderMax <= 0}
                onZoomChange={(next) => setModalZoomLevel(next)}
              />
              <MediaLibraryToolbar
                showAll={showAll}
                onShowAllChange={handleShowAllChange}
                typeFilter={typeFilter}
                onTypeFilterChange={onTypeFilterChange}
                originFilter={originFilter}
                onOriginFilterChange={onOriginFilterChange}
                showOtherDeviceLocalMedia={showOtherDeviceLocalMedia}
                onShowOtherDeviceLocalMediaChange={
                  onShowOtherDeviceLocalMediaChange
                }
                showOtherDeviceLocalMediaToggle={
                  showOtherDeviceLocalMediaToggle
                }
                className="mx-0 shrink-0 border-0 bg-transparent px-0 py-0"
              />
              <div className="flex min-h-10 min-w-0 flex-1 basis-0 items-center gap-2">
                <Input
                  type="text"
                  label="Search"
                  hideLabel
                  value={searchTerm}
                  onChange={(value) => onSearchChange(value as string)}
                  placeholder="Search by name"
                  className="min-w-0 w-full max-w-full flex-1"
                  inputWidth="w-full min-w-0"
                  inputTextSize="text-sm"
                  svg={searchTerm ? X : undefined}
                  svgAction={() => onSearchChange("")}
                  svgActionAriaLabel="Clear search"
                  aria-label="Search media by name"
                />
                <Toggle
                  icon={Eye}
                  value={showName}
                  onChange={onShowNameToggle}
                />
              </div>
              {mediaUploadInputRef && (
                <div className="shrink-0">{addMediaMenu}</div>
              )}
            </div>
          </div>

          <div className="w-full">
            <MediaLibraryActionBar
              className="mx-0 rounded-none border-x-0"
              detailsRow={actionBarDetails}
              showFolderActions={modalSelectedMediaIds.size === 0}
              showNewFolderAction={modalSelectedMediaIds.size > 0}
              folderNew={{
                open: newFolderOpen,
                onOpenChange: setNewFolderOpen,
                content: (
                  <MediaLibraryNewFolderForm
                    folders={folders}
                    list={fullList}
                    parentForNewFolder={parentForNewFolder}
                    onUpdateFoldersAndList={onUpdateFoldersAndList}
                    onFolderCreated={handleNewFolderCreated}
                    onClose={() => setNewFolderOpen(false)}
                  />
                ),
                contentClassName:
                  "w-72 border border-gray-600 bg-gray-900 p-3 text-white",
              }}
              folderRename={
                selectedRealFolder
                  ? {
                    open: folderRenameOpen,
                    onOpenChange: setFolderRenameOpen,
                    content: (
                      <MediaLibraryRenameFolderForm
                        folders={folders}
                        list={fullList}
                        folder={selectedRealFolder}
                        onUpdateFoldersAndList={onUpdateFoldersAndList}
                        onClose={() => setFolderRenameOpen(false)}
                      />
                    ),
                    contentClassName:
                      "w-72 border border-gray-600 bg-gray-900 p-3 text-white",
                  }
                  : null
              }
              onDeleteFolder={handleRequestFolderDelete}
              showFolderRenameDelete={Boolean(selectedRealFolder)}
              showMediaRename={modalSelectedMediaIds.size === 1}
              mediaRenameOpen={mediaRenameOpen}
              onMediaRenameOpenChange={(open) => {
                if (open) {
                  ignoreRenameAutoCloseUntilRef.current = Date.now() + 750;
                  setMoveToNewFolderPopoverOpen(false);
                  setMediaRenameOpen(true);
                  return;
                }
                handleRenamePopoverOpenChange(false);
              }}
              renameMediaContent={
                modalSelectedMediaIds.size === 1 ? (
                  <MediaLibraryRenameMediaForm
                    media={modalSelectedMedia}
                    onSave={(name) => {
                      dispatch(
                        updateMediaItemFields({
                          id: modalSelectedMedia.id,
                          patch: {
                            name,
                            updatedAt: new Date().toISOString(),
                          },
                        }),
                      );
                    }}
                    onClose={() => setMediaRenameOpen(false)}
                  />
                ) : null
              }
              mediaActions={
                modalSelectedMediaIds.size > 0 ? mediaBarActions : []
              }
              slideBackgroundFeedbackId={slideBackgroundFeedbackId}
              showMoveSelect={modalSelectedMediaIds.size > 0}
              moveSelectOptions={moveSelectOptions}
              onMoveTo={handleMoveTo}
              moveSelectResetKey={moveSelectKey}
              moveToNewFolderOpen={moveToNewFolderOpen}
              onMoveToNewFolderOpenChange={
                handleActionBarMoveToNewFolderOpenChange
              }
              moveToNewFolderContent={
                modalSelectedMediaIds.size > 0 ? (
                  <MediaLibraryNewFolderForm
                    folders={folders}
                    list={fullList}
                    parentForNewFolder={parentForNewFolder}
                    onUpdateFoldersAndList={onUpdateFoldersAndList}
                    onFolderCreated={handleNewFolderCreated}
                    adjustListAfterCreate={(nf, _nextFolders, listBefore) =>
                      moveMediaToFolder(
                        modalSelectedMediaIds,
                        nf.id,
                        listBefore,
                      )
                    }
                    onClose={() => {
                      setMoveToNewFolderPopoverOpen(false);
                      setMoveSelectKey((k) => k + 1);
                      clearModalSelection();
                    }}
                  />
                ) : null
              }
              showMultiSelectDone={modalMediaMultiSelectMode}
              onMultiSelectDone={clearModalSelection}
            />
          </div>

          <MediaLibraryFolderModals
            selectedLibraryFilter={selectedLibraryFilter}
            onSelectLibraryFilter={navigateToFolder}
            folders={folders}
            list={fullList}
            onUpdateFoldersAndList={onUpdateFoldersAndList}
            onDeleteFolderSubtree={onDeleteFolderSubtree}
            onDeleteFolderKeepContents={onDeleteFolderKeepContents}
            folderDeleteOpen={folderDeleteOpen}
            onFolderDeleteOpenChange={setFolderDeleteOpen}
          />

          {/* Media grid */}
          {filteredList.length !== 0 || !showAll ? (
            <div
              ref={modalGridRef as React.RefObject<HTMLDivElement>}
              className="scrollbar-variable overflow-y-auto min-h-0 flex-1 bg-black/30"
            >
              <VirtualMediaGrid
                scrollRef={modalGridRef}
                mediaItems={filteredList}
                cols={calculatedGridCols}
                showFolders={!showAll}
                childFolders={childFolders}
                canGoUp={canGoUp}
                currentFolderName={selectedRealFolder?.name}
                onGoUp={handleGoUp}
                onOpenFolder={navigateToFolder}
                selectedMedia={modalSelectedMedia}
                selectedMediaIds={modalSelectedMediaIds}
                mediaMultiSelectMode={modalMediaMultiSelectMode}
                onMediaTileClick={handleModalMediaClick}
                onEnterMediaMultiSelectMode={enterModalMediaMultiSelectMode}
                showBottomName={showName}
                bottomNameClassName="text-sm font-medium text-gray-300"
              />
              {!showAll && searchTerm && filteredList.length === 0 && (
                <p className="px-4 py-1 text-sm text-gray-400">
                  No media found matching &quot;{searchTerm}&quot;
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center bg-black/30 px-2 py-8 text-center">
              <p className="text-gray-400">
                {searchTerm
                  ? `No media found matching "${searchTerm}"`
                  : "No media available"}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default MediaModal;
