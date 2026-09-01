import { useEffect, useState } from "react";
import Modal from "../Modal/Modal";
import Input from "../Input/Input";
import Button from "../Button/Button";
import type {
  ItemType,
  SongAudio,
  SongLink,
  SongLinkSegment,
  SongMetadata,
} from "../../types";
import { createManualSongMetadata } from "../../utils/lrclib";
import {
  formatYouTubeTimestamp,
  getYouTubeVideoReference,
  parseYouTubeTimestamp,
} from "../../utils/youtube";
import SongAudioAttachment from "./SongAudioAttachment";
import { cn } from "@/utils/cnHelper";

const EMPTY_SONG_LINKS: SongLink[] = [];

type EditableSongLinkSegment = Omit<
  SongLinkSegment,
  "label" | "startSeconds" | "endSeconds"
> & {
  label: string;
  startTime: string;
  endTime: string;
};

type EditableSongLink = Omit<SongLink, "label" | "segments"> & {
  label: string;
  segments: EditableSongLinkSegment[];
};

const createEditorId = (prefix: string) =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const toEditableSongLinks = (links: SongLink[]): EditableSongLink[] =>
  links.map((link) => ({
    id: link.id,
    label: link.label ?? "",
    url: link.url,
    segments: (link.segments ?? []).map((segment) => ({
      id: segment.id,
      label: segment.label ?? "",
      startTime: formatYouTubeTimestamp(segment.startSeconds),
      endTime:
        segment.endSeconds === undefined
          ? ""
          : formatYouTubeTimestamp(segment.endSeconds),
    })),
  }));

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
  className?: string;
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
  className,
}: ItemDetailsEditorFieldsProps) {
  const [localName, setLocalName] = useState(itemName);
  const [artistName, setArtistName] = useState("");
  const [albumName, setAlbumName] = useState("");
  const [songKey, setSongKey] = useState("");
  const [localSongLinks, setLocalSongLinks] = useState<EditableSongLink[]>(() =>
    toEditableSongLinks(songLinks),
  );
  const [linkError, setLinkError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isSong = itemType === "song";

  useEffect(() => {
    if (!isOpen) return;
    setLocalName(itemName);
    setArtistName(songMetadata?.artistName ?? "");
    setAlbumName(songMetadata?.albumName ?? "");
    setSongKey(songMetadata?.key ?? "");
    setLocalSongLinks(toEditableSongLinks(songLinks));
    setLinkError("");
    setSaveError("");
  }, [isOpen, itemName, songLinks, songMetadata]);

  const updateSongLink = (id: string, patch: Partial<EditableSongLink>) => {
    setLocalSongLinks((links) =>
      links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    );
  };

  const addSongLink = () => {
    setLocalSongLinks((links) => [
      ...links,
      { id: createEditorId("song-link"), label: "", url: "", segments: [] },
    ]);
  };

  const addSongLinkSegment = (linkId: string) => {
    setLocalSongLinks((links) =>
      links.map((link) => {
        if (link.id !== linkId) return link;
        const linkedStart =
          getYouTubeVideoReference(link.url)?.startSeconds ?? 0;
        return {
          ...link,
          segments: [
            ...link.segments,
            {
              id: createEditorId("song-link-segment"),
              label: "",
              startTime: formatYouTubeTimestamp(linkedStart),
              endTime: "",
            },
          ],
        };
      }),
    );
  };

  const updateSongLinkSegment = (
    linkId: string,
    segmentId: string,
    patch: Partial<EditableSongLinkSegment>,
  ) => {
    setLocalSongLinks((links) =>
      links.map((link) =>
        link.id === linkId
          ? {
              ...link,
              segments: link.segments.map((segment) =>
                segment.id === segmentId
                  ? { ...segment, ...patch }
                  : segment,
              ),
            }
          : link,
      ),
    );
  };

  const validateSongLinks = (): SongLink[] | null => {
    const links: SongLink[] = [];
    for (const editableLink of localSongLinks) {
      const label = editableLink.label.trim();
      const url = editableLink.url.trim();
      if (!label && !url) continue;

      if (!url) {
        setLinkError("Enter a valid http(s) address or remove the empty link.");
        return null;
      }

      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
          throw new Error("Unsupported protocol");
        }
      } catch {
        setLinkError("Enter a valid http(s) address for each link.");
        return null;
      }

      const youtube = getYouTubeVideoReference(url);
      if (editableLink.segments.length && !youtube) {
        setLinkError(
          "Reference segments require a valid YouTube address. Update the address or remove the segments.",
        );
        return null;
      }

      const segments: SongLinkSegment[] = [];
      for (const editableSegment of editableLink.segments) {
        const startSeconds = parseYouTubeTimestamp(editableSegment.startTime);
        const endSeconds = editableSegment.endTime.trim()
          ? parseYouTubeTimestamp(editableSegment.endTime)
          : undefined;
        if (startSeconds === null) {
          setLinkError("Enter each start time as mm:ss or hh:mm:ss.");
          return null;
        }
        if (endSeconds === null || (endSeconds !== undefined && endSeconds <= startSeconds)) {
          setLinkError("Each end time must be later than its start time.");
          return null;
        }
        const segmentLabel = editableSegment.label.trim();
        segments.push({
          id: editableSegment.id,
          ...(segmentLabel ? { label: segmentLabel } : {}),
          startSeconds,
          ...(endSeconds === undefined ? {} : { endSeconds }),
        });
      }

      links.push({
        id: editableLink.id,
        ...(label ? { label } : {}),
        url,
        ...(segments.length ? { segments } : {}),
      });
    }
    setLinkError("");
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
    const trimmedKey = songKey.trim();
    const hasSongDetails = Boolean(trimmedArtist || trimmedAlbum || trimmedKey);
    const nextSongLinks = validateSongLinks();
    if (!nextSongLinks) return;

    if (!songMetadata) {
      await saveAndClose({
        name: nextName,
        ...(hasSongDetails
          ? {
            songMetadataPatch: createManualSongMetadata({
              trackName: nextName,
              artistName: trimmedArtist,
              albumName: trimmedAlbum || undefined,
              key: trimmedKey || undefined,
            }),
          }
          : {}),
        songLinksPatch: nextSongLinks,
      });
      return;
    }

    if (songMetadata.source === "manual" && !hasSongDetails) {
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
        key: trimmedKey || undefined,
      },
      songLinksPatch: nextSongLinks,
    });
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
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
          <Input
            label="Key"
            value={songKey}
            onChange={(v) => setSongKey(v as string)}
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
                  label="Link label (optional)"
                  value={link.label}
                  onChange={(value) => updateSongLink(link.id, { label: String(value) })}
                />
                <Input
                  label="Link address"
                  type="url"
                  value={link.url}
                  onChange={(value) => updateSongLink(link.id, { url: String(value) })}
                />
                {getYouTubeVideoReference(link.url) || link.segments.length ? (
                  <section className="mt-2 border-t border-gray-700 pt-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">
                          Reference segments
                        </p>
                        <p className="text-xs text-gray-400">
                          Save exact portions using mm:ss or hh:mm:ss.
                        </p>
                      </div>
                      {getYouTubeVideoReference(link.url) ? (
                        <Button
                          variant="tertiary"
                          className="shrink-0 text-sm"
                          onClick={() => addSongLinkSegment(link.id)}
                        >
                          Add segment
                        </Button>
                      ) : null}
                    </div>
                    {link.segments.map((segment, segmentIndex) => (
                      <div
                        key={segment.id}
                        className="mt-2 rounded border border-gray-700 bg-gray-900/60 p-2"
                      >
                        <p className="mb-1 text-xs font-medium text-gray-300">
                          Segment {segmentIndex + 1}
                        </p>
                        <Input
                          label="Segment label (optional)"
                          value={segment.label}
                          onChange={(value) =>
                            updateSongLinkSegment(link.id, segment.id, {
                              label: String(value),
                            })
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            label="Start time"
                            value={segment.startTime}
                            placeholder="12:35"
                            onChange={(value) =>
                              updateSongLinkSegment(link.id, segment.id, {
                                startTime: String(value),
                              })
                            }
                          />
                          <Input
                            label="End time (optional)"
                            value={segment.endTime}
                            placeholder="16:08"
                            onChange={(value) =>
                              updateSongLinkSegment(link.id, segment.id, {
                                endTime: String(value),
                              })
                            }
                          />
                        </div>
                        <Button
                          variant="textLink"
                          className="mt-1 text-sm text-red-300"
                          onClick={() =>
                            updateSongLink(link.id, {
                              segments: link.segments.filter(
                                (entry) => entry.id !== segment.id,
                              ),
                            })
                          }
                        >
                          Remove segment
                        </Button>
                      </div>
                    ))}
                  </section>
                ) : null}
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
