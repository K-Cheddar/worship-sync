import { useState, useCallback, useEffect, useRef } from "react";
import { MediaType } from "../types";

const emptyMedia: MediaType = {
  id: "",
  background: "",
  type: "image",
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "",
  height: 0,
  width: 0,
  publicId: "",
  name: "",
  thumbnail: "",
  placeholderImage: "",
  frameRate: 0,
  duration: 0,
  hasAudio: false,
  source: "cloudinary",
  folderId: null,
};

interface UseMediaSelectionOptions {
  mediaList: MediaType[];
  filteredList?: MediaType[];
  enableRangeSelection?: boolean;
}

interface UseMediaSelectionReturn {
  selectedMedia: MediaType;
  selectedMediaIds: Set<string>;
  previewMedia: MediaType | null;
  lastSelectedIndex: number;
  /** True after long-press / right-click enter; plain taps toggle like Ctrl until cleared. */
  mediaMultiSelectMode: boolean;
  setSelectedMedia: (media: MediaType) => void;
  setSelectedMediaIds: (
    ids: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  setPreviewMedia: (media: MediaType | null) => void;
  setLastSelectedIndex: (index: number) => void;
  handleMediaClick: (
    e: React.MouseEvent,
    mediaItem: MediaType,
    index: number,
  ) => void;
  /** Long-press (touch) or right-click — mirrors item-slide background-target enter. */
  enterMediaMultiSelectMode: (
    mediaItem: MediaType,
    index: number,
    options?: { skipNextClick?: boolean },
  ) => void;
  clearSelection: () => void;
  /** When media rows disappear (e.g. delete), prune selection and leave multi-select mode. */
  reconcileSelectionWithMediaList: (stillPresentList: MediaType[]) => void;
}

export const useMediaSelection = ({
  mediaList,
  filteredList,
  enableRangeSelection = true,
}: UseMediaSelectionOptions): UseMediaSelectionReturn => {
  const [selectedMedia, setSelectedMedia] = useState<MediaType>(emptyMedia);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(
    new Set(),
  );
  const [previewMedia, setPreviewMedia] = useState<MediaType | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
  const [mediaMultiSelectMode, setMediaMultiSelectMode] = useState(false);
  const skipNextMediaClickRef = useRef(false);
  /** Index in `filteredList || mediaList` for Shift+range; stays fixed until plain select / clear / enter. */
  const rangeAnchorIndexRef = useRef<number>(-1);
  /** Ignore duplicate enter for the same tile when long-press and `contextmenu` both fire (key by id, not list index). */
  const lastEnterSameMediaAtRef = useRef<{ id: string; t: number } | null>(
    null,
  );

  // Replace stale object references when the library updates (e.g. rename in Redux).
  useEffect(() => {
    setSelectedMedia((prev) => {
      if (!prev.id || !selectedMediaIds.has(prev.id)) return prev;
      const fresh = mediaList.find((item) => item.id === prev.id);
      return fresh && fresh !== prev ? fresh : prev;
    });
    setPreviewMedia((prev) => {
      if (!prev || !selectedMediaIds.has(prev.id)) return prev;
      const fresh = mediaList.find((item) => item.id === prev.id);
      return fresh && fresh !== prev ? fresh : prev;
    });
  }, [mediaList, selectedMediaIds]);

  const enterMediaMultiSelectMode = useCallback(
    (
      mediaItem: MediaType,
      index: number,
      options?: { skipNextClick?: boolean },
    ) => {
      const pressedId = mediaItem.id;
      if (!pressedId) return;

      const now = Date.now();
      const last = lastEnterSameMediaAtRef.current;
      if (last && last.id === pressedId && now - last.t < 400) return;
      lastEnterSameMediaAtRef.current = { id: pressedId, t: now };

      const currentPrimaryId = selectedMedia.id;
      const ids =
        currentPrimaryId &&
        currentPrimaryId !== pressedId &&
        selectedMediaIds.size <= 1
          ? [currentPrimaryId, pressedId]
          : [pressedId];

      setSelectedMediaIds(new Set(ids));
      setSelectedMedia(mediaItem);
      setPreviewMedia(mediaItem);
      setLastSelectedIndex(index);
      rangeAnchorIndexRef.current = index;
      setMediaMultiSelectMode(true);
      if (options?.skipNextClick) {
        skipNextMediaClickRef.current = true;
      }
    },
    [selectedMedia.id, selectedMediaIds],
  );

  const handleMediaClick = useCallback(
    (e: React.MouseEvent, mediaItem: MediaType, index: number) => {
      if (skipNextMediaClickRef.current) {
        skipNextMediaClickRef.current = false;
        e.preventDefault();
        return;
      }
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const listToUse = filteredList || mediaList;

      const applyToggle = (
        item: MediaType,
        idx: number,
        skipPreview: boolean,
      ) => {
        const newSet = new Set(selectedMediaIds);
        if (newSet.has(item.id)) {
          newSet.delete(item.id);
          setSelectedMediaIds(newSet);
          if (newSet.size === 0) {
            setSelectedMedia(emptyMedia);
            setPreviewMedia(null);
            setMediaMultiSelectMode(false);
            rangeAnchorIndexRef.current = -1;
          } else if (selectedMedia.id === item.id) {
            const firstId = Array.from(newSet)[0];
            const firstItem = mediaList.find((idItem) => idItem.id === firstId);
            if (firstItem) {
              setSelectedMedia(firstItem);
              if (!skipPreview) {
                setPreviewMedia(firstItem);
              }
            }
          }
        } else {
          newSet.add(item.id);
          setSelectedMediaIds(newSet);
          setSelectedMedia(item);
          if (!skipPreview) {
            setPreviewMedia(item);
          }
          if (newSet.size > 1) {
            setMediaMultiSelectMode(true);
          }
        }
        setLastSelectedIndex(idx);
      };

      // Shift+range before Ctrl/Cmd so Shift+Meta (e.g. Mac) extends a range instead of toggling one item.
      // Range always spans from the sticky anchor to the clicked index (common list UX).
      if (
        isShift &&
        enableRangeSelection &&
        (rangeAnchorIndexRef.current >= 0 || lastSelectedIndex >= 0)
      ) {
        const anchorIdx =
          rangeAnchorIndexRef.current >= 0
            ? rangeAnchorIndexRef.current
            : lastSelectedIndex;
        if (rangeAnchorIndexRef.current < 0 && anchorIdx >= 0) {
          rangeAnchorIndexRef.current = anchorIdx;
        }
        const start = Math.min(anchorIdx, index);
        const end = Math.max(anchorIdx, index);
        // Replace selection with this range only (same as item slides / file lists), not union with prior picks.
        const newSet = new Set<string>();
        for (let i = start; i <= end; i++) {
          if (listToUse[i]) {
            newSet.add(listToUse[i].id);
          }
        }
        setSelectedMediaIds(newSet);
        setSelectedMedia(mediaItem);
        if (!mediaMultiSelectMode) {
          setPreviewMedia(mediaItem);
        }
        if (newSet.size > 1) {
          setMediaMultiSelectMode(true);
        }
        setLastSelectedIndex(index);
        return;
      }

      if (isCtrlOrCmd) {
        applyToggle(mediaItem, index, mediaMultiSelectMode);
        return;
      }
      if (mediaMultiSelectMode) {
        e.preventDefault();
        applyToggle(mediaItem, index, true);
        return;
      }
      setMediaMultiSelectMode(false);
      setSelectedMediaIds(new Set([mediaItem.id]));
      setSelectedMedia(mediaItem);
      setPreviewMedia(mediaItem);
      rangeAnchorIndexRef.current = index;
      setLastSelectedIndex(index);
    },
    [
      mediaList,
      filteredList,
      selectedMedia,
      selectedMediaIds,
      lastSelectedIndex,
      enableRangeSelection,
      mediaMultiSelectMode,
    ],
  );

  const clearSelection = useCallback(() => {
    setSelectedMedia(emptyMedia);
    setSelectedMediaIds(new Set());
    setPreviewMedia(null);
    setLastSelectedIndex(-1);
    setMediaMultiSelectMode(false);
    rangeAnchorIndexRef.current = -1;
    skipNextMediaClickRef.current = false;
  }, []);

  const reconcileSelectionWithMediaList = useCallback(
    (stillPresentList: MediaType[]) => {
      const validIds = new Set(stillPresentList.map((m) => m.id));
      const hadRemovedSelected = [...selectedMediaIds].some(
        (id) => !validIds.has(id),
      );
      if (!hadRemovedSelected) return;

      const prunedIds = new Set(
        [...selectedMediaIds].filter((id) => validIds.has(id)),
      );

      if (prunedIds.size === 0) {
        setMediaMultiSelectMode(false);
        setSelectedMedia(emptyMedia);
        setSelectedMediaIds(new Set());
        setPreviewMedia(null);
        setLastSelectedIndex(-1);
        rangeAnchorIndexRef.current = -1;
        skipNextMediaClickRef.current = false;
        return;
      }

      if (prunedIds.size < 2) {
        setMediaMultiSelectMode(false);
      } else {
        setMediaMultiSelectMode(true);
      }

      const primaryId =
        selectedMedia.id && prunedIds.has(selectedMedia.id)
          ? selectedMedia.id
          : [...prunedIds][0];

      const primaryItem = stillPresentList.find((m) => m.id === primaryId);
      if (!primaryItem) {
        clearSelection();
        return;
      }

      setSelectedMediaIds(prunedIds);
      setSelectedMedia(primaryItem);
      setPreviewMedia(primaryItem);
      const listForRangeIndex = filteredList || mediaList;
      const nextAnchorIdx = listForRangeIndex.findIndex(
        (m) => m.id === primaryId,
      );
      setLastSelectedIndex(nextAnchorIdx);
      rangeAnchorIndexRef.current = nextAnchorIdx;
    },
    [
      selectedMediaIds,
      selectedMedia.id,
      clearSelection,
      filteredList,
      mediaList,
    ],
  );

  return {
    selectedMedia,
    selectedMediaIds,
    previewMedia,
    lastSelectedIndex,
    mediaMultiSelectMode,
    setSelectedMedia,
    setSelectedMediaIds,
    setPreviewMedia,
    setLastSelectedIndex,
    handleMediaClick,
    enterMediaMultiSelectMode,
    clearSelection,
    reconcileSelectionWithMediaList,
  };
};
