import { useCallback, useContext, useState } from "react";
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
import { upsertItemInAllDocs } from "../../store/allDocsSlice";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { broadcastItemUpdate } from "../../store/store";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { deleteSongAudioBeforeClearingMetadata } from "../../utils/persistSongAudioAttachment";
import type { Arrangment, DBItem, SongAudio, SongMetadata } from "../../types";

type ServicePlanSongDetailsPanelProps = {
  song: DBItem;
  canEdit?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
};

const ServicePlanSongDetailsPanel = ({ song, canEdit = false, onEditingChange }: ServicePlanSongDetailsPanelProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) || {};
  const { churchId } = useContext(GlobalInfoContext) || {};
  const [arrangementIndex, setArrangementIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);

  const setEditing = (next: boolean) => {
    setIsEditing(next);
    onEditingChange?.(next);
  };

  const persistSongPatch = useCallback(async (patch: ItemDetailsSavePayload & { songAudioPatch?: SongAudio | null }) => {
    if (!db) throw new Error("The song library is not available. Try again.");
    const existing = (await db.get(song._id)) as DBItem;
    const next: DBItem = { ...existing, name: patch.name };
    if (patch.songMetadataPatch !== undefined) {
      if (patch.songMetadataPatch === null) delete next.songMetadata;
      else next.songMetadata = patch.songMetadataPatch;
    }
    if (patch.songLinksPatch !== undefined) next.songLinks = patch.songLinksPatch;
    if (patch.songAudioPatch !== undefined) {
      if (patch.songAudioPatch === null) delete next.songAudio;
      else next.songAudio = patch.songAudioPatch;
    }
    const audited = applyPouchAudit(existing, next, { isNew: false });
    const result = await db.put(audited);
    const saved = { ...audited, _rev: result.rev };
    dispatch(upsertItemInAllDocs(saved));
    dispatch(upsertItemInAllItemsList({
      _id: saved._id,
      name: saved.name,
      type: saved.type,
      listId: saved._id,
      background: typeof saved.background === "string" ? saved.background : "",
    }));
    broadcastItemUpdate(saved);
  }, [db, dispatch, song._id]);

  const uploadSongAudioForEdit = useCallback(async (file: File) => {
    if (!churchId) throw new Error("Sign in to attach an MP3.");
    const previousAudio = song.songAudio;
    const audio = await uploadSongAudio({ churchId, songId: song._id, file, previousAudio });
    try {
      await persistSongPatch({ name: song.name, songAudioPatch: audio });
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
  }, [churchId, persistSongPatch, song]);

  const getSongAudioUrlForEdit = useCallback(async (disposition: "inline" | "attachment") => {
    if (!churchId || !song.songAudio) throw new Error("Sign in to listen to this MP3.");
    const result = await getSongAudioUrl({ churchId, songId: song._id, audio: song.songAudio, disposition });
    return result.url;
  }, [churchId, song]);

  const removeSongAudioForEdit = useCallback(async () => {
    if (!churchId || !song.songAudio) return;
    const audio = song.songAudio;
    await deleteSongAudioBeforeClearingMetadata({
      deleteAudio: () => deleteSongAudioWithRetry({ churchId, songId: song._id, audio }),
      clearMetadata: () => persistSongPatch({ name: song.name, songAudioPatch: null }),
    });
  }, [churchId, persistSongPatch, song]);

  const handleSave = async (payload: ItemDetailsSavePayload) => {
    await persistSongPatch(payload);
    setEditing(false);
  };

  const saveLyrics = useCallback(async ({
    arrangements,
    selectedArrangement,
    songMetadata,
  }: {
    arrangements: Arrangment[];
    selectedArrangement: number;
    songMetadata?: SongMetadata;
  }) => {
    if (!db) throw new Error("The song library is not available. Try again.");
    const existing = (await db.get(song._id)) as DBItem;
    const next: DBItem = { ...existing, arrangements, selectedArrangement };
    if (songMetadata === undefined) delete next.songMetadata;
    else next.songMetadata = songMetadata;
    const audited = applyPouchAudit(existing, next, { isNew: false });
    const result = await db.put(audited);
    const saved = { ...audited, _rev: result.rev };
    dispatch(upsertItemInAllDocs(saved));
    dispatch(upsertItemInAllItemsList({
      _id: saved._id,
      name: saved.name,
      type: saved.type,
      listId: saved._id,
      background: typeof saved.background === "string" ? saved.background : "",
    }));
    broadcastItemUpdate(saved);
  }, [db, dispatch, song._id]);

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
