import { useEffect, useState } from "react";
import Modal from "../Modal/Modal";
import Input from "../Input/Input";
import Button from "../Button/Button";
import type { ItemType, SongMetadata } from "../../types";
import { createManualSongMetadata } from "../../utils/lrclib";

export type ItemDetailsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  itemType: ItemType;
  itemName: string;
  songMetadata: SongMetadata | undefined;
  /** Omit when only the visible name changes. `null` clears stored metadata (songs only). */
  onSave: (payload: {
    name: string;
    songMetadataPatch?: SongMetadata | null;
  }) => void;
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
  onSave,
}: ItemDetailsEditorFieldsProps) {
  const [localName, setLocalName] = useState(itemName);
  const [artistName, setArtistName] = useState("");
  const [albumName, setAlbumName] = useState("");
  const isSong = itemType === "song";

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

    if (!isSong) {
      onSave({ name: nextName });
      onClose();
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
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="tertiary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="cta" onClick={handleSave} disabled={!localName.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}
