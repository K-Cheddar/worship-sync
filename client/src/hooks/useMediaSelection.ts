import { useState, useCallback } from "react";
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
  setSelectedMediaIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setPreviewMedia: (media: MediaType | null) => void;
  setLastSelectedIndex: (index: number) => void;
  handleMediaClick: (
    e: React.MouseEvent,
    mediaItem: MediaType,
    index: number
  ) => void;
  clearSelection: () => void;
}

export const useMediaSelection = ({
  mediaList,
  filteredList,
  enableRangeSelection = true,
}: UseMediaSelectionOptions): UseMediaSelectionReturn => {
  const [selectedMedia, setSelectedMedia] = useState<MediaType>(emptyMedia);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [previewMedia, setPreviewMedia] = useState<MediaType | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);

  const handleMediaClick = useCallback(
    (
      e: React.MouseEvent,
      mediaItem: MediaType,
      index: number
    ) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const listToUse = filteredList || mediaList;

      if (isCtrlOrCmd) {
        // Toggle selection with Ctrl/Cmd
        setSelectedMediaIds((prev) => {
          const newSet = new Set(prev);
          if (newSet.has(mediaItem.id)) {
            newSet.delete(mediaItem.id);
            if (newSet.size === 0) {
              setSelectedMedia(emptyMedia);
              setPreviewMedia(null);
            } else if (selectedMedia.id === mediaItem.id) {
              // If we're deselecting the currently selected media, select the first remaining
              const firstId = Array.from(newSet)[0];
              const firstItem = mediaList.find((item) => item.id === firstId);
              if (firstItem) {
                setSelectedMedia(firstItem);
                setPreviewMedia(firstItem);
              }
            }
          } else {
            newSet.add(mediaItem.id);
            setSelectedMedia(mediaItem);
            setPreviewMedia(mediaItem);
          }
          return newSet;
        });
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
    ]
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
