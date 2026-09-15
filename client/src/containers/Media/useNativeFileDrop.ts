import { useCallback, useEffect, useState } from "react";

const hasNativeFiles = (event: DragEvent) =>
  Boolean(event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes("Files"));

type NativeFileDropOptions = {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
};

export const useNativeFileDrop = ({
  disabled = false,
  onFiles,
}: NativeFileDropOptions) => {
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const resetDragState = useCallback(() => {
    setIsFileDragOver(false);
  }, []);

  useEffect(() => {
    if (disabled) resetDragState();
  }, [disabled, resetDragState]);

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !hasNativeFiles(event.nativeEvent)) return;
      event.preventDefault();
      setIsFileDragOver(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !hasNativeFiles(event.nativeEvent)) return;
      event.preventDefault();
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !hasNativeFiles(event.nativeEvent)) return;
      event.preventDefault();
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      resetDragState();
    },
    [disabled, resetDragState],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !hasNativeFiles(event.nativeEvent)) return;
      event.preventDefault();
      resetDragState();
      onFiles(Array.from(event.dataTransfer.files));
    },
    [disabled, onFiles, resetDragState],
  );

  return {
    isFileDragOver,
    fileDropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
};
