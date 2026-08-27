import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import Drawer from "../Drawer";
import Button from "../Button/Button";
import SongArrangementSectionsPanel from "./SongArrangementSectionsPanel";
import { DBItem, SongAudio } from "../../types";
import SongAudioPlayer from "../SongAudioPlayer/SongAudioPlayer";
import SongLinkPreview from "../SongLinkPreview/SongLinkPreview";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  deleteSongAudioWithRetry,
  getSongAudioUrl,
  uploadSongAudio,
} from "../../api/auth";
import { useDispatch } from "../../hooks";
import { upsertItemInAllDocs } from "../../store/allDocsSlice";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { broadcastItemUpdate } from "../../store/store";
import { deleteSongAudioBeforeClearingMetadata } from "../../utils/persistSongAudioAttachment";
import {
  ItemDetailsEditorFields,
  type ItemDetailsSavePayload,
} from "../ItemDetailsModal/ItemDetailsModal";

type PersistSongPatch = ItemDetailsSavePayload & {
  songAudioPatch?: SongAudio | null;
};

type ViewSongSectionsDrawerProps = {
  song: DBItem | null;
  isOpen: boolean;
  searchHighlight?: string;
  /** Opens the shared details sheet directly in edit mode for controller entry points. */
  initialMode?: "view" | "edit";
  /** Override persistence when the caller owns the active editor state. */
  onSave?: (payload: ItemDetailsSavePayload) => void | Promise<void>;
  onUploadSongAudio?: (file: File) => Promise<void>;
  onGetSongAudioUrl?: (disposition: "inline" | "attachment") => Promise<string>;
  onRemoveSongAudio?: () => Promise<void>;
  onClose: () => void;
};

const ViewSongSectionsDrawer = ({
  song,
  isOpen,
  searchHighlight,
  initialMode = "view",
  onSave,
  onUploadSongAudio: onUploadSongAudioOverride,
  onGetSongAudioUrl: onGetSongAudioUrlOverride,
  onRemoveSongAudio: onRemoveSongAudioOverride,
  onClose,
}: ViewSongSectionsDrawerProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) || {};
  const { churchId, access } = useContext(GlobalInfoContext) || {};
  const [arrangementIndex, setArrangementIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const previousSongIdRef = useRef<string | null>(null);
  const canEdit = Boolean(db && (access === "full" || access === "music"));

  useEffect(() => {
    if (!song) {
      previousSongIdRef.current = null;
      return;
    }
    const def = Math.min(
      Math.max(song.selectedArrangement ?? 0, 0),
      Math.max(0, (song.arrangements?.length ?? 1) - 1),
    );
    if (previousSongIdRef.current !== song._id) {
      previousSongIdRef.current = song._id;
      setArrangementIndex(def);
    }
  }, [song]);

  useEffect(() => {
    setIsEditing(isOpen && initialMode === "edit");
  }, [initialMode, isOpen, song?._id]);

  const persistSongPatch = useCallback(
    async (patch: PersistSongPatch) => {
      if (!db || !song) {
        throw new Error("The song library is not available. Try again.");
      }

      const existing = (await db.get(song._id)) as DBItem;
      const next: DBItem = { ...existing, name: patch.name };

      if (patch.songMetadataPatch !== undefined) {
        if (patch.songMetadataPatch === null) {
          delete next.songMetadata;
        } else {
          next.songMetadata = patch.songMetadataPatch;
        }
      }
      if (patch.songLinksPatch !== undefined) {
        next.songLinks = patch.songLinksPatch;
      }
      if (patch.songAudioPatch !== undefined) {
        if (patch.songAudioPatch === null) {
          delete next.songAudio;
        } else {
          next.songAudio = patch.songAudioPatch;
        }
      }

      const audited = applyPouchAudit(existing, next, { isNew: false });
      const result = await db.put(audited);
      const saved = { ...audited, _rev: result.rev };
      dispatch(upsertItemInAllDocs(saved));
      dispatch(
        upsertItemInAllItemsList({
          _id: saved._id,
          name: saved.name,
          type: saved.type,
          listId: saved._id,
          background:
            typeof saved.background === "string" ? saved.background : "",
        }),
      );
      broadcastItemUpdate(saved);
    },
    [db, dispatch, song],
  );

  const resolveSongAudioUrl = useCallback(
    async (disposition: "inline" | "attachment") => {
      if (!churchId || !song?.songAudio) {
        throw new Error("Sign in to listen to this MP3.");
      }
      const result = await getSongAudioUrl({
        churchId,
        songId: song._id,
        audio: song.songAudio,
        disposition,
      });
      return result.url;
    },
    [churchId, song],
  );

  const attachSongAudio = useCallback(
    async (file: File) => {
      if (!churchId || !song) {
        throw new Error("Sign in to attach an MP3.");
      }
      const previousAudio = song.songAudio;
      const audio = await uploadSongAudio({
        churchId,
        songId: song._id,
        file,
        previousAudio,
      });
      try {
        await persistSongPatch({
          name: song.name,
          songAudioPatch: audio,
        });
      } catch (error) {
        // Replacement uploads reuse the current final key. Keep that object if
        // metadata persistence fails so the existing document stays playable.
        if (!previousAudio || previousAudio.key !== audio.key) {
          try {
            await deleteSongAudioWithRetry({
              churchId,
              songId: song._id,
              audio,
            });
          } catch (cleanupError) {
            console.error("Error cleaning unpersisted song audio:", cleanupError);
          }
        }
        throw error;
      }

      if (previousAudio && previousAudio.key !== audio.key) {
        try {
          await deleteSongAudioWithRetry({
            churchId,
            songId: song._id,
            audio: previousAudio,
          });
        } catch (error) {
          console.error("Error cleaning replaced song audio:", error);
        }
      }
    },
    [churchId, persistSongPatch, song],
  );

  const removeSongAudio = useCallback(async () => {
    if (!churchId || !song?.songAudio) return;
    const audio = song.songAudio;
    await deleteSongAudioBeforeClearingMetadata({
      deleteAudio: () =>
        deleteSongAudioWithRetry({
          churchId,
          songId: song._id,
          audio,
        }),
      clearMetadata: () =>
        persistSongPatch({
          name: song.name,
          songAudioPatch: null,
        }),
    });
  }, [churchId, persistSongPatch, song]);

  if (!song) {
    return null;
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Song details — ${song.name}`}
      size="lg"
      position="right"
      contentClassName="flex min-h-0 flex-col"
      contentPadding="p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {canEdit && !isEditing ? (
          <div className="flex shrink-0 justify-end">
            <Button
              type="button"
              variant="secondary"
              svg={Pencil}
              onClick={() => setIsEditing(true)}
            >
              Edit details
            </Button>
          </div>
        ) : null}

        {isEditing ? (
          <section className="shrink-0 rounded-md border border-gray-700 bg-gray-900/60 p-3">
            <ItemDetailsEditorFields
              isOpen={isEditing}
              onClose={() => setIsEditing(false)}
              itemType="song"
              itemName={song.name}
              songMetadata={song.songMetadata}
              songLinks={song.songLinks}
              songAudio={song.songAudio}
              onUploadSongAudio={onUploadSongAudioOverride ?? attachSongAudio}
              onGetSongAudioUrl={onGetSongAudioUrlOverride ?? resolveSongAudioUrl}
              onRemoveSongAudio={onRemoveSongAudioOverride ?? removeSongAudio}
              onSave={onSave ?? persistSongPatch}
            />
          </section>
        ) : (
          <section className="shrink-0 space-y-3" aria-label="Song resources">
            {song.songMetadata ? (
              <dl className="grid gap-x-4 gap-y-1 rounded-md border border-gray-700 bg-gray-900/60 p-3 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-gray-400">Artist</dt>
                <dd className="min-w-0 truncate text-gray-100">
                  {song.songMetadata.artistName || "Not specified"}
                </dd>
                {song.songMetadata.albumName ? (
                  <>
                    <dt className="text-gray-400">Album</dt>
                    <dd className="min-w-0 truncate text-gray-100">
                      {song.songMetadata.albumName}
                    </dd>
                  </>
                ) : null}
                {song.songMetadata.key ? (
                  <>
                    <dt className="text-gray-400">Key</dt>
                    <dd className="min-w-0 truncate text-gray-100">
                      {song.songMetadata.key}
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : null}

            {song.songAudio ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-white">
                  Reference MP3
                </h3>
                <SongAudioPlayer
                  audio={song.songAudio}
                  onGetUrl={resolveSongAudioUrl}
                />
              </div>
            ) : null}

            {song.songLinks?.length ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-white">Links</h3>
                <ul className="space-y-2">
                  {song.songLinks.map((link) => (
                    <li key={link.id}>
                      <SongLinkPreview link={link} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        <h3 className="shrink-0 text-sm font-semibold text-white">
          Lyrics and arrangements
        </h3>
        <SongArrangementSectionsPanel
          song={song}
          mode="view"
          arrangementIndex={arrangementIndex}
          onArrangementIndexChange={setArrangementIndex}
          searchHighlight={searchHighlight}
          arrangementSelectId="library-view-song-arrangement"
        />
        <div className="flex shrink-0 justify-end border-t border-gray-700 pt-4">
          <Button variant="secondary" onClick={onClose} svg={X}>
            Close
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default ViewSongSectionsDrawer;
