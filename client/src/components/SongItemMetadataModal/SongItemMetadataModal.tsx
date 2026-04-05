import { useEffect, useState } from "react";
import Modal from "../Modal/Modal";
import Input from "../Input/Input";
import Button from "../Button/Button";
import type { SongMetadata } from "../../types";
import { createManualSongMetadata } from "../../utils/lrclib";

type SongItemMetadataModalProps = {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  songMetadata: SongMetadata | undefined;
  /** Omit when only the visible name changes. `null` clears stored metadata. */
  onSave: (payload: {
    name: string;
    songMetadataPatch?: SongMetadata | null;
  }) => void;
};

export const SongItemMetadataModal = ({
  isOpen,
  onClose,
  itemName,
  songMetadata,
  onSave,
}: SongItemMetadataModalProps) => {
  const [localName, setLocalName] = useState(itemName);
  const [artistName, setArtistName] = useState("");
  const [albumName, setAlbumName] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setLocalName(itemName);
    setArtistName(songMetadata?.artistName ?? "");
    setAlbumName(songMetadata?.albumName ?? "");
  }, [isOpen, itemName, songMetadata]);

  const handleSave = () => {
    const nextName = localName.trim();
    if (!nextName) {
      return;
    }

    const trimmedArtist = artistName.trim();
    const trimmedAlbum = albumName.trim();
    const hasArtistOrAlbum = Boolean(trimmedArtist || trimmedAlbum);

    if (!songMetadata) {
      onSave({
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
      });
      onClose();
      return;
    }

    if (songMetadata.source === "manual" && !hasArtistOrAlbum) {
      onSave({ name: nextName, songMetadataPatch: null });
      onClose();
      return;
    }

    onSave({
      name: nextName,
      songMetadataPatch: {
        ...songMetadata,
        trackName: nextName,
        artistName: trimmedArtist,
        albumName: trimmedAlbum || undefined,
      },
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Song details"
      size="md"
      zIndexLevel={2}
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Song name"
          value={localName}
          onChange={(v) => setLocalName(v as string)}
          data-ignore-undo="true"
        />
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
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={!localName.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};
