import { useEffect, useState } from "react";
import { useSelector, useDispatch } from "../../hooks";
import { setIsEditMode } from "../../store/itemSlice";
import { RootState } from "../../store/store";
import LyricsEditorLoadingSkeleton from "./LyricsEditorLoadingSkeleton";
import LyricsEditorPanel from "./LyricsEditorPanel";

/**
 * Lyrics UI mounts only while edit mode is on so opening the editor does not run
 * heavy hooks (preview, import drawer, arrangement sync) while the panel is closed.
 * The full panel is deferred one macrotask so the UI can paint a loading state first
 * (same idea as import-section deferral in AddSongSectionsDrawer).
 */
const LyricsEditor = () => {
  const isEditMode = useSelector(
    (state: RootState) => state.undoable.present.item.isEditMode,
  );
  const type = useSelector(
    (state: RootState) => state.undoable.present.item.type,
  );
  const dispatch = useDispatch();
  const [panelReady, setPanelReady] = useState(false);

  useEffect(() => {
    if (type !== "song") {
      dispatch(setIsEditMode(false));
    }
  }, [type, dispatch]);

  useEffect(() => {
    if (!isEditMode) {
      setPanelReady(false);
      return;
    }
    const id = window.setTimeout(() => {
      setPanelReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [isEditMode]);

  if (!isEditMode) {
    return null;
  }

  if (!panelReady) {
    return <LyricsEditorLoadingSkeleton />;
  }

  return <LyricsEditorPanel />;
};

export default LyricsEditor;
