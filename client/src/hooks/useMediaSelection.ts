import { useState, useCallback, useEffect } from "react";
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
  clearSelection: () => void;
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

  const handleMediaClick = useCallback(
    (e: React.MouseEvent, mediaItem: MediaType, index: number) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const listToUse = filteredList || mediaList;

      if (isCtrlOrCmd) {
        // Toggle selection with Ctrl/Cmd — compute next ids, then update related state from the handler (not inside setState updaters).
        const newSet = new Set(selectedMediaIds);
        if (newSet.has(mediaItem.id)) {
          newSet.delete(mediaItem.id);
          setSelectedMediaIds(newSet);
          if (newSet.size === 0) {
            setSelectedMedia(emptyMedia);
            setPreviewMedia(null);
          } else if (selectedMedia.id === mediaItem.id) {
            const firstId = Array.from(newSet)[0];
            const firstItem = mediaList.find((item) => item.id === firstId);
            if (firstItem) {
              setSelectedMedia(firstItem);
              setPreviewMedia(firstItem);
            }
          }
        } else {
          newSet.add(mediaItem.id);
          setSelectedMediaIds(newSet);
          setSelectedMedia(mediaItem);
          setPreviewMedia(mediaItem);
        }
        setLastSelectedIndex(index);
      } else if (isShift && enableRangeSelection && lastSelectedIndex >= 0) {
        // Range selection with Shift
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        const newSet = new Set(selectedMediaIds);
        for (let i = start; i <= end; i++) {
          if (listToUse[i]) {
            newSet.add(listToUse[i].id);
          }
        }
        setSelectedMediaIds(newSet);
        setSelectedMedia(mediaItem);
        setPreviewMedia(mediaItem);
        setLastSelectedIndex(index);
      } else {
        // Single selection
        setSelectedMediaIds(new Set([mediaItem.id]));
        setSelectedMedia(mediaItem);
        setPreviewMedia(mediaItem);
        setLastSelectedIndex(index);
      }
    },
    [
      mediaList,
      filteredList,
      selectedMedia,
      selectedMediaIds,
      lastSelectedIndex,
      enableRangeSelection,
    ],
  );

  const clearSelection = useCallback(() => {
    setSelectedMedia(emptyMedia);
    setSelectedMediaIds(new Set());
    setPreviewMedia(null);
    setLastSelectedIndex(-1);
  }, []);

  return {
    selectedMedia,
    selectedMediaIds,
    previewMedia,
    lastSelectedIndex,
    setSelectedMedia,
    setSelectedMediaIds,
    setPreviewMedia,
    setLastSelectedIndex,
    handleMediaClick,
    clearSelection,
  };
};
