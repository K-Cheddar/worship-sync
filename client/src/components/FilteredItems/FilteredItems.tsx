import React, {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "../../hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FilePlus, Search, Tag, WholeWord } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Button from "../Button/Button";
import SortableColumnButton from "../SortableColumnButton";
import Spinner from "../Spinner/Spinner";
import SongSearchInput from "../SongList/SongSearchInput";
import DeleteModal from "../Modal/DeleteModal";
import {
  addItemToItemList,
  removeItemFromListById,
} from "../../store/itemListSlice";
import type { DBItem, ServiceItem } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { globalFireDbInfo, GlobalInfoContext } from "../../context/globalInfo";
import { useControllerBasePath } from "../../context/activeController";
import { ActionCreators } from "redux-undo";
import FilteredItem from "./FilteredItem";
import ViewSongSectionsDrawer from "../SongSections/ViewSongSectionsDrawer";
import ServicePlanCustomDocumentPreviewDialog from "../ServicePlanCustomDocumentPreviewDialog";
import { filterAndSortItemsForSearch, prepareItemSearchDocuments } from "../../utils/songSearchUtils";
import {
  createSongMetadataFromLrclib,
  getImportableLyricsFromTrack,
  type NormalizedLrclibTrack,
} from "../../utils/lrclib";
import { initialCreateItemState, setCreateItem } from "../../store/createItemSlice";
import { ref, get, set } from "firebase/database";
import { deleteTimer } from "../../store/timersSlice";
import { getChurchDataPath } from "../../utils/firebasePaths";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { cn } from "../../utils/cnHelper";
import { searchLrclibTracks } from "../../api/lrclib";
import { deleteSongAudioWithRetry } from "../../api/auth";
import ExternalLyricsResultItem from "./ExternalLyricsResultItem";
import ViewExternalLyricsDrawer from "./ViewExternalLyricsDrawer";
import {
  EXTERNAL_SECTION_FOOTER_HEIGHT,
  EXTERNAL_SECTION_HEADER_HEIGHT,
  getExternalSectionClassName,
  getExternalSectionPosition,
} from "./externalResultsSection";
import {
  COLLAPSED_FILTERED_ITEM_ROW_HEIGHT,
  estimateFilteredItemRowHeight,
  EXTERNAL_RESULT_ROW_HEIGHT,
  EXTERNAL_STATUS_ROW_HEIGHT,
  getLibraryItemVirtualKey,
} from "./filteredItemsVirtualRowHeight";
import { isViewOnlyAccess } from "../../utils/accessTiers";
import { usePresentationControllerMode } from "../../context/presentationControllerMode";
import type { LibraryFilter } from "../../store/itemLibraryUiSlice";
import Checkbox from "../Checkbox/Checkbox";
import {
  FILTERED_LIBRARY_GRID_COLUMNS,
  FILTERED_LIBRARY_SELECTION_GRID_COLUMNS,
} from "./FilteredItem";
import {
  createItemLibraryDeletionProgress,
  deleteLibraryItemWithProgress,
  type ItemLibraryDeletionProgress,
} from "../../utils/itemLibraryDeletion";
import {
  getItemLibraryAuditDisplay,
  sortItemLibraryResults,
  type ItemLibrarySortDirection,
  type ItemLibrarySortField,
} from "../../utils/itemLibraryPresentation";

type FilteredItemsProps = {
  list: ServiceItem[];
  type: string;
  heading: string;
  label: string;
  isLoading: boolean;
  allDocs: DBItem[];
  searchValue: string;
  setSearchValue: (value: string) => void;
  /** Opt-in unified library filters; omitted by embedded/category-specific callers. */
  libraryFilter?: LibraryFilter;
  onLibraryFilterChange?: (filter: LibraryFilter) => void;
  /** Rendered above the scrollable list — use for pinned virtual items (e.g. Upcoming Service). */
  pinnedTopContent?: React.ReactNode;
  /**
   * When set, primary row action calls this instead of adding to the live outline
   * (plan-picker attach mode).
   */
  onAddItem?: (item: ServiceItem) => void;
  /** Primary action label before the brief "Added." confirmation. */
  addButtonLabel?: string;
  /** When false, hide delete controls. Defaults to library mutate access. */
  showDelete?: boolean;
  /** When false, hide create + external lyrics chrome. Defaults to library mutate access. */
  showCreateAndExternal?: boolean;
  /**
   * When set, "Create a new …" is a button that calls this instead of linking to
   * `/controller/create` (e.g. plan picker modal that embeds create in-place).
   */
  onCreateNew?: () => void;
  /**
   * When set, external-lyrics "Create song" uses this instead of navigating to
   * `/controller/create` with a prefilled draft.
   */
  onCreateFromExternal?: (candidate: NormalizedLrclibTrack) => void;
  /** Passed through to SongSearchInput (dark modal surfaces need explicit colors). */
  searchLabelClassName?: string;
  searchInputClassName?: string;
  /** When true, omit the page heading (modal / embedded use). */
  hideHeading?: boolean;
  /** Merged onto the root layout wrapper. */
  className?: string;
};

export type filteredItemsListType = ServiceItem & {
  matchPercentage?: number;
  /** Weighted title coverage; overall relevance also considers content. */
  titleMatch?: number;
  matchRank?: number;
  matchedWords?: string;
  showWords?: boolean;
};

type FilteredItemsVirtualRow =
  | { kind: "external-section-header" }
  | { kind: "external-section-footer" }
  | { kind: "external-loading" }
  | { kind: "external-error"; message: string }
  | { kind: "external-empty" }
  | { kind: "external"; candidate: NormalizedLrclibTrack }
  | { kind: "library"; item: filteredItemsListType; libraryIndex: number };

type DeleteConfirmation = { kind: "single" | "bulk"; items: ServiceItem[]; owner: DeletionOwner };
type DeletionOwner = {
  db: PouchDB.Database | undefined;
  churchId: string;
  userId?: string;
  sessionKind?: string | null;
  firebaseDb: typeof globalFireDbInfo.db;
  firebaseChurchId: string;
  outlineOwnerKey?: string;
  outlineId?: string;
};

const SORT_DIRECTION_DEFAULT: Record<ItemLibrarySortField, ItemLibrarySortDirection> = {
  relevance: "descending",
  name: "ascending",
  updatedAt: "descending",
  createdAt: "descending",
  updatedBy: "ascending",
};

const getExternalCandidateKey = (candidate: NormalizedLrclibTrack) =>
  `${candidate.source}:${candidate.geniusId ?? candidate.lrclibId ?? candidate.trackName}:${candidate.artistName}`;

const getCreateLabel = (type: string, filter: LibraryFilter, label: string) => {
  if (type !== "all") return label;
  if (filter === "all") return "item";
  if (filter === "song") return "song";
  if (filter === "free") return "custom item";
  return "timer";
};

const FilteredItems = ({
  list,
  type,
  heading,
  label,
  isLoading,
  allDocs,
  searchValue,
  setSearchValue,
  libraryFilter = "all",
  onLibraryFilterChange,
  pinnedTopContent,
  onAddItem,
  addButtonLabel = "Add to outline",
  showDelete,
  showCreateAndExternal,
  onCreateNew,
  onCreateFromExternal,
  searchLabelClassName,
  searchInputClassName,
  hideHeading = false,
  className,
}: FilteredItemsProps) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [libraryScrollbarGutterWidth, setLibraryScrollbarGutterWidth] = useState(0);

  useEffect(() => {
    const scrollElement = listScrollRef.current;
    if (!scrollElement) return;

    const updateScrollbarGutter = () => {
      const width = Math.max(0, scrollElement.offsetWidth - scrollElement.clientWidth);
      setLibraryScrollbarGutterWidth((current) => current === width ? current : width);
    };
    updateScrollbarGutter();

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateScrollbarGutter);
    resizeObserver?.observe(scrollElement);
    window.addEventListener("resize", updateScrollbarGutter);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollbarGutter);
    };
  }, []);

  const effectiveFilter: LibraryFilter =
    type === "all"
      ? libraryFilter
      : type === "song"
        ? "song"
        : type === "free"
          ? "free"
          : "timer";
  const showLibraryControls = type === "all";
  const showExternalSearch = type === "song" || (type === "all" && effectiveFilter === "song");
  const useDetailsGrid =
    type === "song" ||
    type === "free" ||
    (type === "all" && effectiveFilter !== "timer");
  const listForFilter = useMemo(() => {
    const supportedTypes = new Set(["song", "free", "timer"]);
    return list.filter(
      (item) =>
        supportedTypes.has(item.type) &&
        (effectiveFilter === "all" || item.type === effectiveFilter),
    );
  }, [list, effectiveFilter]);

  const docsById = useMemo(() => {
    prepareItemSearchDocuments(allDocs);
    const byId = new Map<string, DBItem>();
    for (const doc of allDocs) {
      byId.set(doc._id, doc);
    }
    return byId;
  }, [allDocs]);

  const songArtistById = useMemo(() => {
    const byId = new Map<string, string>();
    if (type !== "song" && effectiveFilter !== "song" && effectiveFilter !== "all") {
      return byId;
    }
    for (const doc of allDocs) {
      const artist = doc.songMetadata?.artistName?.trim();
      if (artist) {
        byId.set(doc._id, artist);
      }
    }
    return byId;
  }, [allDocs, effectiveFilter, type]);

  const [sortOverride, setSortOverride] = useState<ItemLibrarySortField | null>(null);
  const [sortDirectionOverride, setSortDirectionOverride] = useState<{
    field: ItemLibrarySortField;
    direction: ItemLibrarySortDirection;
  } | null>(null);
  const sortField = sortOverride ?? (searchValue.trim() ? "relevance" : "name");
  const sortDirection = sortDirectionOverride?.field === sortField
    ? sortDirectionOverride.direction
    : SORT_DIRECTION_DEFAULT[sortField];
  const changeLibrarySort = (field: ItemLibrarySortField) => {
    if (sortOverride !== field) {
      setSortOverride(field);
      setSortDirectionOverride({ field, direction: "ascending" });
      return;
    }
    if (sortDirection === "ascending") {
      setSortDirectionOverride({ field, direction: "descending" });
      return;
    }
    setSortOverride(null);
    setSortDirectionOverride(null);
  };

  const [{ list: filteredList, query: filteredSearchValue }, setSearchResults] =
    useState({ list: listForFilter as filteredItemsListType[], query: "" });
  const setFilteredList = (list: filteredItemsListType[]) =>
    setSearchResults((previous) => ({ ...previous, list }));
  const orderedFilteredList = useMemo(() => {
    if (!showLibraryControls || sortOverride === null) return filteredList;
    return sortItemLibraryResults(filteredList, docsById, sortOverride, sortDirection);
  }, [docsById, filteredList, showLibraryControls, sortDirection, sortOverride]);
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionState, setSelectionState] = useState({
    scopeKey: "",
    ids: new Set<string>(),
  });
  const selectionScopeKey = JSON.stringify([searchValue, effectiveFilter]);
  const selectedItemIds = selectionState.scopeKey === selectionScopeKey
    ? selectionState.ids
    : new Set<string>();
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionProgressMessage, setDeletionProgressMessage] = useState("");
  const [deletionNotice, setDeletionNotice] = useState("");
  const [deletionErrors, setDeletionErrors] = useState<Record<string, string>>({});
  const [pendingCleanupRows, setPendingCleanupRows] = useState<ItemLibraryDeletionProgress[]>([]);
  const deletionProgressByIdRef = useRef(new Map<string, ItemLibraryDeletionProgress>());
  const deletionOwnerByIdRef = useRef(new Map<string, DeletionOwner>());
  const deleteInFlightRef = useRef(false);

  const [showWords, setShowWords] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isExternalSearchLoading, setIsExternalSearchLoading] = useState(false);
  const [externalSearchQuery, setExternalSearchQuery] = useState("");
  const [externalSearchResults, setExternalSearchResults] = useState<
    NormalizedLrclibTrack[]
  >([]);
  const [externalSearchError, setExternalSearchError] = useState("");
  const [viewSectionsSongId, setViewSectionsSongId] = useState<string | null>(
    null,
  );
  const [viewExternalLyricsCandidate, setViewExternalLyricsCandidate] =
    useState<NormalizedLrclibTrack | null>(null);
  const externalSearchCacheRef = useRef(new Map<string, NormalizedLrclibTrack[]>());

  const displayRows = useMemo<FilteredItemsVirtualRow[]>(() => {
    const rows: FilteredItemsVirtualRow[] = [];

    if (showExternalSearch && externalSearchQuery) {
      if (isExternalSearchLoading) {
        rows.push({ kind: "external-loading" });
      } else {
        rows.push({ kind: "external-section-header" });
        if (externalSearchError) {
          rows.push({ kind: "external-error", message: externalSearchError });
        } else if (externalSearchResults.length === 0) {
          rows.push({ kind: "external-empty" });
        } else {
          for (const candidate of externalSearchResults) {
            rows.push({ kind: "external", candidate });
          }
        }

        if (filteredList.length > 0) {
          rows.push({ kind: "external-section-footer" });
        }
      }
    }

    orderedFilteredList.forEach((item) => {
      rows.push({ kind: "library", item, libraryIndex: filteredList.indexOf(item) });
    });

    return rows;
  }, [
    showExternalSearch,
    externalSearchQuery,
    isExternalSearchLoading,
    externalSearchError,
    externalSearchResults,
    filteredList,
    orderedFilteredList,
  ]);

  const displayRowKinds = useMemo(
    () => displayRows.map((row) => row.kind),
    [displayRows],
  );

  const displayRowsRef = useRef(displayRows);
  displayRowsRef.current = displayRows;

  const showWordsRef = useRef(showWords);
  showWordsRef.current = showWords;

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => listScrollRef.current,
    getItemKey: (index) => {
      const row = displayRowsRef.current[index];
      if (!row) return index;
      if (row.kind === "external-section-header") {
        return `external-section-header:${externalSearchQuery}`;
      }
      if (row.kind === "external-section-footer") {
        return `external-section-footer:${externalSearchQuery}`;
      }
      if (row.kind === "external-loading") return "external-loading";
      if (row.kind === "external-error") return "external-error";
      if (row.kind === "external-empty") return "external-empty";
      if (row.kind === "external") return getExternalCandidateKey(row.candidate);
      return getLibraryItemVirtualKey(row.item, showWordsRef.current);
    },
    estimateSize: (index) => {
      const row = displayRowsRef.current[index];
      if (!row) return COLLAPSED_FILTERED_ITEM_ROW_HEIGHT;
      if (row.kind === "external-section-header") {
        return EXTERNAL_SECTION_HEADER_HEIGHT;
      }
      if (row.kind === "external-section-footer") {
        return EXTERNAL_SECTION_FOOTER_HEIGHT;
      }
      if (
        row.kind === "external-loading" ||
        row.kind === "external-error" ||
        row.kind === "external-empty"
      ) {
        return EXTERNAL_STATUS_ROW_HEIGHT;
      }
      if (row.kind === "external") {
        return EXTERNAL_RESULT_ROW_HEIGHT;
      }
      return estimateFilteredItemRowHeight(
        row.item,
        showWordsRef.current,
        Boolean(songArtistById.get(row.item._id)),
        showLibraryControls,
        showLibraryControls && typeof window !== "undefined" && window.innerWidth < 768,
      );
    },
    gap: 0,
    overscan: 5,
    initialRect: { width: 0, height: 600 },
  });

  const viewSongDoc = useMemo(() => {
    if (!viewSectionsSongId || (type !== "song" && effectiveFilter !== "song" && effectiveFilter !== "all")) return null;
    const doc = allDocs.find(
      (d) => d._id === viewSectionsSongId && d.type === "song",
    );
    return doc ?? null;
  }, [viewSectionsSongId, allDocs, effectiveFilter, type]);
  const [customItemForDetails, setCustomItemForDetails] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const customDocumentById = customItemForDetails
    ? docsById.get(customItemForDetails.id)
    : undefined;
  const viewCustomDocument =
    customDocumentById?.type === "free" ? customDocumentById : null;

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access, churchId, userId, sessionKind } = useContext(GlobalInfoContext) || {};
  const { mode } = usePresentationControllerMode();
  const canMutateLibrary = !isViewOnlyAccess(access);
  const allowDelete = (showDelete ?? canMutateLibrary) && mode === "edit";
  const outlineOwnerKey = useSelector((state) => state.undoable?.present?.itemList?.outlineOwnerKey);
  const outlineId = useSelector((state) => state.undoable?.present?.itemList?.loadedOutlineId);
  const currentOperationContextRef = useRef({
    db,
    churchId: churchId ?? "",
    userId,
    sessionKind,
    allowDelete,
    outlineOwnerKey,
    outlineId,
  });
  currentOperationContextRef.current = {
    db,
    churchId: churchId ?? "",
    userId,
    sessionKind,
    allowDelete,
    outlineOwnerKey,
    outlineId,
  };
  const showSelectionControls = showLibraryControls && allowDelete && !isLoading;
  const allowCreateAndExternal = showCreateAndExternal ?? canMutateLibrary;
  /** Attach mode always shows the primary action even for view-only library access. */
  const allowAdd = onAddItem ? true : canMutateLibrary;

  const searchItems = useMemo(
    () => (rawSearchValue: string, filter: LibraryFilter = effectiveFilter) =>
      filterAndSortItemsForSearch(list, allDocs, rawSearchValue, filter),
    [list, allDocs, effectiveFilter],
  );

  useEffect(() => {
    setSelectionState((current) => current.scopeKey === selectionScopeKey
      ? current
      : { scopeKey: selectionScopeKey, ids: new Set<string>() });
    setDeleteConfirmation(null);
  }, [selectionScopeKey]);

  useEffect(() => {
    if (showSelectionControls) return;
    setSelectionMode(false);
    setSelectionState({ scopeKey: selectionScopeKey, ids: new Set<string>() });
  }, [selectionScopeKey, showSelectionControls]);

  useEffect(() => {
    const currentIds = new Set(filteredList.map((item) => item._id));
    setSelectionState((current) => {
      if (current.scopeKey !== selectionScopeKey) {
        return { scopeKey: selectionScopeKey, ids: new Set<string>() };
      }
      const nextIds = new Set([...current.ids].filter((id) => currentIds.has(id)));
      if (nextIds.size === current.ids.size) return current;
      return { ...current, ids: nextIds };
    });
  }, [filteredList, selectionScopeKey]);

  // Debounced search effect
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, 250);
    setIsSearchLoading(searchValue !== debouncedSearchValue);
    return () => clearTimeout(timeout);
  }, [searchValue, debouncedSearchValue]);

  // Search effect
  useEffect(() => {
    const results = searchItems(debouncedSearchValue);
    setSearchResults({ list: results, query: debouncedSearchValue });
    setIsSearchLoading(false);
    listScrollRef.current?.scrollTo?.({ top: 0 });
  }, [debouncedSearchValue, searchItems]);

  const captureDeletionOwner = (): DeletionOwner => {
    const firebaseDb = globalFireDbInfo.db && globalFireDbInfo.churchId === (churchId ?? "")
      ? globalFireDbInfo.db
      : undefined;
    return {
      db,
      churchId: churchId ?? "",
      userId,
      sessionKind,
      firebaseDb,
      firebaseChurchId: firebaseDb ? globalFireDbInfo.churchId : "",
      outlineOwnerKey,
      outlineId,
    };
  };

  const isDeletionOwnerCurrent = (owner: DeletionOwner) => {
    const current = currentOperationContextRef.current;
    if (
      !current.allowDelete ||
      current.db !== owner.db ||
      current.churchId !== owner.churchId ||
      current.userId !== owner.userId ||
      current.sessionKind !== owner.sessionKind ||
      current.outlineOwnerKey !== owner.outlineOwnerKey ||
      current.outlineId !== owner.outlineId
    ) return false;
    if (owner.firebaseDb && (
      globalFireDbInfo.db !== owner.firebaseDb ||
      globalFireDbInfo.churchId !== owner.firebaseChurchId
    )) return false;
    return true;
  };

  const createDeletionOwnerError = (owner: DeletionOwner) => {
    const current = currentOperationContextRef.current;
    if (!current.allowDelete) return "You no longer have permission to delete items. Refresh your access and try again.";
    if (current.db !== owner.db || current.churchId !== owner.churchId ||
      current.userId !== owner.userId || current.sessionKind !== owner.sessionKind) {
      return "Your session changed before deletion finished. Return to the original session and retry cleanup.";
    }
    if (current.outlineOwnerKey !== owner.outlineOwnerKey || current.outlineId !== owner.outlineId) {
      return "The open outline changed before deletion finished. Return to the original outline and retry cleanup.";
    }
    return "The shared database session changed before cleanup finished. Return to the original session and retry.";
  };

  useEffect(() => {
    if (!deleteConfirmation) return;
    const currentIds = new Set(listForFilter.map((item) => item._id));
    const owner = deleteConfirmation.owner;
    const ownerStillCurrent = allowDelete && db === owner.db &&
      (churchId ?? "") === owner.churchId && userId === owner.userId &&
      sessionKind === owner.sessionKind && outlineOwnerKey === owner.outlineOwnerKey &&
      outlineId === owner.outlineId &&
      (!owner.firebaseDb || (globalFireDbInfo.db === owner.firebaseDb &&
        globalFireDbInfo.churchId === owner.firebaseChurchId));
    if (!ownerStillCurrent ||
      deleteConfirmation.items.some((item) => !currentIds.has(item._id))) {
      setDeleteConfirmation(null);
    }
  }, [
    allowDelete,
    churchId,
    db,
    deleteConfirmation,
    listForFilter,
    mode,
    outlineId,
    outlineOwnerKey,
    sessionKind,
    userId,
  ]);

  const getDeletionMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (/song.*migrated|SONG_V2_DELETION_DEFERRED/i.test(message)) {
      return "This song uses the V2 format and can't be deleted yet.";
    }
    if (/not available/i.test(message)) return message;
    if (/session changed|original outline|shared database/i.test(message)) return message;
    if (/permission|unauthorized|forbidden|\b403\b/i.test(message)) {
      return "You no longer have permission to complete this deletion. Refresh your access and try again.";
    }
    if (/not found|\b404\b/i.test(message)) {
      return "The saved item could not be found. Refresh the library and try again.";
    }
    if (/saved item has changed/i.test(message)) return message;
    return "Could not complete this deletion. Check the connection and try again.";
  };

  const setPendingCleanup = (progress: ItemLibraryDeletionProgress) => {
    setPendingCleanupRows((current) => [
      ...current.filter((entry) => entry.item._id !== progress.item._id),
      progress,
    ]);
  };

  const clearPendingCleanup = (id: string) => {
    setPendingCleanupRows((current) => current.filter((entry) => entry.item._id !== id));
  };

  const updateSelection = (id: string, selected: boolean) => {
    setSelectionState((current) => {
      const ids = current.scopeKey === selectionScopeKey
        ? new Set(current.ids)
        : new Set<string>();
      if (selected) ids.add(id);
      else ids.delete(id);
      return { scopeKey: selectionScopeKey, ids };
    });
  };

  const selectedResults = filteredList.filter((item) => selectedItemIds.has(item._id));
  const allResultsSelected = selectedResults.length > 0 && selectedResults.length === filteredList.length;
  const someResultsSelected = selectedResults.length > 0 && !allResultsSelected;
  let selectAllChecked: boolean | "indeterminate" = false;
  if (allResultsSelected) selectAllChecked = true;
  else if (someResultsSelected) selectAllChecked = "indeterminate";
  const searchResultsAreCurrent = !isSearchLoading && filteredSearchValue === searchValue;

  const runDeletion = async (items: ServiceItem[], confirmedOwner?: DeletionOwner) => {
    if (deleteInFlightRef.current || !items.length) return;
    deleteInFlightRef.current = true;
    setDeletionBusy(true);
    setDeletionNotice("");
    let completedCount = 0;
    let persistedDeleteCount = 0;
    let failedCount = 0;
    let pausedForSessionChange = false;

    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        let progress = deletionProgressByIdRef.current.get(item._id);
        if (!progress) {
          progress = createItemLibraryDeletionProgress(item);
          deletionProgressByIdRef.current.set(item._id, progress);
        }
        let owner = deletionOwnerByIdRef.current.get(item._id);
        if (!owner) {
          owner = confirmedOwner ?? captureDeletionOwner();
          deletionOwnerByIdRef.current.set(item._id, owner);
        }
        setDeletionProgressMessage(`Deleting ${index + 1} of ${items.length}: ${item.name}`);

        try {
          await deleteLibraryItemWithProgress({
            db: owner.db,
            progress,
            assertSessionCanContinue: () => {
              if (!isDeletionOwnerCurrent(owner!)) throw new Error(createDeletionOwnerError(owner!));
            },
            isOriginalOutlineOpen: () => {
              const current = currentOperationContextRef.current;
              return current.outlineOwnerKey === owner!.outlineOwnerKey &&
                current.outlineId === owner!.outlineId;
            },
            removeItemFromOpenOutline: () => dispatch(removeItemFromListById(item._id)),
            clearUndoHistory: () => dispatch(ActionCreators.clearHistory()),
            removeTimerFromStore: () => dispatch(deleteTimer(item._id)),
            removeTimerFromLocalStorage: () => {
              const storedValue = localStorage.getItem("timerInfo") || "[]";
              const storedTimers: unknown = JSON.parse(storedValue);
              if (!Array.isArray(storedTimers)) throw new Error("Saved timer storage is invalid.");
              const updatedTimers = storedTimers.filter((timer) =>
                typeof timer !== "object" || timer === null || !("id" in timer) || timer.id !== item._id,
              );
              localStorage.setItem("timerInfo", JSON.stringify(updatedTimers));
            },
            removeTimerFromFirebase: owner.firebaseDb
              ? async () => {
                const timersRef = ref(
                  owner!.firebaseDb!,
                  getChurchDataPath(owner!.firebaseChurchId, "timers"),
                );
                const snapshot = await get(timersRef);
                if (!isDeletionOwnerCurrent(owner!)) throw new Error(createDeletionOwnerError(owner!));
                const storedTimers: unknown = snapshot.val() ?? [];
                if (!Array.isArray(storedTimers)) throw new Error("Shared timer data is invalid.");
                const updatedTimers = storedTimers.filter((timer) =>
                  typeof timer !== "object" || timer === null || !("id" in timer) || timer.id !== item._id,
                );
                await set(timersRef, updatedTimers);
              }
              : undefined,
            removeSongAudio: owner.churchId
              ? async (document) => {
                await deleteSongAudioWithRetry({
                  churchId: owner!.churchId,
                  songId: item._id,
                  audio: document.songAudio!,
                });
              }
              : undefined,
          });
          deletionProgressByIdRef.current.delete(item._id);
          deletionOwnerByIdRef.current.delete(item._id);
          setDeletionErrors((current) => {
            const next = { ...current };
            delete next[item._id];
            return next;
          });
          clearPendingCleanup(item._id);
          updateSelection(item._id, false);
          completedCount += 1;
          persistedDeleteCount += 1;
        } catch (error) {
          const message = getDeletionMessage(error);
          setDeletionErrors((current) => ({ ...current, [item._id]: message }));
          failedCount += 1;
          if (progress.documentDeleted) {
            updateSelection(item._id, false);
            setPendingCleanup(progress);
            persistedDeleteCount += 1;
          } else {
            deletionProgressByIdRef.current.delete(item._id);
            deletionOwnerByIdRef.current.delete(item._id);
          }
          if (!isDeletionOwnerCurrent(owner)) {
            pausedForSessionChange = true;
            break;
          }
        }
      }

      const selectedCount = items.length;
      if (pausedForSessionChange) {
        setDeletionNotice("Deletion paused because the session or permission changed. Remaining items are still selected.");
      } else if (failedCount === 0) {
        setDeletionNotice(`Deleted ${completedCount} ${completedCount === 1 ? "item" : "items"}.`);
      } else {
        const deletedText = persistedDeleteCount
          ? `Deleted ${persistedDeleteCount} of ${selectedCount} ${selectedCount === 1 ? "item" : "items"}. `
          : "No items were deleted. ";
        setDeletionNotice(`${deletedText}${failedCount} ${failedCount === 1 ? "item needs" : "items need"} attention. See the item details below.`);
      }
    } finally {
      setDeletionProgressMessage("");
      setDeletionBusy(false);
      setDeleteConfirmation(null);
      deleteInFlightRef.current = false;
    }
  };

  const retryPendingCleanup = (progress: ItemLibraryDeletionProgress) => {
    void runDeletion([progress.item]);
  };

  const requestSingleDeletion = (item: ServiceItem) => {
    setDeletionNotice("");
    setDeleteConfirmation({ kind: "single", items: [item], owner: captureDeletionOwner() });
  };

  const requestBulkDeletion = () => {
    if (!showSelectionControls || !searchResultsAreCurrent || selectedResults.length === 0) return;
    setDeletionNotice("");
    setDeleteConfirmation({ kind: "bulk", items: selectedResults, owner: captureDeletionOwner() });
  };

  const confirmDeletion = () => {
    if (!deleteConfirmation) return;
    void runDeletion(deleteConfirmation.items, deleteConfirmation.owner);
  };

  const changeSearchValue = (value: string) => {
    if (value !== searchValue) {
      setSelectionState({
        scopeKey: JSON.stringify([value, effectiveFilter]),
        ids: new Set<string>(),
      });
      setDeleteConfirmation(null);
    }
    setSearchValue(value);
  };

  const updateShowWords = (show: boolean, index?: number) => {
    if (index === undefined) {
      const updatedList = filteredList.map((item) => ({
        ...item,
        showWords: show,
      }));
      setFilteredList(updatedList);
      setShowWords(show);
    } else {
      const updatedList = filteredList.map((item, i) => ({
        ...item,
        showWords: i === index ? show : item.showWords,
      }));
      const allShown = updatedList.every((item) => item.showWords);
      const allHidden = updatedList.every((item) => !item.showWords);
      if (allShown) setShowWords(true);
      if (allHidden) setShowWords(false);
      setFilteredList(updatedList);
    }
  };

  const normalizedExternalSearchValue = searchValue.trim();

  useEffect(() => {
    setExternalSearchQuery("");
    setExternalSearchResults([]);
    setExternalSearchError("");
  }, [searchValue, effectiveFilter]);

  const createSongFromExternalResult = (candidate: NormalizedLrclibTrack) => {
    dispatch(
      setCreateItem({
        ...initialCreateItemState,
        name: candidate.trackName,
        type: "song",
        hasUserSelectedType: true,
        text: getImportableLyricsFromTrack(candidate),
        songArtist: candidate.artistName,
        songAlbum: candidate.albumName || "",
        songMetadata: createSongMetadataFromLrclib(candidate),
        lyricsImportCandidates: [],
        lyricsImportError: "",
      }),
    );
    if (onCreateFromExternal) {
      onCreateFromExternal(candidate);
      return;
    }
    navigate(`${controllerBasePath}/create`);
  };

  const renderDisplayRow = (row: FilteredItemsVirtualRow, rowIndex: number) => {
    const sectionPosition = getExternalSectionPosition(rowIndex, displayRowKinds);

    if (row.kind === "external-section-header") {
      return (
        <div
          role="listitem"
          className={cn(
            "px-4 py-2 text-center",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/80">
            External lyrics
          </p>
          <p className="text-sm text-gray-400">
            Matching &ldquo;{externalSearchQuery}&rdquo;
          </p>
        </div>
      );
    }

    if (row.kind === "external-section-footer") {
      return (
        <div
          role="separator"
          aria-label="End of search results"
          className="mb-3 flex items-center gap-3 px-3 py-2"
        >
          <div className="h-px flex-1 bg-cyan-500/25" />
          <span className="shrink-0 text-xs text-gray-400">End of search results</span>
          <div className="h-px flex-1 bg-cyan-500/25" />
        </div>
      );
    }

    if (row.kind === "external-loading") {
      return (
        <div
          role="listitem"
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-6 text-sm text-gray-300",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          <Spinner />
          <span>Searching external lyrics...</span>
        </div>
      );
    }

    if (row.kind === "external-error") {
      return (
        <p
          role="listitem"
          className={cn(
            "px-4 py-3 text-sm text-red-300",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          {row.message}
        </p>
      );
    }

    if (row.kind === "external-empty") {
      return (
        <p
          role="listitem"
          className={cn(
            "px-4 py-3 text-sm text-gray-400",
            alternatingAdminListRowBg(rowIndex),
            getExternalSectionClassName(sectionPosition),
          )}
        >
          No external matches found.
        </p>
      );
    }

    if (row.kind === "external") {
      return (
        <ExternalLyricsResultItem
          index={rowIndex}
          candidate={row.candidate}
          searchValue={normalizedExternalSearchValue}
          sectionPosition={sectionPosition}
          onCreateSong={createSongFromExternalResult}
          onViewLyrics={setViewExternalLyricsCandidate}
        />
      );
    }

    return renderFilteredItem(row.item, rowIndex, row.libraryIndex);
  };

  const renderFilteredItem = (
    item: filteredItemsListType,
    rowIndex: number,
    libraryIndex: number,
  ) => (
    <FilteredItem
      key={item._id}
      item={item}
      index={rowIndex}
      showWords={item.showWords ?? showWords}
      updateShowWords={updateShowWords}
      addItemToList={
        onAddItem
          ? (_item) => onAddItem(_item)
          : (_item) => dispatch(addItemToItemList(_item))
      }
      setItemToBeDeleted={requestSingleDeletion}
      searchValue={filteredSearchValue}
      artistName={songArtistById.get(item._id)}
      canMutateLibrary={canMutateLibrary}
      showAddButton={allowAdd}
      showDelete={allowDelete}
      addButtonLabel={addButtonLabel}
      useDetailsGrid={useDetailsGrid}
      libraryColumns={showLibraryControls}
      selectionMode={selectionMode && showSelectionControls}
      selected={selectedItemIds.has(item._id)}
      onSelectionChange={(selected) => updateSelection(item._id, selected)}
      auditDisplay={showLibraryControls ? getItemLibraryAuditDisplay(docsById.get(item._id)) : undefined}
      onViewDetails={
        (item.type === "song" || item.type === "free") &&
        (type !== "all" || effectiveFilter === "all" || effectiveFilter === item.type)
          ? () => {
            if (item.type === "song") {
              setViewSectionsSongId(item._id);
            } else {
              setCustomItemForDetails({ id: item._id, name: item.name });
            }
          }
          : undefined
      }
      viewDetailsAriaLabel={`View ${item.type === "song" ? "song" : "custom item"} details for ${item.name}`}
      libraryIndex={libraryIndex}
    />
  );

  const searchExternalLyrics = async () => {
    if (!normalizedExternalSearchValue) {
      setExternalSearchError("Enter lyrics to search first.");
      return;
    }

    const cacheKey = normalizedExternalSearchValue.toLowerCase();
    const cachedResults = externalSearchCacheRef.current.get(cacheKey);

    setExternalSearchError("");
    setExternalSearchQuery(normalizedExternalSearchValue);

    if (cachedResults) {
      setExternalSearchResults(cachedResults);
      setIsExternalSearchLoading(false);
      return;
    }

    setIsExternalSearchLoading(true);
    setExternalSearchResults([]);

    try {
      const results = await searchLrclibTracks({
        trackName: normalizedExternalSearchValue,
      });
      externalSearchCacheRef.current.set(cacheKey, results);
      setExternalSearchResults(results);
    } catch (error) {
      console.error("External lyrics search failed:", error);
      setExternalSearchResults([]);
      setExternalSearchError("Could not search external lyrics right now.");
    } finally {
      setIsExternalSearchLoading(false);
    }
  };

  const changeLibraryFilter = (filter: LibraryFilter) => {
    if (filter === effectiveFilter) return;
    setSelectionState({ scopeKey: JSON.stringify([searchValue, filter]), ids: new Set<string>() });
    setDeleteConfirmation(null);
    onLibraryFilterChange?.(filter);
    setSearchResults({ list: searchItems(searchValue, filter), query: searchValue });
    setDebouncedSearchValue(searchValue);
    setIsSearchLoading(false);
    listScrollRef.current?.scrollTo?.({ top: 0 });
  };
  const createLabel = getCreateLabel(type, effectiveFilter, label);
  const createLink =
    type === "all" && effectiveFilter === "all"
      ? `${controllerBasePath}/create`
      : `${controllerBasePath}/create?type=${type === "all" ? effectiveFilter : type}&name=${encodeURI(searchValue)}`;
  const confirmationItemCount = deleteConfirmation?.items.length ?? 0;
  const confirmationItemName = deleteConfirmation?.kind === "bulk"
    ? `${confirmationItemCount} selected ${confirmationItemCount === 1 ? "item" : "items"}`
    : deleteConfirmation?.items[0]?.name;
  const deleteWarning = deletionBusy
    ? deletionProgressMessage || "Deleting selected items..."
    : "This is permanent. Matching occurrences will be removed from the open outline and undo history will be cleared. Other saved outlines remain separate.";
  const itemNameById = new Map(listForFilter.map((item) => [item._id, item.name]));

  return (
    <div
      className={cn(
        "flex h-full w-full max-w-none flex-col items-stretch px-2 py-4",
        className,
      )}
    >
      <DeleteModal
        isOpen={!!deleteConfirmation}
        onClose={() => setDeleteConfirmation(null)}
        onConfirm={confirmDeletion}
        itemName={confirmationItemName}
        title={deleteConfirmation?.kind === "bulk" ? "Delete selected items" : "Confirm Deletion"}
        message="Delete"
        warningMessage={deleteWarning}
        confirmText={deleteConfirmation?.kind === "bulk" ? "Delete selected" : "Delete Forever"}
        isConfirming={deletionBusy}
        confirmingLabel="Deleting..."
      />
      <ViewSongSectionsDrawer
        song={viewSongDoc}
        isOpen={Boolean(viewSectionsSongId && viewSongDoc)}
        searchHighlight={filteredSearchValue}
        onClose={() => setViewSectionsSongId(null)}
      />
      <ServicePlanCustomDocumentPreviewDialog
        document={viewCustomDocument}
        unavailableName={
          customItemForDetails && !viewCustomDocument
            ? customItemForDetails.name
            : undefined
        }
        onClose={() => setCustomItemForDetails(null)}
      />
      <ViewExternalLyricsDrawer
        candidate={viewExternalLyricsCandidate}
        isOpen={Boolean(viewExternalLyricsCandidate)}
        isMobile={isMobile}
        searchHighlight={normalizedExternalSearchValue}
        onClose={() => setViewExternalLyricsCandidate(null)}
      />
      {!hideHeading ? (
        <h2 className="mb-2 w-full text-center text-2xl">{heading}</h2>
      ) : null}
      {isLoading && (
        <h3 className="text-lg text-center">{heading} are loading...</h3>
      )}
      <div className="mb-2 flex w-full flex-col justify-center gap-2 sm:mb-3 sm:flex-row">
        <SongSearchInput
          value={searchValue}
          disabled={isLoading}
          onChange={changeSearchValue}
          label="Search"
          labelClassName={searchLabelClassName}
          inputClassName={searchInputClassName}
          className="text-base flex w-full flex-1 gap-2 items-center sm:max-w-2xl"
          placeholder=""
          showSearchIconWhenEmpty={false}
        />
        <Button
          disabled={!searchValue}
          onClick={() => updateShowWords(!showWords)}
          svg={WholeWord}
        >
          {showWords ? "Hide" : "Show"} All{" "}
        </Button>
      </div>
      {type === "all" && onLibraryFilterChange ? (
        <div
          role="group"
          aria-label="Item type filters"
          className="mb-3 flex w-full flex-wrap items-center justify-center gap-1"
        >
          {([
            ["all", "All Items"],
            ["song", "Songs"],
            ["free", "Custom"],
            ["timer", "Timers"],
          ] as const).map(([filter, title]) => (
            <Button
              key={filter}
              type="button"
              variant="tertiary"
              isSelected={effectiveFilter === filter}
              aria-pressed={effectiveFilter === filter}
              className={cn(
                "!min-h-8 border px-3 py-1 text-sm",
                effectiveFilter === filter
                  ? "border-cyan-300/50 bg-cyan-500/20 text-cyan-100 shadow-inner"
                  : "border-transparent text-gray-300 hover:border-gray-500 hover:bg-gray-500/20",
              )}
              onClick={() => changeLibraryFilter(filter)}
            >
              {title}
            </Button>
          ))}
        </div>
      ) : null}
      {showLibraryControls ? (
        <section className="mb-3 flex w-full flex-wrap items-end justify-end gap-3" aria-label="Library tools">
          {showSelectionControls ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="tertiary"
                aria-pressed={selectionMode}
                disabled={deletionBusy}
                onClick={() => {
                  if (selectionMode) {
                    setSelectionMode(false);
                    setSelectionState({ scopeKey: selectionScopeKey, ids: new Set<string>() });
                  } else {
                    setSelectionMode(true);
                  }
                }}
              >
                {selectionMode ? "Done selecting" : "Select items"}
              </Button>
              {selectionMode ? (
                <>
                  <Checkbox
                    label="Select all results"
                    checked={selectAllChecked}
                    disabled={deletionBusy || !searchResultsAreCurrent || filteredList.length === 0}
                    onCheckedChange={(checked) => setSelectionState({
                      scopeKey: selectionScopeKey,
                      ids: checked
                        ? new Set(filteredList.map((item) => item._id))
                        : new Set<string>(),
                    })}
                    className="min-h-8"
                  />
                  <span className="text-sm text-gray-300" role="status" aria-live="polite">
                    {selectedResults.length} selected
                  </span>
                  <Button
                    type="button"
                    variant="tertiary"
                    color="red"
                    disabled={deletionBusy || !searchResultsAreCurrent || selectedResults.length === 0}
                    onClick={requestBulkDeletion}
                  >
                    Delete selected
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {deletionProgressMessage ? (
        <p className="mb-2 text-sm text-cyan-200" role="status" aria-live="polite">
          {deletionProgressMessage}
        </p>
      ) : null}
      {deletionNotice ? (
        <p className="mb-2 text-sm text-gray-200" role="status" aria-live="polite">
          {deletionNotice}
        </p>
      ) : null}
      {Object.keys(deletionErrors).length > 0 ? (
        <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm" role="alert">
          <p className="font-medium text-amber-200">Items that need attention</p>
          <ul className="mt-1 space-y-1 text-amber-100">
            {Object.entries(deletionErrors).map(([id, message]) => (
              <li key={id}>
                <span className="font-medium">{itemNameById.get(id) ?? pendingCleanupRows.find((row) => row.item._id === id)?.item.name ?? id}:</span> {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pendingCleanupRows.length > 0 ? (
        <section className="mb-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2" aria-label="Deletion cleanup to retry">
          <h3 className="text-sm font-medium text-amber-200">Cleanup still needs attention</h3>
          <ul className="mt-1 space-y-2">
            {pendingCleanupRows.map((progress) => {
              const owner = deletionOwnerByIdRef.current.get(progress.item._id);
              const canRetry = Boolean(owner && allowDelete && isDeletionOwnerCurrent(owner));
              return (
                <li key={progress.item._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-amber-100">{progress.item.name}</span>
                  <Button
                    type="button"
                    variant="tertiary"
                    disabled={deletionBusy || !canRetry}
                    onClick={() => retryPendingCleanup(progress)}
                    aria-label={`Retry cleanup for ${progress.item.name}`}
                  >
                    Retry cleanup
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {allowCreateAndExternal ? (
        <div className="mb-2 flex flex-col gap-3">
          <section className="text-sm flex flex-wrap gap-2 items-center justify-center">
            <p>Can't find what you're looking for?</p>
            {onCreateNew ? (
              <Button
                variant="secondary"
                className="relative"
                svg={FilePlus}
                color="#84cc16"
                onClick={onCreateNew}
              >
                Create a new {createLabel}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="relative"
                svg={FilePlus}
                color="#84cc16"
                component="link"
                to={createLink}
                aria-label={`Create a new ${createLabel}`}
              >
                Create a new {createLabel}
              </Button>
            )}
            {showExternalSearch && (
              <Button
                variant="tertiary"
                className="relative"
                svg={Search}
                color="#22d3ee"
                onClick={searchExternalLyrics}
                disabled={!normalizedExternalSearchValue || isExternalSearchLoading}
              >
                {isExternalSearchLoading ? "Searching..." : "Search external lyrics"}
              </Button>
            )}
          </section>
        </div>
      ) : null}
      {pinnedTopContent && (
        <div className="mb-2 px-1 sm:px-2">{pinnedTopContent}</div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {isSearchLoading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-gray-800/35">
            <Spinner />
          </div>
        )}
        {showLibraryControls && !isLoading ? (
          <div
            className={cn(
              "mx-1 grid items-center gap-1 overflow-y-hidden border-b border-gray-700 bg-gray-950 px-4 py-1.5 text-gray-300 [scrollbar-gutter:stable] sm:mx-2",
              selectionMode && showSelectionControls
                ? FILTERED_LIBRARY_SELECTION_GRID_COLUMNS
                : FILTERED_LIBRARY_GRID_COLUMNS,
            )}
            style={
              libraryScrollbarGutterWidth > 0
                ? { clipPath: `inset(0 ${libraryScrollbarGutterWidth}px 0 0)` }
                : undefined
            }
            role="group"
            aria-label="Sort library results by column"
          >
            {selectionMode && showSelectionControls ? <span aria-hidden="true" /> : null}
            <span
              className={cn(
                "col-start-1 flex items-center justify-center",
                selectionMode && showSelectionControls && "col-start-2",
              )}
              role="img"
              aria-label="Type"
              title="Type"
            >
              <Tag size={14} aria-hidden="true" />
            </span>
            <SortableColumnButton
              label="Name"
              ariaLabel={sortOverride === "name" ? `Name, sorted ${sortDirection}` : "Sort by Name"}
              direction={sortOverride === "name" ? sortDirection : undefined}
              onClick={() => changeLibrarySort("name")}
            />
            <SortableColumnButton
              label="Updated"
              ariaLabel={sortOverride === "updatedAt" ? `Updated, sorted ${sortDirection}` : "Sort by Updated"}
              direction={sortOverride === "updatedAt" ? sortDirection : undefined}
              onClick={() => changeLibrarySort("updatedAt")}
            />
            <SortableColumnButton
              label="Updated by"
              ariaLabel={sortOverride === "updatedBy" ? `Updated by, sorted ${sortDirection}` : "Sort by Updated by"}
              direction={sortOverride === "updatedBy" ? sortDirection : undefined}
              onClick={() => changeLibrarySort("updatedBy")}
            />
            <span aria-hidden="true" />
          </div>
        ) : null}
        <div
          ref={listScrollRef}
          data-testid="filtered-items-results"
          className="scrollbar-variable min-h-0 w-full flex-1 overflow-y-auto px-1 [scrollbar-gutter:stable] sm:px-2"
          role="list"
          aria-busy={isSearchLoading || filteredSearchValue !== searchValue}
          data-search-query={filteredSearchValue}
        >
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = displayRows[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {row ? renderDisplayRow(row, virtualItem.index) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilteredItems;
