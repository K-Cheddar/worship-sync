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
  Folder,
  FolderInput,
  FolderPlus,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/Popover";
import { useDispatch, useSelector, useMediaSelection } from "../../hooks";
import type { MediaFolder, MediaRouteKey, MediaType } from "../../types";
import cn from "classnames";
import { RootState } from "../../store/store";
import { updateMediaItemFields } from "../../store/mediaSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { MediaUploadInputRef } from "./MediaUploadInput";
import MediaTypeBadge from "./MediaTypeBadge";
import { useCachedMediaUrl, useCachedVideoUrl } from "../../hooks/useCachedMediaUrl";
import CachedMediaImage from "../../components/CachedMediaImage/CachedMediaImage";
import { MEDIA_LIBRARY_ROOT_VIEW, getChildFolders, moveMediaToFolder } from "../../utils/mediaFolderMutations";
import {
  buildFolderTreeSelectOptions,
  MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER,
} from "../../utils/mediaLibraryFolderOptions";
import MediaLibraryToolbar from "./MediaLibraryToolbar";
import { Slider } from "../../components/ui/Slider";
import Icon from "../../components/Icon/Icon";
import MediaLibraryFolderGridItems from "./MediaLibraryFolderGridItems";
import MediaLibraryActionBar, {
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
} from "./MediaLibraryActionBar";
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
import { formatMediaDimensionsLine, summarizeMultiSelectMetadata } from "./mediaLibraryMeta";
import {
  MEDIA_LIBRARY_ORANGE_FOLDER_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
]);

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
  const value = Math.min(modalZoomLevel, modalZoomSliderMax);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="shrink-0 text-gray-300" aria-hidden>
        <Icon svg={ZoomOut} size="sm" color="currentColor" />
      </span>
      <div className="w-36 shrink-0">
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
      <span className="shrink-0 text-gray-300" aria-hidden>
        <Icon svg={ZoomIn} size="sm" color="currentColor" />
      </span>
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
  typeFilter: "all" | "image" | "video";
  onTypeFilterChange: (v: "all" | "image" | "video") => void;
  onMediaClick: (
    e: React.MouseEvent,
    mediaItem: MediaType,
    index: number
  ) => void;
  onSearchChange: (value: string) => void;
  onShowNameToggle: () => void;
  onDeleteClick: (mediaItem: MediaType) => void;
  onDeleteMultipleClick: (selectedIds: Set<string>) => void;
  onPreviewChange: (media: MediaType | null) => void;
  mediaUploadInputRef?: React.MutableRefObject<MediaUploadInputRef | null>;
  uploadProgress?: { isUploading: boolean; progress: number };
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
  onMediaClick,
  onSearchChange,
  onShowNameToggle,
  onDeleteClick,
  onDeleteMultipleClick,
  onPreviewChange,
  mediaUploadInputRef,
  uploadProgress,
}: MediaModalProps) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { showToast } = useToast();
  const { db, isMobile } = useContext(ControllerInfoContext) || {};

  const notifyMediaAction = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      showToast(message, variant);
    },
    [showToast],
  );

  const item = useSelector((state: RootState) => state.undoable.present.item);
  const isLoading = item.isLoading;

  const itemSlideContext = useMemo(() => {
    if (!location.pathname.includes("item")) return undefined;
    const arrangement = item.arrangements[item.selectedArrangement];
    const slides =
      arrangement?.slides?.length ? arrangement.slides : item.slides;
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
    (state: RootState) => state.undoable.present.overlay
  );
  const { selectedPreference, selectedQuickLink } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const [modalZoomLevel, setModalZoomLevel] = useState(0);
  const [modalLayoutBaseCols, setModalLayoutBaseCols] = useState(8);
  const modalGridRef = useRef<HTMLUListElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const calculatedGridCols = useMemo(() => {
    const maxZ = Math.max(0, modalLayoutBaseCols - 2);
    const z = Math.min(modalZoomLevel, maxZ);
    return Math.max(2, modalLayoutBaseCols - z);
  }, [modalLayoutBaseCols, modalZoomLevel]);

  const modalZoomSliderMax = Math.max(0, modalLayoutBaseCols - 2);

  const filteredList = mediaList;

  // Use shared selection hook for modal - independent from Media component
  const {
    selectedMedia: modalSelectedMedia,
    selectedMediaIds: modalSelectedMediaIds,
    previewMedia: modalPreviewMedia,
    setSelectedMedia: setModalSelectedMedia,
    setSelectedMediaIds: setModalSelectedMediaIds,
    setPreviewMedia: setModalPreviewMedia,
    handleMediaClick: handleModalMediaClick,
    clearSelection: clearModalSelection,
  } = useMediaSelection({
    mediaList: fullList,
    filteredList,
    enableRangeSelection: false, // Modal doesn't need range selection
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
    selectedLibraryFilter &&
      selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? folders.find((f) => f.id === selectedLibraryFilter)
      : undefined;
  const canGoUp = Boolean(
    selectedLibraryFilter &&
    selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW,
  );

  const navigateToFolder = useCallback(
    (folderId: string | null) => {
      clearModalSelection();
      onSelectLibraryFilter(folderId);
    },
    [clearModalSelection, onSelectLibraryFilter],
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
    navigateToFolder(
      selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW,
    );
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

  const mediaBarActions = useMemo(
    () =>
      buildMediaLibraryBarActions({
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
      }),
    [
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
    ],
  );

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
    return (
      <div
        className="min-w-0 truncate text-xs"
        title={
          multiMeta
            ? `${modalSelectedMediaIds.size} selected · ${multiMeta}`
            : `${modalSelectedMediaIds.size} selected`
        }
      >
        <span className="font-medium text-white">
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
  ]);

  const parentForNewFolder =
    selectedLibraryFilter &&
      selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
      ? selectedLibraryFilter
      : null;

  const resolvedPreviewImageUrl = useCachedMediaUrl(
    modalPreviewMedia?.type === "image" ? modalPreviewMedia.background : undefined
  );
  const resolvedPreviewVideoUrl = useCachedVideoUrl(
    modalPreviewMedia?.type === "video" ? modalPreviewMedia.background : undefined
  );

  // Calculate grid columns based on available space
  const calculateGridColumns = (containerWidth: number) => {
    const minItemsPerRow = 8;
    const maxItemWidth = 150;
    const calculatedItems = Math.floor(containerWidth / maxItemWidth);
    return Math.max(minItemsPerRow, calculatedItems);
  };

  useEffect(() => {
    if (!isOpen || !modalGridRef.current) return;
    const el = modalGridRef.current;
    const updateLayoutBaseCols = () => {
      const width = el.offsetWidth;
      setModalLayoutBaseCols(calculateGridColumns(width));
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
      <div className="relative w-full overflow-hidden" style={{ height: isMobile ? "calc(100vh - 60px)" : "calc(90vh - 120px)" }}>
        {/* Expanded fullscreen view */}
        <div
          className={cn(
            "absolute inset-0 bg-black/55 transition-all duration-300 ease-in-out",
            isExpanded && modalPreviewMedia && modalPreviewMedia.type === "image"
              ? "opacity-100 z-10"
              : "opacity-0 z-0 pointer-events-none"
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
            isExpanded && modalPreviewMedia && modalPreviewMedia.type === "image"
              ? "opacity-0 z-0 pointer-events-none"
              : "opacity-100 z-10"
          )}
        >
          <div
            className={cn(
              "relative w-full flex flex-col items-center gap-2 overflow-hidden border-b border-gray-500 bg-homepage-canvas px-4 py-1 transition-all duration-300 ease-in-out",
              modalPreviewMedia
                ? "h-[40vh] flex-1 min-h-[40vh] opacity-100"
                : "h-0 opacity-0"
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
                    {modalPreviewMedia.type === "video" ? (
                      <video
                        src={resolvedPreviewVideoUrl ?? modalPreviewMedia.background}
                        className="max-h-full max-w-full w-full h-full object-contain"
                        controls
                        autoPlay
                      />
                    ) : (
                      <img
                        src={resolvedPreviewImageUrl ?? modalPreviewMedia.background}
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
              <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                  className="mx-0 min-w-0 flex-1 border-0 bg-transparent px-0 py-0"
                />
                {mediaUploadInputRef && (
                  <div className="shrink-0">
                    <Button
                      variant="tertiary"
                      svg={Plus}
                      onClick={() => mediaUploadInputRef.current?.openModal()}
                      title={
                        uploadProgress?.isUploading
                          ? `Uploading... ${Math.round(uploadProgress.progress)}%`
                          : "Add Media"
                      }
                      disabled={uploadProgress?.isUploading}
                    >
                      {uploadProgress?.isUploading
                        ? `${Math.round(uploadProgress.progress)}%`
                        : ""}
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  type="text"
                  label="Search"
                  value={searchTerm}
                  onChange={(value) => onSearchChange(value as string)}
                  placeholder="Name"
                  className="flex min-w-0 flex-1 gap-4 items-center"
                  inputWidth="w-full"
                  inputTextSize="text-sm"
                  svg={searchTerm ? X : undefined}
                  svgAction={() => onSearchChange("")}
                  svgActionAriaLabel="Clear search"
                />
                <Toggle
                  icon={Eye}
                  value={showName}
                  onChange={onShowNameToggle}
                />
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
                <div className="shrink-0">
                  <Button
                    variant="tertiary"
                    svg={Plus}
                    onClick={() => mediaUploadInputRef.current?.openModal()}
                    title={
                      uploadProgress?.isUploading
                        ? `Uploading... ${Math.round(uploadProgress.progress)}%`
                        : "Add Media"
                    }
                    disabled={uploadProgress?.isUploading}
                  >
                    {uploadProgress?.isUploading
                      ? `${Math.round(uploadProgress.progress)}%`
                      : ""}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="w-full">
            <MediaLibraryActionBar
              className="mx-0 rounded-none border-x-0"
              detailsRow={actionBarDetails}
              showFolderActions={modalSelectedMediaIds.size === 0}
              newFolderPopover={
                <Popover open={newFolderOpen} onOpenChange={setNewFolderOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="tertiary"
                      className={MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS}
                      svg={FolderPlus}
                      title="New folder"
                    >
                      New folder
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-72 border border-gray-600 bg-gray-900 p-3 text-white"
                  >
                    <MediaLibraryNewFolderForm
                      folders={folders}
                      list={fullList}
                      parentForNewFolder={parentForNewFolder}
                      onUpdateFoldersAndList={onUpdateFoldersAndList}
                      onClose={() => setNewFolderOpen(false)}
                    />
                  </PopoverContent>
                </Popover>
              }
              renameFolderPopover={
                selectedRealFolder ? (
                  <Popover
                    open={folderRenameOpen}
                    onOpenChange={setFolderRenameOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="tertiary"
                        className={MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS}
                        svg={FolderInput}
                        title="Rename folder"
                      >
                        Rename
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-72 border border-gray-600 bg-gray-900 p-3 text-white"
                    >
                      <MediaLibraryRenameFolderForm
                        folders={folders}
                        list={fullList}
                        folder={selectedRealFolder}
                        onUpdateFoldersAndList={onUpdateFoldersAndList}
                        onClose={() => setFolderRenameOpen(false)}
                      />
                    </PopoverContent>
                  </Popover>
                ) : null
              }
              onDeleteFolder={() => setFolderDeleteOpen(true)}
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
              showMoveSelect={modalSelectedMediaIds.size > 0}
              moveSelectOptions={moveSelectOptions}
              onMoveTo={handleMoveTo}
              moveSelectResetKey={moveSelectKey}
              moveToNewFolderOpen={moveToNewFolderOpen}
              onMoveToNewFolderOpenChange={handleActionBarMoveToNewFolderOpenChange}
              moveToNewFolderContent={
                modalSelectedMediaIds.size > 0 ? (
                  <MediaLibraryNewFolderForm
                    folders={folders}
                    list={fullList}
                    parentForNewFolder={parentForNewFolder}
                    onUpdateFoldersAndList={onUpdateFoldersAndList}
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

          {/* Media grid (folder tiles share the same scrollable grid) */}
          {filteredList.length !== 0 || !showAll ? (
            <ul
              ref={modalGridRef}
              className={cn(
                "scrollbar-variable grid min-h-0 flex-1 content-start items-start overflow-y-auto bg-black/30 p-4 gap-x-2 gap-y-1",
                sizeMap.get(calculatedGridCols) || `grid-cols-${calculatedGridCols}`
              )}
              style={{
                gridTemplateColumns: `repeat(${calculatedGridCols}, minmax(0, 1fr))`,
                gridAutoRows: "auto",
              }}
            >
              <MediaLibraryFolderGridItems
                active={!showAll}
                childFolders={childFolders}
                canGoUp={canGoUp}
                onGoUp={handleGoUp}
                onOpenFolder={(id) => navigateToFolder(id)}
              />
              {filteredList.map((mediaItem, index) => {
                const { id, thumbnail, name, type } = mediaItem;
                const isSelected = id === modalSelectedMedia.id;
                const isMultiSelected = modalSelectedMediaIds.has(id);
                const shownName = name.includes("/")
                  ? name.split("/").slice(1).join("/")
                  : name;

                return (
                  <li key={id}>
                    <Button
                      variant="none"
                      padding="p-0"
                      className={cn(
                        "flex h-auto w-full flex-col items-center justify-center border-2",
                        isMultiSelected
                          ? "border-cyan-400 bg-cyan-400/10"
                          : isSelected
                            ? "border-cyan-400"
                            : "border-gray-500 hover:border-gray-300"
                      )}
                      onClick={(e) => {
                        handleModalMediaClick(e, mediaItem, index);
                      }}
                      onContextMenu={(e) => {
                        if (!isMultiSelected && !isSelected) {
                          handleModalMediaClick(e, mediaItem, index);
                        }
                      }}
                    >
                      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden border-b border-gray-500">
                        <CachedMediaImage
                          className="max-w-full max-h-full"
                          alt={id}
                          src={thumbnail}
                          loading="lazy"
                        />
                        <MediaTypeBadge type={type} />
                      </div>

                      {name && showName && (
                        <div className="w-full px-1 py-1.5 text-center">
                          <p
                            className="text-sm font-medium text-gray-300 truncate"
                            title={name}
                          >
                            {shownName}
                          </p>
                        </div>
                      )}
                    </Button>
                  </li>
                );
              })}
              {!showAll &&
                searchTerm &&
                filteredList.length === 0 && (
                  <li className="col-span-full py-1">
                    <p className="text-sm text-gray-400">
                      No media found matching &quot;{searchTerm}&quot;
                    </p>
                  </li>
                )}
            </ul>
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
