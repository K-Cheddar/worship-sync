import { ControllerInfoContext } from "../../context/controllerInfo";
import { loadSong } from "../../utils/songPersistence";
import Button from "../../components/Button/Button";
import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector, useDispatch } from "../../hooks";
import { setIsLyricsEditorOpen } from "../../store/itemSlice";
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
    (state: RootState) => state.undoable?.present?.item?.isLyricsEditorOpen ?? false,
  );
  const type = useSelector(
    (state: RootState) => state.undoable?.present?.item?.type,
  );
  const dispatch = useDispatch();
  const [panelReady, setPanelReady] = useState(false);
  const { db } = useContext(ControllerInfoContext) || {};
  const [libraryLoad, setLibraryLoad] = useState<{
    songId: string; db: PouchDB.Database | undefined; song?: DBItem; error?: string;
  } | null>(null);

  const isLibraryEditor = Boolean(song);
  const editorIsOpen = isLibraryEditor ? Boolean(isOpen) : controllerIsEditMode;

  const v2SongId = song?.docType === "song-v2-root" ? song._id : undefined;
  useEffect(() => {
    if (!editorIsOpen || !v2SongId) {
      setLibraryLoad(null);
      return;
    }
    let cancelled = false;
    setLibraryLoad(null);
    const hydrate = async () => {
      try {
        if (!db) throw new Error("The song library is not available. Close and try again.");
        const hydrated = await loadSong(db, v2SongId);
        if (!cancelled) setLibraryLoad({ songId: v2SongId, db, song: hydrated });
      } catch {
        if (!cancelled) setLibraryLoad({ songId: v2SongId, db, error: "Could not load this song. Close and try again." });
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [db, editorIsOpen, v2SongId]);

  useEffect(() => {
    if (isLibraryEditor) return;
    if (type !== "song") {
      dispatch(setIsLyricsEditorOpen(false));
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

  const exactLoad = libraryLoad?.songId === v2SongId && libraryLoad?.db === db ? libraryLoad : null;
  let panel;
  if (v2SongId && exactLoad?.error) {
    panel = (
      <div role="alert" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-homepage-canvas">
        <p>{exactLoad.error}</p>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  } else if (!panelReady || (v2SongId && !exactLoad?.song)) {
    panel = (
      <>
        <LyricsEditorLoadingSkeleton />
        {v2SongId ? <Button className="absolute right-2 top-2 z-40" onClick={onClose}>Close</Button> : null}
      </>
    );
  } else {
    panel = (
      <LyricsEditorPanel
        key={song?._id ?? "controller"}
        song={v2SongId ? exactLoad?.song : song}
        onClose={onClose}
        onSaveLyrics={onSaveLyrics}
      />
    );
  }

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
