import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pencil, Trash2, X } from "lucide-react";
import Button from "./Button/Button";
import Input from "./Input/Input";
import ContentPreviewDialog, { type ContentPreviewNavigation } from "./ContentPreview/ContentPreviewDialog";
import { createChurchResourcePreview, createSongAudioPreview } from "./ContentPreview/contentPreview";
import type { PreviewSourceCache } from "./ContentPreview/previewSourceCache";
import { getChurchResourceUrl, getSongAudioUrl } from "../api/auth";
import { resourceEntryName, resourceEntryDeleteActionLabel } from "../utils/churchResourceCatalog";
import { typeLabel, formatEntrySize, formatDate, entryUpdatedAt, errorMessage } from "../utils/resourceLibraryPresentation";
import type { ChurchResource, ResourceLibraryEntry } from "../types/churchResource";
import { DropdownMenuItem } from "./ui/DropdownMenu";

export const downloadResourceEntry = async (churchId: string, entry: ResourceLibraryEntry) => {
  if (entry.source === "church-resource" && entry.resource.sourceType === "external") return;
  const result =
    entry.source === "church-resource"
      ? await getChurchResourceUrl({
          churchId,
          resourceId: entry.resource.id,
          disposition: "attachment",
        })
      : await getSongAudioUrl({
          churchId,
          songId: entry.songId,
          audio: entry.audio,
          disposition: "attachment",
        });
  window.open(result.url, "_blank", "noopener,noreferrer");
};

export const createLibraryPreview = (churchId: string, entry: ResourceLibraryEntry) => {
  if (entry.source === "song-audio") {
    return createSongAudioPreview(entry.audio, entry.songId, async () => ({
      ...await getSongAudioUrl({ churchId, songId: entry.songId, audio: entry.audio, disposition: "inline" }),
      mimeType: entry.audio.contentType, fileName: entry.audio.fileName, provider: "worshipsync", sourceKind: "file",
    }));
  }
  const resource = entry.resource;
  if (resource.sourceType === "external") return createChurchResourcePreview(resource);
  return createChurchResourcePreview(resource, async () => ({
    ...await getChurchResourceUrl({ churchId, resourceId: resource.id, disposition: "inline" }),
    mimeType: resource.storage.contentType, fileName: resource.storage.fileName, provider: "worshipsync", sourceKind: "file",
  }));
};

const ResourcePreview = ({
  churchId,
  entry,
  onRename,
  onDelete,
  canEdit,
  onClose,
  navigation,
  sourceCache,
  initialAction,
}: {
  churchId: string;
  entry: ResourceLibraryEntry;
  onRename: (resource: ChurchResource, name: string) => Promise<void>;
  onDelete: (entry: ResourceLibraryEntry) => Promise<void>;
  canEdit: boolean;
  onClose: () => void;
  navigation?: ContentPreviewNavigation;
  sourceCache: PreviewSourceCache;
  initialAction?: "rename";
}) => {
  const resource = entry.source === "church-resource" ? entry.resource : undefined;
  const preview = useMemo(() => createLibraryPreview(churchId, entry), [churchId, entry]);
  const [error, setError] = useState("");
  const [editingName, setEditingName] = useState(initialAction === "rename");
  const initialRenameEntry = useRef(initialAction === "rename" ? entry : null);
  const [nameDraft, setNameDraft] = useState(resourceEntryName(entry));
  const [savingName, setSavingName] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNameDraft(resourceEntryName(entry));
    setEditingName(initialRenameEntry.current === entry);
    setError("");
    setDownloading(false);
    setDeleting(false);
  }, [churchId, entry, resource, initialAction]);

  const saveName = async () => {
    initialRenameEntry.current = null;
    if (!resource || !nameDraft.trim() || nameDraft.trim() === resource.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await onRename(resource, nameDraft.trim());
      setEditingName(false);
    } catch (renameError) {
      setError(errorMessage(renameError, "The resource could not be renamed."));
    } finally {
      setSavingName(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadResourceEntry(churchId, entry);
    } catch (downloadError) {
      setError(errorMessage(downloadError, "The download could not be started."));
    } finally {
      setDownloading(false);
    }
  };

  const deleteResource = async () => {
    setDeleting(true);
    try {
      await onDelete(entry);
    } finally {
      setDeleting(false);
    }
  };

  const deletionIncomplete = resource?.deletionStatus === "deleting";
  const canDownload = entry.source === "song-audio" || resource?.sourceType !== "external";
  const canRename = Boolean(resource && canEdit);
  const canDelete = canEdit && entry.source === "church-resource";
  const hasManagementActions = canDownload || canRename || canDelete;
  const showSecondaryInfo = Boolean(resource?.description || error || (editingName && resource));
  const navigationBusy = editingName || savingName || downloading || deleting;
  return (
    <>
      <ContentPreviewDialog
        resource={preview}
        navigation={navigation ? {
          ...navigation,
          onPrevious: navigationBusy ? undefined : navigation.onPrevious,
          onNext: navigationBusy ? undefined : navigation.onNext,
        } : undefined}
        sourceCache={sourceCache}
        onClose={onClose}
        dialogLabel={resourceEntryName(entry)}
        metadata={`${typeLabel(entry)} · ${formatEntrySize(entry)} · Updated ${formatDate(entryUpdatedAt(entry))}`}
        secondaryInfo={showSecondaryInfo ? <>
          {resource?.description ? <p className="mt-1 text-sm text-gray-300">{resource.description}</p> : null}
          {error ? <p className="mt-1 text-red-300" role="alert">{error}</p> : null}
          {editingName && resource ? <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1"><Input label="Resource name" value={nameDraft} onChange={(value) => setNameDraft(String(value))} /></div>
            <Button type="button" variant="cta" isLoading={savingName} disabled={savingName} onClick={() => void saveName()}>Save</Button>
            <Button type="button" variant="tertiary" aria-label="Cancel rename" svg={X} onClick={() => { initialRenameEntry.current = null; setEditingName(false); }} />
          </div> : null}
        </> : undefined}
        menuActions={hasManagementActions ? <>
          {canDownload ? <DropdownMenuItem disabled={deletionIncomplete || Boolean(error) || downloading || deleting} onSelect={(event) => { event.preventDefault(); void download(); }}><Download />{downloading ? "Downloading…" : "Download"}</DropdownMenuItem> : null}
          {canRename && !editingName ? <DropdownMenuItem disabled={deletionIncomplete || savingName || downloading || deleting} onSelect={() => setEditingName(true)}><Pencil />Rename</DropdownMenuItem> : null}
          {canDelete ? <DropdownMenuItem variant="destructive" disabled={deleting || downloading || savingName} onSelect={() => void deleteResource()}><Trash2 />{deleting ? "Deleting…" : deletionIncomplete ? "Retry deletion" : resourceEntryDeleteActionLabel(entry)}</DropdownMenuItem> : null}
        </> : undefined}
      />
    </>
  );
};

export default ResourcePreview;
