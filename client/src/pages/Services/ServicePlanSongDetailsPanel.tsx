import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Music, Pencil } from "lucide-react";
import { Button } from "../../components/Button";
import Icon from "../../components/Icon/Icon";
import SongArrangementSectionsPanel from "../../components/SongSections/SongArrangementSectionsPanel";
import LyricsEditor from "../../containers/ItemEditor/LyricsEditor";
import SongLinkPreview from "../../components/SongLinkPreview/SongLinkPreview";
import SongAudioPlayer from "../../components/SongAudioPlayer/SongAudioPlayer";
import { ItemDetailsEditorFields, type ItemDetailsSavePayload } from "../../components/ItemDetailsModal/ItemDetailsModal";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { deleteSongAudioWithRetry, getSongAudioUrl, uploadSongAudio } from "../../api/auth";
import { useDispatch } from "../../hooks";
import { applyItemDocumentChange } from "../../store/allDocsSlice";
import { broadcastItemUpdate } from "../../store/store";
import { deleteSongAudioBeforeClearingMetadata } from "../../utils/persistSongAudioAttachment";
import { loadSong, saveSong, songToLibraryProjection } from "../../utils/songPersistence";
import type { Arrangment, DBItem, SongAudio, SongMetadata } from "../../types";

type ServicePlanSongDetailsPanelProps = {
  song: DBItem;
  canEdit?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
};

const ServicePlanSongDetailsPanel = ({ song, canEdit = false, onEditingChange }: ServicePlanSongDetailsPanelProps) => {
  const { db } = useContext(ControllerInfoContext) || {};
  const { churchId } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const persistenceScopeRef = useRef({ db, churchId });
  persistenceScopeRef.current = { db, churchId };
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [arrangementIndex, setArrangementIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);

  const setEditing = (next: boolean) => {
    setIsEditing(next);
    onEditingChange?.(next);
  };

  const persistSongPatch = useCallback(async (patch: Omit<ItemDetailsSavePayload, "name"> & { name?: string; songAudioPatch?: SongAudio | null }, baselineSong?: DBItem) => {
    if (!db) throw new Error("The song library is not available. Try again.");
    const existing = baselineSong ?? await loadSong(db, song._id);
    const next: DBItem = { ...existing, name: patch.name ?? existing.name };
    if (patch.songMetadataPatch !== undefined) {
      if (patch.songMetadataPatch === null) next.songMetadata = undefined;
      else next.songMetadata = patch.songMetadataPatch;
    }
    if (patch.songLinksPatch !== undefined) next.songLinks = patch.songLinksPatch;
    if (patch.songAudioPatch !== undefined) {
      if (patch.songAudioPatch === null) next.songAudio = undefined;
      else next.songAudio = patch.songAudioPatch;
    }
    const saved = await saveSong(db, next, existing);
    if (!mountedRef.current || persistenceScopeRef.current.db !== db ||
      persistenceScopeRef.current.churchId !== churchId) return;
    dispatch(applyItemDocumentChange({ id: saved._id, doc: songToLibraryProjection(saved) }));
    broadcastItemUpdate(saved);
  }, [db, dispatch, song._id, churchId]);

  const uploadSongAudioForEdit = useCallback(async (file: File) => {
    if (!churchId || !db) throw new Error("Sign in to attach an MP3.");
    const loadedSong = await loadSong(db, song._id);
    const baselineSong = loadedSong.docType === "song-v2-root" ? loadedSong : undefined;
    const previousAudio = baselineSong?.songAudio ?? song.songAudio;
    const audio = await uploadSongAudio({ churchId, songId: song._id, file, previousAudio });
    try {
      await persistSongPatch({ songAudioPatch: audio }, baselineSong);
    } catch (error) {
      if (!previousAudio || previousAudio.key !== audio.key) {
        try { await deleteSongAudioWithRetry({ churchId, songId: song._id, audio }); }
        catch (cleanupError) { console.error("Error cleaning unpersisted song audio:", cleanupError); }
      }
      throw error;
    }
    if (previousAudio && previousAudio.key !== audio.key) {
      try { await deleteSongAudioWithRetry({ churchId, songId: song._id, audio: previousAudio }); }
      catch (error) { console.error("Error cleaning replaced song audio:", error); }
    }
  }, [churchId, db, persistSongPatch, song]);

  const getSongAudioUrlForEdit = useCallback(async (disposition: "inline" | "attachment") => {
    if (!churchId || !song.songAudio) throw new Error("Sign in to listen to this MP3.");
    const result = await getSongAudioUrl({ churchId, songId: song._id, audio: song.songAudio, disposition });
    return result.url;
  }, [churchId, song]);

  const removeSongAudioForEdit = useCallback(async () => {
    if (!churchId || !db || !song.songAudio) return;
    const baselineSong = await loadSong(db, song._id);
    const audio = baselineSong.docType === "song-v2-root"
      ? baselineSong.songAudio ?? song.songAudio
      : song.songAudio;
    if (baselineSong.docType === "song-v2-root") {
      await persistSongPatch({ songAudioPatch: null }, baselineSong);
      try {
        await deleteSongAudioWithRetry({ churchId, songId: song._id, audio });
      } catch (error) {
        console.error("Error cleaning removed song audio:", error);
      }
      return;
    }
    await deleteSongAudioBeforeClearingMetadata({
      deleteAudio: () => deleteSongAudioWithRetry({ churchId, songId: song._id, audio }),
      clearMetadata: () => persistSongPatch({ songAudioPatch: null }),
    });
  }, [churchId, db, persistSongPatch, song]);

  const handleSave = async (payload: ItemDetailsSavePayload) => {
    await persistSongPatch(payload);
  };

  const saveLyrics = useCallback(async ({
    baselineSong,
    arrangements,
    selectedArrangement,
    songMetadata,
  }: {
    baselineSong: DBItem;
    arrangements: Arrangment[];
    selectedArrangement: number;
    songMetadata?: SongMetadata;
  }) => {
    if (!db) throw new Error("The song library is not available. Try again.");
    const latestSong = await loadSong(db, baselineSong._id);
    // Keep the v2 baseline from when editing began so the writer can detect
    // conflicts at the arrangement/slide level. Legacy songs need the newest
    // root revision for Pouch while retaining the user's draft content.
    const saveBaseline = latestSong.docType === "song-v2-root"
      ? baselineSong
      : latestSong;
    const next: DBItem = {
      ...(latestSong.docType === "song-v2-root" ? baselineSong : latestSong),
      arrangements,
      selectedArrangement,
    };
    if (songMetadata === undefined) next.songMetadata = undefined;
    else next.songMetadata = songMetadata;
    const saved = await saveSong(db, next, saveBaseline);
    if (!mountedRef.current || persistenceScopeRef.current.db !== db ||
      persistenceScopeRef.current.churchId !== churchId) return;
    dispatch(applyItemDocumentChange({ id: saved._id, doc: songToLibraryProjection(saved) }));
    broadcastItemUpdate(saved);
  }, [db, dispatch, churchId]);

  return (
    <div className="space-y-4" aria-label={`Song details for ${song.name}`}>
      <div className="flex items-center gap-2">
        <Icon svg={Music} size="sm" className="text-cyan-300" />
        <h3 className="text-base font-semibold text-gray-100">{song.name}</h3>
      </div>
      {canEdit && !isEditing ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" svg={Pencil} onClick={() => setIsEditingLyrics(true)}>Edit lyrics</Button>
          <Button type="button" variant="secondary" svg={Pencil} onClick={() => setEditing(true)}>Edit details</Button>
        </div>
      ) : null}
      {isEditing ? (
        <section className="rounded-md border border-gray-700 bg-gray-900/60 p-2">
          <ItemDetailsEditorFields
            isOpen
            onClose={() => setEditing(false)}
            itemType="song"
            itemName={song.name}
            songMetadata={song.songMetadata}
            songLinks={song.songLinks}
            songAudio={song.songAudio}
            onUploadSongAudio={uploadSongAudioForEdit}
            onGetSongAudioUrl={getSongAudioUrlForEdit}
            onRemoveSongAudio={removeSongAudioForEdit}
            onSave={handleSave}
            onSaveSuccess={() => setEditing(false)}
            className="gap-2"
          />
        </section>
      ) : null}
      {!isEditing && song.songMetadata ? (
        <dl className="grid gap-x-4 gap-y-1 rounded-md border border-gray-700 bg-gray-900/60 p-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-gray-400">Artist</dt><dd className="truncate text-gray-100">{song.songMetadata.artistName || "Not specified"}</dd>
          {song.songMetadata.albumName ? <><dt className="text-gray-400">Album</dt><dd className="truncate text-gray-100">{song.songMetadata.albumName}</dd></> : null}
          {song.songMetadata.key ? <><dt className="text-gray-400">Key</dt><dd className="text-gray-100">{song.songMetadata.key}</dd></> : null}
        </dl>
      ) : null}
      {!isEditing && song.songAudio ? <section><h3 className="mb-2 text-sm font-semibold text-white">Reference MP3</h3><SongAudioPlayer audio={song.songAudio} onGetUrl={getSongAudioUrlForEdit} /></section> : null}
      {!isEditing && song.songLinks?.length ? <section><h3 className="mb-2 text-sm font-semibold text-white">Links</h3><div className="space-y-2">{song.songLinks.map((link) => <SongLinkPreview key={link.id} link={link} />)}</div></section> : null}
      <section className={isEditing ? "hidden" : undefined}>
        <h3 className="mb-2 text-sm font-semibold text-white">Lyrics and arrangements</h3>
        <SongArrangementSectionsPanel song={song} mode="view" arrangementIndex={arrangementIndex} onArrangementIndexChange={setArrangementIndex} arrangementSelectId="service-plan-song-arrangement" />
      </section>
      <LyricsEditor
        song={song}
        isOpen={isEditingLyrics}
        onClose={() => setIsEditingLyrics(false)}
        onSaveLyrics={saveLyrics}
      />
    </div>
  );
};

export default ServicePlanSongDetailsPanel;
