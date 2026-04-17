import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Folder } from "lucide-react";
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
import generateRandomId from "../../utils/generateRandomId";
import {
  deleteFromCloudinary,
  extractPublicId,
} from "../../utils/cloudinaryUtils";
import { getApiBasePath } from "../../utils/environment";
import {
  setMediaItems,
  setMediaRouteFolder,
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
  MEDIA_LIBRARY_ORANGE_FOLDER_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";
import { useLocation, useNavigate } from "react-router-dom";
import { RootState } from "../../store/store";
import { updateProjector } from "../../store/presentationSlice";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { createNewFreeForm } from "../../utils/itemUtil";
import { createNewSlide } from "../../utils/slideCreation";
import { DEFAULT_FONT_PX } from "../../constants";
import { flushMediaLibraryDocToPouch } from "../../utils/flushMediaLibraryDoc";
import { alertMediaLibraryFlushFailed } from "./mediaLibraryFlushAlerts";
import { fill } from "@cloudinary/url-gen/actions/resize";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { useLoadMoreOnScroll } from "../../hooks/useLoadMoreOnScroll";
import { ActionCreators } from "redux-undo";
import { useToast } from "../../context/toastContext";
import type { ToastVariant } from "../../components/Toast/Toast";
import {
  MEDIA_GRID_LOAD_THRESHOLD_PX,
  MEDIA_GRID_PROGRESSIVE_BATCH,
  MEDIA_GRID_PROGRESSIVE_INITIAL,
} from "./mediaGridProgressiveLoad";

export type MediaLibraryPageMode = "default" | "overlayController";
export type MediaLibraryVariant = "default" | "panel";

export type UseMediaLibraryControllerArgs = {
  variant?: MediaLibraryVariant;
  pageMode?: MediaLibraryPageMode;
};

export function useMediaLibraryController({
  variant = "default",
  pageMode = "default",
}: UseMediaLibraryControllerArgs = {}) {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isPanelVariant = variant === "panel";

  const notifyMediaAction = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      showToast(message, variant);
    },
    [showToast],
  );

  const { db, cloud, isMobile, updater, isGuestSession = false } =
    useContext(ControllerInfoContext) || {};

  const { list, folders, isInitialized: mediaStoreInitialized } = useSelector(
    (state: RootState) => state.media,
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

  const {
    isMediaExpanded,
    mediaItemsPerRow,
    selectedPreference,
    selectedQuickLink,
    mediaRouteFolders,
    preferences: {
      defaultFreeFormBackgroundBrightness,
      defaultFreeFormFontMode,
    },
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const isProjectorTransmitting = useSelector(
    (state: RootState) => state.presentation.isProjectorTransmitting,
  );
  const { list: allItemsList } = useSelector(
    (state: RootState) => state.allItems,
  );

  const routeKey = getMediaRouteKey(
    location.pathname,
    pageMode,
    item.type,
  );
  const selectedLibraryFilter =
    mediaRouteFolders[routeKey] === undefined
      ? null
      : mediaRouteFolders[routeKey]!;

  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<MediaType | null>(null);
  const [isDeletingMultiple, setIsDeletingMultiple] = useState(false);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);
  const [showProviderRetryModal, setShowProviderRetryModal] = useState(false);
  const [providerRetryRows, setProviderRetryRows] = useState<MediaType[]>([]);
  const [providerRetryBusy, setProviderRetryBusy] = useState(false);
  const deleteConfirmLockRef = useRef(false);
  /** Fullscreen Media modal only; panel grid shows names only while searching. */
  const [showName, setShowName] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ isUploading: boolean; progress: number }>({ isUploading: false, progress: 0 });
  const mediaUploadInputRef = useRef<MediaUploadInputRef>(null);
  const mediaListRef = useRef<HTMLUListElement>(null);
  /** Search row + action bar; outside-click guard uses contains() so overflow triggers are reliably “inside”. */
  const mediaLibraryChromeRef = useRef<HTMLDivElement>(null);
  const lastChromePointerDownAtRef = useRef(0);
  const uploadPollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const isMediaLoading = Boolean(db && !mediaStoreInitialized);

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
    selectedLibraryFilter === null || selectedLibraryFilter === MEDIA_LIBRARY_ROOT_VIEW
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

  const filteredList = useMemo(() => {
    return list.filter((item) => {
      const matchesSearch = item.name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (selectedLibraryFilter === MEDIA_LIBRARY_ROOT_VIEW) {
        return !item.folderId;
      }
      if (selectedLibraryFilter) {
        return item.folderId === selectedLibraryFilter;
      }
      return true;
    });
  }, [list, searchTerm, typeFilter, selectedLibraryFilter]);

  const mediaGridProgressKey = `${routeKey}|${String(selectedLibraryFilter)}|${searchTerm}|${typeFilter}`;
  const [numShownMediaItems, setNumShownMediaItems] = useState(
    MEDIA_GRID_PROGRESSIVE_INITIAL,
  );

  const filteredListLengthRef = useRef(filteredList.length);
  filteredListLengthRef.current = filteredList.length;

  useEffect(() => {
    setNumShownMediaItems(
      Math.min(
        MEDIA_GRID_PROGRESSIVE_INITIAL,
        filteredListLengthRef.current,
      ),
    );
  }, [mediaGridProgressKey]);

  const visibleFilteredList = useMemo(
    () => filteredList.slice(0, numShownMediaItems),
    [filteredList, numShownMediaItems],
  );

  const isMediaGridFullyLoaded = filteredList.length <= numShownMediaItems;

  useLoadMoreOnScroll({
    scrollRef: mediaListRef,
    enabled:
      isMediaExpanded &&
      !isMediaLoading &&
      !isMediaGridFullyLoaded &&
      filteredList.length > 0,
    totalAvailable: filteredList.length,
    batchSize: MEDIA_GRID_PROGRESSIVE_BATCH,
    setShownCount: setNumShownMediaItems,
    shownCount: numShownMediaItems,
    rescheduleKey: mediaGridProgressKey,
    thresholdPx: MEDIA_GRID_LOAD_THRESHOLD_PX,
  });

  // Use shared selection hook
  const {
    selectedMedia,
    selectedMediaIds,
    previewMedia,
    mediaMultiSelectMode,
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

  useEffect(() => {
    reconcileSelectionWithMediaList(list);
  }, [list, reconcileSelectionWithMediaList]);

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
    navigateToFolder(
      selectedRealFolder.parentId ?? MEDIA_LIBRARY_ROOT_VIEW,
    );
  }, [navigateToFolder, selectedRealFolder]);

  /** Fullscreen modal keeps selection in MediaModal; copy into parent before bulk delete. */
  const openMultiDeleteModal = (ids: Set<string>) => {
    setSelectedMediaIds(new Set(ids));
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
    selectedLibraryFilter &&
      selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
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
    if (!m.background || !isProjectorTransmitting) return;
    const displayName = mediaLibraryDisplayName(m);
    const slide = createNewSlide({
      type: "Section",
      name: "Section 1",
      fontSize: DEFAULT_FONT_PX,
      words: ["", ""],
      background: m.background,
      mediaInfo: m,
      brightness: defaultFreeFormBackgroundBrightness,
      overflow: defaultFreeFormFontMode,
    });
    dispatch(
      updateProjector({
        slide,
        type: "free",
        name: displayName,
      }),
    );
    showToast(
      `Sent "${truncatedMediaToastLabel(m)}" to projector.`,
      "success",
    );
  }, [
    selectedMedia,
    isProjectorTransmitting,
    defaultFreeFormBackgroundBrightness,
    defaultFreeFormFontMode,
    dispatch,
    showToast,
  ]);

  const handleCreateCustomItemFromMedia = useCallback(async () => {
    const m = selectedMedia;
    if (!db || !m.background) return;
    const displayName = mediaLibraryDisplayName(m);
    try {
      const newItem = await createNewFreeForm({
        name: displayName,
        text: "",
        list: allItemsList,
        db,
        background: m.background,
        mediaInfo: m,
        brightness: defaultFreeFormBackgroundBrightness,
        overflow: defaultFreeFormFontMode,
        emptyBodyText: true,
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
        `/controller/item/${window.btoa(encodeURI(newItem._id))}/${window.btoa(
          encodeURI(addedAction.payload.listId),
        )}`,
      );
      showToast(
        `Custom item "${truncatedMediaToastLabel({ name: newItem.name })}" created and added to the outline.`,
        "success",
      );
    } catch {
      showToast("Could not create the item. Try again.", "error");
    }
  }, [
    selectedMedia,
    db,
    allItemsList,
    defaultFreeFormBackgroundBrightness,
    defaultFreeFormFontMode,
    dispatch,
    navigate,
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

  const mediaBarActions = useMemo(
    () =>
      buildMediaLibraryBarActions({
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
          setMediaToDelete(selectedMedia);
          setShowDeleteModal(true);
        },
        onDeleteMultiple: () => {
          setIsDeletingMultiple(true);
          setShowDeleteModal(true);
        },
        itemSlideContext,
        controllerFromSelectedMedia:
          selectedMediaIds.size === 1
            ? {
              isProjectorTransmitting,
              onSendToProjector: handleSendSelectedMediaToProjector,
              onCreateCustomItem: handleCreateCustomItemFromMedia,
            }
            : undefined,
        notify: notifyMediaAction,
      }),
    [
      routeFlags,
      db,
      isLoading,
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
      notifyMediaAction,
    ],
  );

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
    selectedLibraryFilter &&
      selectedLibraryFilter !== MEDIA_LIBRARY_ROOT_VIEW
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
        }
      }
      return failed;
    },
    [cloud],
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
        target?.parentId == null
          ? MEDIA_LIBRARY_ROOT_VIEW
          : target.parentId;
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
      void flushMediaLibraryDocToPouch(next.list, next.folders).then((r) => {
        if (!r.ok) {
          alertMediaLibraryFlushFailed(r.error, "folder");
        }
      });
    },
    [dispatch, folders, list, mediaRouteFolders],
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
        target?.parentId == null
          ? MEDIA_LIBRARY_ROOT_VIEW
          : target.parentId;
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
    [dispatch]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateMediaListFromExternal);

    return () => {
      updater.removeEventListener("update", updateMediaListFromExternal);
    };
  }, [updater, updateMediaListFromExternal]);

  useGlobalBroadcast(updateMediaListFromExternal);

  const markChromeInteraction = useCallback(() => {
    lastChromePointerDownAtRef.current = Date.now();
  }, []);



  // Clear selection when clicking outside the grid and outside protected chrome (action bar, portaled menus).
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isFullscreen) return;
      if (mediaRenameOpenRef.current || moveToNewFolderOpenRef.current) return;
      if (Date.now() - lastChromePointerDownAtRef.current < 500) return;

      const listEl = mediaListRef.current;
      const chromeEl = mediaLibraryChromeRef.current;
      const path = e.composedPath();

      const nodeInside = (root: HTMLElement | null) =>
        root &&
        path.some((n) => n instanceof Node && root.contains(n));

      if (nodeInside(listEl)) return;
      if (nodeInside(chromeEl)) return;

      const touchesPortaledOrOverlay = path.some((node) => {
        if (!(node instanceof Element)) return false;
        const ds = node.getAttribute("data-slot");
        if (
          ds === "dropdown-menu-content" ||
          ds === "dropdown-menu-item" ||
          ds === "dropdown-menu-sub-content" ||
          ds === "dropdown-menu-sub-trigger" ||
          ds === "dropdown-menu-trigger" ||
          ds === "popover-content" ||
          ds === "popover-trigger" ||
          ds === "select-content" ||
          ds === "select-item"
        ) {
          return true;
        }
        if (node.closest("[data-media-library-action-bar]")) return true;
        const role = node.getAttribute("role");
        if (
          role === "dialog" ||
          role === "alertdialog" ||
          role === "menu" ||
          role === "menuitem"
        ) {
          return true;
        }
        if (
          node.closest('[role="dialog"]') ||
          node.closest('[role="alertdialog"]')
        ) {
          return true;
        }
        const cl = node.classList;
        return cl?.contains("fixed") && cl?.contains("z-50");
      });

      if (touchesPortaledOrOverlay) return;

      if (listEl) clearSelection();
    };

    if (selectedMediaIds.size > 0) {
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [selectedMediaIds.size, isFullscreen, clearSelection]);



  const handleConfirmDelete = async () => {
    if (deleteConfirmLockRef.current) return;
    deleteConfirmLockRef.current = true;
    setIsDeleteInProgress(true);
    try {
      if (isDeletingMultiple) {
        await handleDeleteAll();
        return;
      }

      if (!db || !mediaToDelete) return;

      try {
        const result = await removeMediaRowsAfterSweep([mediaToDelete]);
        if (result.phase !== "ok") return;
        const updatedList = list.filter((item) => item.id !== mediaToDelete.id);
        dispatch(setMediaListAndFolders({ list: updatedList, folders }));
        const flushResult = await flushMediaLibraryDocToPouch(
          updatedList,
          folders,
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
        setShowDeleteModal(false);
        setMediaToDelete(null);
      } catch (error) {
        console.error("Error deleting background:", error);
      }
    } finally {
      deleteConfirmLockRef.current = false;
      setIsDeletingMultiple(false);
      setIsDeleteInProgress(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setMediaToDelete(null);
    setIsDeletingMultiple(false);
  };


  const handleDeleteAll = async () => {
    if (!db || selectedMediaIds.size === 0) return;

    const itemsToDelete = list.filter((item) => selectedMediaIds.has(item.id));

    try {
      const result = await removeMediaRowsAfterSweep(itemsToDelete);
      if (result.phase !== "ok") return;
      const updatedList = list.filter(
        (item) => !selectedMediaIds.has(item.id),
      );
      dispatch(setMediaListAndFolders({ list: updatedList, folders }));
      const flushResult = await flushMediaLibraryDocToPouch(
        updatedList,
        folders,
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
    } catch (error) {
      console.error("Error deleting media:", error);
    } finally {
      setShowDeleteModal(false);
      setIsDeletingMultiple(false);
    }
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
  }: mediaInfoType) => {
    if (isGuestSession) {
      notifyMediaAction(
        "Guest mode uses sample media only. Sign in to upload images or videos.",
        "error",
      );
      return;
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
    };

    dispatch(addItemToMediaList(newMedia));
  };

  const addMuxVideo = ({
    playbackId,
    assetId,
    playbackUrl,
    thumbnailUrl,
    name,
  }: {
    playbackId: string;
    assetId: string;
    playbackUrl: string;
    thumbnailUrl: string;
    name: string;
  }) => {
    if (isGuestSession) {
      notifyMediaAction(
        "Guest mode uses sample media only. Sign in to upload videos.",
        "error",
      );
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
    };

    dispatch(addItemToMediaList(newMedia));
  };

  const requestMediaUpload = useCallback(() => {
    if (isGuestSession) {
      notifyMediaAction(
        "Guest mode uses sample media only. Sign in to upload your own files.",
        "error",
      );
      return;
    }
    mediaUploadInputRef.current?.openModal();
  }, [isGuestSession, notifyMediaAction]);

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
        markChromeInteraction();
        ignoreRenameAutoCloseUntilRef.current = Date.now() + 750;
        setMoveToNewFolderPopoverOpen(false);
        setRenamePopoverOpen(true);
        return;
      }
      handleRenamePopoverOpenChange(false);
    },
    [
      markChromeInteraction,
      setRenamePopoverOpen,
      setMoveToNewFolderPopoverOpen,
      handleRenamePopoverOpenChange,
    ],
  );

  const handleActionBarMoveToNewFolderOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        markChromeInteraction();
        ignoreRenameAutoCloseUntilRef.current = Date.now() + 750;
        setRenamePopoverOpen(false);
        setMoveSelectKey((k) => k + 1);
        setMoveToNewFolderPopoverOpen(true);
        return;
      }
      handleMoveToNewFolderPopoverOpenChange(false);
    },
    [
      markChromeInteraction,
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
    addMuxVideo,
    handleUploadActiveChange,
    isMediaLoading,
    mediaLibraryChromeRef,
    markChromeInteraction,
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
    moveSelectOptions,
    handleMoveTo,
    moveSelectKey,
    selectedLibraryFilter,
    navigateToFolder,
    handleDeleteFolderSubtree,
    handleDeleteFolderKeepContents,
    folderDeleteOpen,
    filteredList,
    visibleFilteredList,
    isMediaGridFullyLoaded,
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
    setPreviewMedia,
    setMediaToDelete,
    setShowDeleteModal,
    openMultiDeleteModal,
    mediaItemsPerRow,
    mediaListRef,
  };
}
