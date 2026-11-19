import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../../hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FilePlus, Search, Tag, Trash2, WholeWord } from "lucide-react";
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
import type { RootState } from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useOptionalTransferActions, type DeletionSessionIdentity } from "../../context/transferContext";
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
import { deleteTimer } from "../../store/timersSlice";
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
import { getContentDatabaseSessionToken } from "../../utils/contentReplicationActivity";
import { removeFirebaseTimerWithTransaction } from "../../utils/firebaseTimerDeletion";
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
} from "../../utils/itemLibraryDeletion";
import type { Transfer } from "../../context/transferModel";
import {
  getItemLibrarySourceIndices,
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

type DeleteConfirmation = { kind: "single" | "bulk"; items: ServiceItem[]; owner: DeletionOwner | null };
type DeletionOwner = DeletionSessionIdentity & {
  outlineOwnerKey?: string;
  outlineId?: string;
  outlineSession: number;
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
  const store = useStore<RootState>();
  const transferActions = useOptionalTransferActions();
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
  const librarySourceIndices = useMemo(
    () => getItemLibrarySourceIndices(filteredList),
    [filteredList],
  );
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [selectionState, setSelectionState] = useState({
    scopeKey: "",
    ids: new Set<string>(),
  });
  const selectionScopeKey = JSON.stringify([searchValue, effectiveFilter]);
  const selectedItemIds = selectionState.scopeKey === selectionScopeKey
    ? selectionState.ids
    : new Set<string>();
  const [deletionNotice, setDeletionNotice] = useState("");

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
      rows.push({ kind: "library", item, libraryIndex: librarySourceIndices.get(item) ?? -1 });
    });

    return rows;
  }, [
    showExternalSearch,
    externalSearchQuery,
    isExternalSearchLoading,
    externalSearchError,
    externalSearchResults,
    filteredList,
    librarySourceIndices,
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
  useEffect(() => {
    transferActions?.updateDeletionSessionIdentity({
      db,
      contentSessionToken: db ? getContentDatabaseSessionToken(db.name) : null,
    });
  }, [db, transferActions]);
  const { mode } = usePresentationControllerMode();
  const canMutateLibrary = !isViewOnlyAccess(access);
  const allowDelete = (showDelete ?? canMutateLibrary) && mode === "edit";
  const outlineOwnerKey = useSelector((state) => state.undoable?.present?.itemList?.outlineOwnerKey);
  const outlineId = useSelector((state) => state.undoable?.present?.itemList?.loadedOutlineId);
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

  const captureDeletionOwner = (): DeletionOwner | null => {
    const identity = transferActions?.getCurrentDeletionSessionIdentity();
    if (!identity || !allowDelete || identity.db !== db || identity.churchId !== (churchId ?? "") ||
      identity.userId !== (userId ?? "") || identity.sessionKind !== (sessionKind ?? null)) return null;
    const firebaseDb = identity.firebaseDb && identity.firebaseChurchId === identity.churchId
      ? identity.firebaseDb
      : undefined;
    return {
      ...identity,
      firebaseDb,
      firebaseChurchId: firebaseDb ? identity.firebaseChurchId : "",
      contentSessionToken: db ? getContentDatabaseSessionToken(db.name) : null,
      outlineOwnerKey,
      outlineId,
      outlineSession: store.getState().allDocs?.session ?? 0,
    };
  };

  const isDeletionOwnerCurrent = useCallback((owner: DeletionOwner) => {
    const current = transferActions?.getCurrentDeletionSessionIdentity();
    if (!current || isViewOnlyAccess(current.access as never)) return false;
    if (
      current.db !== owner.db ||
      current.database !== owner.database ||
      current.churchId !== owner.churchId ||
      current.userId !== owner.userId ||
      current.sessionKind !== owner.sessionKind ||
      current.loginState !== owner.loginState ||
      current.contentSessionToken !== owner.contentSessionToken
    ) return false;
    if (owner.firebaseDb && (
      current.firebaseDb !== owner.firebaseDb ||
      current.firebaseChurchId !== owner.firebaseChurchId
    )) return false;
    const state = store.getState();
    return state.allDocs?.session === owner.outlineSession &&
      state.undoable?.present?.itemList?.outlineOwnerKey === owner.outlineOwnerKey &&
      state.undoable?.present?.itemList?.loadedOutlineId === owner.outlineId;
  }, [store, transferActions]);

  const createDeletionOwnerError = (owner: DeletionOwner) => {
    const current = transferActions?.getCurrentDeletionSessionIdentity();
    if (!current || isViewOnlyAccess(current.access as never)) return "You no longer have permission to complete this deletion. Refresh your access and try again.";
    if (current.db !== owner.db || current.database !== owner.database || current.churchId !== owner.churchId ||
      current.userId !== owner.userId || current.sessionKind !== owner.sessionKind ||
      current.loginState !== owner.loginState || current.contentSessionToken !== owner.contentSessionToken) {
      return "Your session changed before deletion finished. Return to the original session and retry cleanup.";
    }
    const state = store.getState();
    if (state.allDocs?.session !== owner.outlineSession ||
      state.undoable?.present?.itemList?.outlineOwnerKey !== owner.outlineOwnerKey ||
      state.undoable?.present?.itemList?.loadedOutlineId !== owner.outlineId) {
      return "The open outline changed before deletion finished. Return to the original outline and retry cleanup.";
    }
    return "The shared database session changed before cleanup finished. Return to the original session and retry.";
  };

  useEffect(() => {
    if (!deleteConfirmation) return;
    const currentIds = new Set(listForFilter.map((item) => item._id));
    const owner = deleteConfirmation.owner;
    if (!owner) {
      setDeleteConfirmation(null);
      return;
    }
    const ownerStillCurrent = allowDelete && db === owner.db &&
      (churchId ?? "") === owner.churchId && userId === owner.userId &&
      sessionKind === owner.sessionKind && outlineOwnerKey === owner.outlineOwnerKey &&
      outlineId === owner.outlineId &&
      isDeletionOwnerCurrent(owner);
    if (!ownerStillCurrent ||
      deleteConfirmation.items.some((item) => !currentIds.has(item._id))) {
      setDeleteConfirmation(null);
    }
  }, [
    allowDelete,
    churchId,
    db,
    deleteConfirmation,
    isDeletionOwnerCurrent,
    listForFilter,
    mode,
    outlineId,
    outlineOwnerKey,
    sessionKind,
    userId,
    transferActions,
  ]);

  const getDeletionMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (/song.*migrated|SONG_V2_DELETION_DEFERRED/i.test(message)) {
      return "This song uses the V2 format and can't be deleted yet.";
    }
    if (/not available/i.test(message)) return message;
    if (/session|original outline|shared database/i.test(message)) return message;
    if (/permission|unauthorized|forbidden|\b403\b/i.test(message)) {
      return "You no longer have permission to complete this deletion. Refresh your access and try again.";
    }
    if (/not found|\b404\b/i.test(message)) {
      return "The saved item could not be found. Refresh the library and try again.";
    }
    if (/saved item has changed/i.test(message)) return message;
    return "Could not complete this deletion. Check the connection and try again.";
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

  const startDeletionActivity = (items: ServiceItem[], owner: DeletionOwner) => {
    if (!transferActions || !items.length) return;
    const uniqueItems = [...new Map(items.map((item) => [item._id, item])).values()];
    const entries = uniqueItems.map((item) => ({
      item,
      progress: createItemLibraryDeletionProgress(item),
      status: "queued" as "queued" | "active" | "complete" | "failed",
      error: undefined as string | undefined,
    }));
    const transferId = `item-library-deletion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let running = false;
    let unregisterRetry: (() => void) | undefined;
    const buildTransfer = (): Transfer => {
      const completedCount = entries.filter((entry) => entry.progress.complete).length;
      const unfinishedCount = entries.length - completedCount;
      const activeEntry = entries.find((entry) => entry.status === "active");
      const errors = entries.flatMap((entry) => entry.error ? [`${entry.item.name}: ${entry.error}`] : []);
      const status: Transfer["status"] = unfinishedCount === 0
        ? "complete"
        : running
          ? "active"
          : completedCount > 0
            ? "partial"
            : "failed";
      return {
        id: transferId,
        type: "Item library deletion",
        name: entries.length === 1 ? entries[0].item.name : `${entries.length} library items`,
        status,
        progress: entries.length ? (completedCount / entries.length) * 100 : 100,
        phase: {
          key: status,
          label: status === "complete" ? "Deletion complete" : running ? "Deleting library items" : "Deletion needs attention",
          ...(running ? { current: completedCount + 1, total: entries.length } : {}),
        },
        detail: activeEntry
          ? `Deleting ${activeEntry.item.name}`
          : status === "complete"
            ? `${completedCount} ${completedCount === 1 ? "item deleted" : "items deleted"}`
            : `${completedCount} of ${entries.length} deleted; ${unfinishedCount} need attention`,
        ...(errors.length ? { error: { message: errors.join(" ") } } : {}),
        files: entries.map((entry, index) => ({
          id: `${transferId}-${index}`,
          name: entry.item.name,
          status: entry.progress.complete ? "complete" as const : entry.status,
          progress: entry.progress.complete ? 100 : entry.status === "active" ? 0 : null,
          ...(entry.error ? { error: entry.error } : {}),
        })),
        blocksUnload: unfinishedCount > 0,
        actions: unfinishedCount > 0
          ? [{ key: "retry-deletion", label: running ? "Retrying deletion..." : "Retry unfinished deletion", pending: running }]
          : [{ key: "dismiss", label: "Dismiss" }],
      };
    };
    const publish = () => transferActions.updateTransfer(buildTransfer());
    const retry = async () => {
      if (running) return;
      running = true;
      publish();
      try {
        for (const entry of entries) {
          if (entry.progress.complete) continue;
          entry.status = "active";
          entry.error = undefined;
          publish();
          try {
            await deleteLibraryItemWithProgress({
              db: owner.db,
              progress: entry.progress,
              assertSessionCanContinue: () => {
                if (!isDeletionOwnerCurrent(owner)) throw new Error(createDeletionOwnerError(owner));
              },
              isOriginalOutlineOpen: () => {
                const state = store.getState();
                return state.undoable?.present?.itemList?.outlineOwnerKey === owner.outlineOwnerKey &&
                  state.undoable?.present?.itemList?.loadedOutlineId === owner.outlineId;
              },
              removeItemFromOpenOutline: () => store.dispatch(removeItemFromListById(entry.item._id)),
              clearUndoHistory: () => store.dispatch(ActionCreators.clearHistory()),
              removeTimerFromStore: () => store.dispatch(deleteTimer(entry.item._id)),
              removeTimerFromLocalStorage: () => {
                const storedValue = localStorage.getItem("timerInfo") || "[]";
                const storedTimers: unknown = JSON.parse(storedValue);
                if (!Array.isArray(storedTimers)) throw new Error("Saved timer storage is invalid.");
                const updatedTimers = storedTimers.filter((timer) =>
                  typeof timer !== "object" || timer === null || !("id" in timer) || timer.id !== entry.item._id,
                );
                localStorage.setItem("timerInfo", JSON.stringify(updatedTimers));
              },
              removeTimerFromFirebase: owner.firebaseDb
                ? () => removeFirebaseTimerWithTransaction({
                  db: owner.firebaseDb!,
                  churchId: owner.firebaseChurchId,
                  timerId: entry.item._id,
                  isAuthorized: () => isDeletionOwnerCurrent(owner) &&
                    transferActions.getCurrentDeletionSessionIdentity().canWriteTimers,
                })
                : undefined,
              removeSongAudio: owner.churchId
                ? async (document) => {
                  await deleteSongAudioWithRetry({
                    churchId: owner.churchId,
                    songId: entry.item._id,
                    audio: document.songAudio!,
                  });
                }
                : undefined,
            });
            entry.status = "complete";
          } catch (error) {
            entry.status = "failed";
            entry.error = getDeletionMessage(error);
          }
          publish();
          if (!isDeletionOwnerCurrent(owner)) break;
        }
      } finally {
        running = false;
        publish();
        if (entries.every((entry) => entry.progress.complete)) unregisterRetry?.();
      }
    };

    transferActions.updateTransfer(buildTransfer());
    unregisterRetry = transferActions.registerTransferAction(transferId, "retry-deletion", retry);
    setDeleteConfirmation(null);
    setDeletionNotice("Deletion started. Progress and any required cleanup are available in Activity.");
    void retry();
  };

  const requestSingleDeletion = (item: ServiceItem) => {
    setDeletionNotice("");
    const owner = captureDeletionOwner();
    if (!owner) {
      setDeletionNotice("Deletion is unavailable until the original session and Activity provider are ready.");
      return;
    }
    setDeleteConfirmation({ kind: "single", items: [item], owner });
  };

  const requestBulkDeletion = () => {
    if (!showSelectionControls || !searchResultsAreCurrent || selectedResults.length === 0) return;
    setDeletionNotice("");
    const owner = captureDeletionOwner();
    if (!owner) {
      setDeletionNotice("Deletion is unavailable until the original session and Activity provider are ready.");
      return;
    }
    setDeleteConfirmation({ kind: "bulk", items: selectedResults, owner });
  };

  const confirmDeletion = () => {
    if (!deleteConfirmation) return;
    const owner = deleteConfirmation.owner;
    if (!owner || !isDeletionOwnerCurrent(owner)) {
      setDeleteConfirmation(null);
      setDeletionNotice(owner
        ? createDeletionOwnerError(owner)
        : "Deletion is unavailable until the original session and Activity provider are ready.");
      return;
    }
    startDeletionActivity(deleteConfirmation.items, owner);
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
      selectionMode={showSelectionControls}
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
  const deleteWarning = "This is permanent. Matching occurrences will be removed from the open outline and undo history will be cleared. Other saved outlines remain separate.";

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
      {deletionNotice ? (
        <p className="mb-2 text-sm text-gray-200" role="status" aria-live="polite">
          {deletionNotice}
        </p>
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
              "mx-1 grid items-center gap-1 overflow-y-hidden border-b border-gray-700 bg-gray-950 px-4 py-1 text-gray-300 [scrollbar-gutter:stable] sm:mx-2",
              showSelectionControls
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
            {showSelectionControls ? (
              <Checkbox
                label="Select all results"
                hideLabel
                checked={selectAllChecked}
                disabled={!searchResultsAreCurrent || filteredList.length === 0}
                onCheckedChange={(checked) => setSelectionState({
                  scopeKey: selectionScopeKey,
                  ids: checked
                    ? new Set(filteredList.map((item) => item._id))
                    : new Set<string>(),
                })}
                className="col-start-1 row-start-1 justify-self-center"
              />
            ) : null}
            <span
              className={cn(
                "col-start-1 flex items-center justify-center",
                showSelectionControls && "col-start-2",
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
            {showSelectionControls ? (
              <div
                className="col-start-3 col-span-3 row-start-2 flex min-w-0 items-center justify-end gap-2 md:col-start-6 md:col-span-1 md:row-start-1 md:gap-3"
                role="group"
                aria-label="Selected item actions"
              >
                <Button
                  type="button"
                  variant="tertiary"
                  color="red"
                  className={cn(
                    "min-h-7 whitespace-nowrap",
                    selectedResults.length === 0 && "invisible",
                  )}
                  padding="px-2 py-1"
                  svg={Trash2}
                  disabled={!searchResultsAreCurrent || selectedResults.length === 0}
                  onClick={requestBulkDeletion}
                >
                  Delete selected ({selectedResults.length})
                </Button>
              </div>
            ) : (
              <span aria-hidden="true" />
            )}
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
