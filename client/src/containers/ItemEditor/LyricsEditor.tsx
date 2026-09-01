import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector, useDispatch } from "../../hooks";
import { setIsEditMode } from "../../store/itemSlice";
import { RootState } from "../../store/store";
import LyricsEditorLoadingSkeleton from "./LyricsEditorLoadingSkeleton";
import LyricsEditorPanel from "./LyricsEditorPanel";
import type { Arrangment, DBItem, SongMetadata } from "../../types";

type LyricsEditorProps = {
  /**
   * When provided, the editor works on a library song instead of the active
   * presentation item. This keeps library edits from changing what is live.
   */
  song?: DBItem | null;
  isOpen?: boolean;
  onClose?: () => void;
  onSaveLyrics?: (payload: {
    arrangements: Arrangment[];
    selectedArrangement: number;
    songMetadata?: SongMetadata;
  }) => Promise<void>;
};

/**
 * Lyrics UI mounts only while edit mode is on so opening the editor does not run
 * heavy hooks (preview, import drawer, arrangement sync) while the panel is closed.
 * The full panel is deferred one macrotask so the UI can paint a loading state first
 * (same idea as import-section deferral in AddSongSectionsDrawer).
 */
const LyricsEditor = ({ song = null, isOpen, onClose, onSaveLyrics }: LyricsEditorProps) => {
  const controllerIsEditMode = useSelector(
    (state: RootState) => state.undoable?.present?.item?.isEditMode ?? false,
  );
  const type = useSelector(
    (state: RootState) => state.undoable?.present?.item?.type,
  );
  const dispatch = useDispatch();
  const [panelReady, setPanelReady] = useState(false);

  const isLibraryEditor = Boolean(song);
  const editorIsOpen = isLibraryEditor ? Boolean(isOpen) : controllerIsEditMode;

  useEffect(() => {
    if (isLibraryEditor) return;
    if (type !== "song") {
      dispatch(setIsEditMode(false));
    }
  }, [type, dispatch, isLibraryEditor]);

  useEffect(() => {
    if (!editorIsOpen) {
      setPanelReady(false);
      return;
    }
    const id = window.setTimeout(() => {
      setPanelReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [editorIsOpen]);

  if (!editorIsOpen) {
    return null;
  }

  if (!panelReady) {
    return <LyricsEditorLoadingSkeleton />;
  }

  const panel = (
    <LyricsEditorPanel
      song={song}
      onClose={onClose}
      onSaveLyrics={onSaveLyrics}
    />
  );

  // Library entry points can live inside a sheet. Portal the editor so it
  // retains the controller's normal full-screen editing layout.
  if (isLibraryEditor && typeof document !== "undefined") {
    const editorContainer =
      document.getElementById("controller-main") ?? document.body;
    return createPortal(panel, editorContainer);
  }

  return panel;
};

export default LyricsEditor;
