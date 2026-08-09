import { useEffect, useState } from "react";
import Modal from "../Modal/Modal";
import Input from "../Input/Input";
import Button from "../Button/Button";
import type { ItemType, SongAudio, SongLink, SongMetadata } from "../../types";
import { createManualSongMetadata } from "../../utils/lrclib";
import SongAudioAttachment from "./SongAudioAttachment";

const EMPTY_SONG_LINKS: SongLink[] = [];

export type ItemDetailsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  itemType: ItemType;
  itemName: string;
  songMetadata: SongMetadata | undefined;
  songLinks?: SongLink[];
  songAudio?: SongAudio;
  onUploadSongAudio?: (file: File) => Promise<void>;
  onGetSongAudioUrl?: (disposition: "inline" | "attachment") => Promise<string>;
  onRemoveSongAudio?: () => Promise<void>;
  /** Omit when only the visible name changes. `null` clears stored metadata (songs only). */
  onSave: (payload: ItemDetailsSavePayload) => void | Promise<void>;
};

export type ItemDetailsSavePayload = {
  name: string;
  songMetadataPatch?: SongMetadata | null;
  songLinksPatch?: SongLink[];
};

type ItemDetailsEditorFieldsProps = Omit<ItemDetailsModalProps, "isOpen"> & {
  isOpen: boolean;
};

function modalTitle(type: ItemType): string {
  switch (type) {
    case "song":
      return "Song details";
    case "bible":
      return "Bible item details";
    case "timer":
      return "Timer details";
    case "free":
      return "Free form details";
    case "image":
      return "Image item details";
    default:
      return "Item details";
  }
}

export function ItemDetailsModal({
  isOpen,
  onClose,
  itemType,
  itemName,
  songMetadata,
  songLinks,
  songAudio,
  onUploadSongAudio,
  onGetSongAudioUrl,
  onRemoveSongAudio,
  onSave,
}: ItemDetailsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle(itemType)}
      size="md"
      zIndexLevel={2}
    >
      <ItemDetailsEditorFields
        isOpen={isOpen}
        onClose={onClose}
        itemType={itemType}
        itemName={itemName}
        songMetadata={songMetadata}
        songLinks={songLinks}
        songAudio={songAudio}
        onUploadSongAudio={onUploadSongAudio}
        onGetSongAudioUrl={onGetSongAudioUrl}
        onRemoveSongAudio={onRemoveSongAudio}
        onSave={onSave}
      />
    </Modal>
  );
}

export function ItemDetailsEditorFields({
  isOpen,
  onClose,
  itemType,
  itemName,
  songMetadata,
  songLinks = EMPTY_SONG_LINKS,
  songAudio,
  onUploadSongAudio,
  onGetSongAudioUrl,
  onRemoveSongAudio,
  onSave,
}: ItemDetailsEditorFieldsProps) {
  const [localName, setLocalName] = useState(itemName);
  const [artistName, setArtistName] = useState("");
  const [albumName, setAlbumName] = useState("");
  const [localSongLinks, setLocalSongLinks] = useState<SongLink[]>(songLinks);
  const [linkError, setLinkError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isSong = itemType === "song";

  useEffect(() => {
    if (!isOpen) return;
    setLocalName(itemName);
    setArtistName(songMetadata?.artistName ?? "");
    setAlbumName(songMetadata?.albumName ?? "");
    setLocalSongLinks(songLinks);
    setLinkError("");
    setSaveError("");
  }, [isOpen, itemName, songLinks, songMetadata]);

  const updateSongLink = (id: string, patch: Partial<SongLink>) => {
    setLocalSongLinks((links) =>
      links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    );
  };

  const addSongLink = () => {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `song-link-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLocalSongLinks((links) => [...links, { id, label: "", url: "" }]);
  };

  const validateSongLinks = (): SongLink[] | null => {
    const links = localSongLinks
      .map((link) => ({
        ...link,
        label: link.label.trim(),
        url: link.url.trim(),
      }))
      .filter((link) => link.label || link.url);

    const invalidLink = links.find((link) => {
      if (!link.label || !link.url) return true;
      try {
        const url = new URL(link.url);
        return url.protocol !== "https:" && url.protocol !== "http:";
      } catch {
        return true;
      }
    });
    if (invalidLink) {
      setLinkError("Each link needs a label and a valid http(s) address.");
      return null;
    }
    return links;
  };

  const saveAndClose = async (payload: ItemDetailsSavePayload) => {
    setSaveError("");
    setIsSaving(true);
    try {
      await onSave(payload);
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "Could not save these details. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const nextName = localName.trim();
    if (!nextName) {
      return;
    }

    if (!isSong) {
      await saveAndClose({ name: nextName });
      return;
    }

    const trimmedArtist = artistName.trim();
    const trimmedAlbum = albumName.trim();
    const hasArtistOrAlbum = Boolean(trimmedArtist || trimmedAlbum);
    const nextSongLinks = validateSongLinks();
    if (!nextSongLinks) return;

    if (!songMetadata) {
      await saveAndClose({
        name: nextName,
        ...(hasArtistOrAlbum
          ? {
            songMetadataPatch: createManualSongMetadata({
              trackName: nextName,
              artistName: trimmedArtist,
              albumName: trimmedAlbum || undefined,
            }),
          }
          : {}),
        songLinksPatch: nextSongLinks,
      });
      return;
    }

    if (songMetadata.source === "manual" && !hasArtistOrAlbum) {
      await saveAndClose({
        name: nextName,
        songMetadataPatch: null,
        songLinksPatch: nextSongLinks,
      });
      return;
    }

    await saveAndClose({
      name: nextName,
      songMetadataPatch: {
        ...songMetadata,
        trackName: nextName,
        artistName: trimmedArtist,
        albumName: trimmedAlbum || undefined,
      },
      songLinksPatch: nextSongLinks,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        label={isSong ? "Song name" : "Item name"}
        value={localName}
        onChange={(v) => setLocalName(v as string)}
        data-ignore-undo="true"
      />
      {isSong && (
        <>
          <Input
            label="Artist"
            value={artistName}
            onChange={(v) => setArtistName(v as string)}
            data-ignore-undo="true"
          />
          <Input
            label="Album"
            value={albumName}
            onChange={(v) => setAlbumName(v as string)}
            data-ignore-undo="true"
          />
          <section className="border-t border-gray-700 pt-3" aria-label="Song links">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">Links</p>
                <p className="text-xs text-gray-400">Charts, tutorials, or other references.</p>
              </div>
              <Button variant="tertiary" className="text-sm" onClick={addSongLink}>
                Add link
              </Button>
            </div>
            {localSongLinks.map((link) => (
              <div key={link.id} className="mt-2 rounded bg-gray-800 p-2">
                <Input
                  label="Link label"
                  value={link.label}
                  onChange={(value) => updateSongLink(link.id, { label: String(value) })}
                />
                <Input
                  label="Link address"
                  type="url"
                  value={link.url}
                  onChange={(value) => updateSongLink(link.id, { url: String(value) })}
                />
                <Button
                  variant="textLink"
                  className="mt-1 text-sm text-red-300"
                  onClick={() =>
                    setLocalSongLinks((links) => links.filter((entry) => entry.id !== link.id))
                  }
                >
                  Remove link
                </Button>
              </div>
            ))}
            {linkError ? <p className="mt-2 text-sm text-red-400" role="alert">{linkError}</p> : null}
          </section>
          {onUploadSongAudio && onGetSongAudioUrl && onRemoveSongAudio ? (
            <SongAudioAttachment
              audio={songAudio}
              disabled={false}
              onUpload={onUploadSongAudio}
              onGetUrl={onGetSongAudioUrl}
              onRemove={onRemoveSongAudio}
            />
          ) : null}
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="tertiary" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          variant="cta"
          onClick={() => void handleSave()}
          disabled={!localName.trim() || isSaving}
          isLoading={isSaving}
        >
          Save
        </Button>
      </div>
      {saveError ? (
        <p className="text-sm text-red-400" role="alert">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
