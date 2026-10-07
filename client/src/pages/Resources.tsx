import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  AudioLines,
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  FolderOpen,
  Pencil,
  Plus,
  Link2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import AppWorkspaceShell from "../components/AppPageShell/AppWorkspaceShell";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Input from "../components/Input/Input";
import ConfirmDialog from "../components/Modal/ConfirmDialog";
import ContentPreviewDialog, { type ContentPreviewNavigation } from "../components/ContentPreview/ContentPreviewDialog";
import { createChurchResourcePreview, createSongAudioPreview, resolvePreviewSource } from "../components/ContentPreview/contentPreview";
import { createPreviewSourceCache, type PreviewSourceCache } from "../components/ContentPreview/previewSourceCache";
import { ExternalResourceDialog } from "./ExternalResourceDialog";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  deleteChurchResource,
  deleteSongAudioWithRetry,
  getChurchResourceUrl,
  getSongAudioUrl,
  listChurchResources,
  updateChurchResource,
} from "../api/auth";
import { useDispatch, useSelector } from "../hooks";
import { upsertItemInAllDocs } from "../store/allDocsSlice";
import { upsertItemInAllItemsList } from "../store/allItemsSlice";
import { broadcastItemUpdate } from "../store/store";
import { updateAllDocs } from "../utils/dbUtils";
import { useChurchStorageQuota } from "../components/StorageUsage/useChurchStorageQuota";
import { StorageUsageIndicators } from "../components/StorageUsage/StorageUsageIndicators";
import {
  buildChurchResourceLibraryEntries,
  resourceEntryContentType,
  resourceEntryDeleteActionLabel,
  resourceEntryDeleteConfirmation,
  resourceEntryKind,
  resourceEntryName,
  resourceEntrySize,
  resourceEntrySource,
} from "../utils/churchResourceCatalog";
import {
  deleteSongAudioBeforeClearingMetadata,
  persistSongAudioAttachment,
} from "../utils/persistSongAudioAttachment";
import type {
  ChurchResource,
  ResourceLibraryEntry,
} from "../types/churchResource";
import ResourceUploadDialog from "./ResourceUploadDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/DropdownMenu";

type ResourceFilter = "all" | "document" | "image" | "audio";
type ResourceSortKey = "name" | "type" | "size" | "updated" | "source";
type SortDirection = "asc" | "desc";

const formatBytes = (sizeBytes: number) => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};
const formatEntrySize = (entry: ResourceLibraryEntry) => {
  const size = entrySize(entry);
  return size === null ? "External" : formatBytes(size);
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString();
};

const entryUpdatedAt = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource"
    ? entry.resource.updatedAt || (entry.resource.sourceType === "external" ? "" : entry.resource.storage.uploadedAt)
    : entry.audio.uploadedAt;

const typeLabel = (entry: ResourceLibraryEntry) => {
  const contentType = resourceEntryContentType(entry);
  const external = entry.source === "church-resource" && entry.resource.sourceType === "external"
    ? entry.resource.external
    : undefined;
  if (external?.mediaType === "web") return "Web";
  if (external?.mediaType === "image") return "Image";
  if (external?.mediaType === "video") return "Video";
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "text/plain") return "TXT";
  if (contentType.includes("wordprocessingml") || contentType === "application/msword") return "DOCX";
  if (contentType.includes("presentationml") || contentType === "application/vnd.ms-powerpoint") return "PPTX";
  if (contentType.includes("spreadsheetml") || contentType === "application/vnd.ms-excel") return "XLSX";
  if (contentType === "audio/mpeg") return "MP3";
  if (contentType.startsWith("text/")) return "TXT";
  if (contentType.startsWith("image/")) return "Image";
  if (contentType.startsWith("video/")) return "Video";
  if (contentType.startsWith("audio/")) return contentType.split("/")[1].toUpperCase();
  const fileName = entry.source === "song-audio"
    ? entry.audio.fileName
    : entry.resource.sourceType === "external"
      ? entry.resource.external.fileName
      : entry.resource.storage.fileName;
  const extension = fileName?.split(".").pop()?.toLowerCase();
  const extensionLabels: Record<string, string> = {
    doc: "DOC", docx: "DOCX", md: "MD", mp3: "MP3", pdf: "PDF", ppt: "PPT",
    pptx: "PPTX", txt: "TXT", wav: "WAV", xls: "XLS", xlsx: "XLSX",
  };
  if (extension && extension !== fileName?.toLowerCase()) return extensionLabels[extension] || extension.toUpperCase();
  if (external) {
    if (external.mediaType === "audio") return "Audio";
    if (external.mediaType === "document") return "Document";
    return "Link";
  }
  return "File";
};

const entryKey = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource"
    ? `resource:${entry.resource.id}`
    : `song-audio:${entry.songId}:${entry.audio.id}`;

const entrySize = (entry: ResourceLibraryEntry) =>
  resourceEntrySize(entry);

const entrySource = (entry: ResourceLibraryEntry) =>
  resourceEntrySource(entry);

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const createLibraryPreview = (churchId: string, entry: ResourceLibraryEntry) => {
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
}: {
  churchId: string;
  entry: ResourceLibraryEntry;
  onRename: (resource: ChurchResource, name: string) => Promise<void>;
  onDelete: (entry: ResourceLibraryEntry) => Promise<void>;
  canEdit: boolean;
  onClose: () => void;
  navigation?: ContentPreviewNavigation;
  sourceCache: PreviewSourceCache;
}) => {
  const resource = entry.source === "church-resource" ? entry.resource : undefined;
  const preview = useMemo(() => createLibraryPreview(churchId, entry), [churchId, entry]);
  const [error, setError] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(resourceEntryName(entry));
  const [savingName, setSavingName] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNameDraft(resourceEntryName(entry));
    setEditingName(false);
    setError("");
    setDownloading(false);
    setDeleting(false);
  }, [churchId, entry, resource]);

  const saveName = async () => {
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
            <Button type="button" variant="tertiary" aria-label="Cancel rename" svg={X} onClick={() => setEditingName(false)} />
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

const ResourcesPage = () => {
  const { churchId, churchName, access } = useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const scrollbarWidth = useSelector((state) => state.undoable.present.preferences.scrollbarWidth);
  const [resources, setResources] = useState<ChurchResource[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const pendingResourceDialog = useRef<"upload" | "external" | null>(null);
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ResourceSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedResourceKeys, setSelectedResourceKeys] = useState<Set<string>>(new Set());
  const [recentlyUploadedKeys, setRecentlyUploadedKeys] = useState<Set<string>>(new Set());
  const [deleteCandidates, setDeleteCandidates] = useState<ResourceLibraryEntry[] | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [churchResourcesLoading, setChurchResourcesLoading] = useState(true);
  const [songDocsLoading, setSongDocsLoading] = useState(true);
  const [churchResourcesError, setChurchResourcesError] = useState("");
  const [songDocsError, setSongDocsError] = useState("");
  const [error, setError] = useState("");

  const canBrowse = access === "full" || access === "music" || access === "view";
  const canEdit = access === "full";
  const storageQuota = useChurchStorageQuota(churchId, canBrowse);
  // A church switch is a cache ownership boundary; signed URLs never cross it.
  const previewSources = useMemo(() => ({ churchId, cache: createPreviewSourceCache() }), [churchId]);
  const sourceCache = previewSources.cache;

  useEffect(() => {
    if (!canBrowse) {
      setChurchResourcesLoading(false);
      setChurchResourcesError("");
      return;
    }
    if (!churchId) {
      setChurchResourcesLoading(true);
      return;
    }
    let active = true;
    setChurchResourcesLoading(true);
    setChurchResourcesError("");
    setResources([]);
    void listChurchResources(churchId)
      .then((result) => {
        if (active) setResources(result.resources);
      })
      .catch((loadError) => {
        if (active) setChurchResourcesError(errorMessage(loadError, "Resources could not be loaded."));
      })
      .finally(() => {
        if (active) setChurchResourcesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canBrowse, churchId]);

  useEffect(() => {
    if (!canBrowse) {
      setSongDocsLoading(false);
      setSongDocsError("");
      return;
    }
    if (!db) {
      setSongDocsLoading(true);
      return;
    }

    let active = true;
    setSongDocsLoading(true);
    setSongDocsError("");
    void updateAllDocs(dispatch, db, () => active).then((loaded) => {
      if (!active) return;
      setSongDocsLoading(false);
      if (!loaded) setSongDocsError("The song library could not be loaded. Try again.");
    });
    return () => {
      active = false;
    };
  }, [canBrowse, db, dispatch]);

  const entries = useMemo(
    () =>
      buildChurchResourceLibraryEntries({ resources, songs: allSongDocs }).filter((entry) => {
        const matchesKind = filter === "all" || resourceEntryKind(entry) === filter;
        const externalDetails = entry.source === "church-resource" && entry.resource.sourceType === "external"
          ? `${entry.resource.external.url} ${entry.resource.external.fileName || ""}`
          : "";
        const text = `${resourceEntryName(entry)} ${entrySource(entry)} ${entry.source === "song-audio" ? entry.songName : ""} ${externalDetails}`.toLowerCase();
        return matchesKind && text.includes(query.trim().toLowerCase());
      }),
    [allSongDocs, filter, query, resources],
  );
  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    if (!sortKey || !sortDirection) return sorted;
    sorted.sort((left, right) => {
      let comparison = 0;
      if (sortKey === "name") comparison = resourceEntryName(left).localeCompare(resourceEntryName(right), undefined, { numeric: true, sensitivity: "base" });
      if (sortKey === "type") comparison = typeLabel(left).localeCompare(typeLabel(right), undefined, { sensitivity: "base" });
      if (sortKey === "size") comparison = (entrySize(left) ?? -1) - (entrySize(right) ?? -1);
      if (sortKey === "updated") comparison = new Date(entryUpdatedAt(left)).getTime() - new Date(entryUpdatedAt(right)).getTime();
      if (sortKey === "source") comparison = entrySource(left).localeCompare(entrySource(right), undefined, { sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [entries, sortDirection, sortKey]);
  const changeSort = (nextKey: ResourceSortKey) => {
    if (sortKey === nextKey && sortDirection === "asc") {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    if (sortKey === nextKey && sortDirection === "desc") {
      setSortKey(null);
      setSortDirection(null);
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };
  const selectedEntry = entries.find((entry) => entryKey(entry) === selectedKey) || null;
  const previewIndex = sortedEntries.findIndex((entry) => entryKey(entry) === selectedKey);

  useEffect(() => {
    if (!churchId || previewIndex < 0) return;
    for (const index of [previewIndex - 1, previewIndex + 1]) {
      const neighbor = sortedEntries[index];
      if (neighbor) {
        // Prepare descriptors only. A failed speculative request remains retryable.
        void resolvePreviewSource(createLibraryPreview(churchId, neighbor), sourceCache).catch(() => {});
      }
    }
  }, [churchId, previewIndex, sortedEntries, sourceCache]);
  const selectableEntries = entries.filter((entry) => entry.source === "church-resource");
  const selectedEntries = selectableEntries.filter((entry) => selectedResourceKeys.has(entryKey(entry)));
  const allSelectableEntriesSelected = selectableEntries.length > 0 && selectedEntries.length === selectableEntries.length;
  const loading = churchResourcesLoading || songDocsLoading;
  const loadErrors = [churchResourcesError, songDocsError].filter(Boolean);

  useEffect(() => {
    if (recentlyUploadedKeys.size === 0) return;
    const timeout = window.setTimeout(() => setRecentlyUploadedKeys(new Set()), 6000);
    return () => window.clearTimeout(timeout);
  }, [recentlyUploadedKeys]);

  const renameResource = async (resource: ChurchResource, name: string) => {
    if (!churchId) return;
    const result = await updateChurchResource({ churchId, resourceId: resource.id, name });
    setResources((current) => current.map((item) => item.id === resource.id ? result.resource : item));
  };

  const requestDelete = async (entry: ResourceLibraryEntry) => {
    setDeleteCandidates([entry]);
  };

  const toggleResourceSelection = (entry: ResourceLibraryEntry) => {
    if (entry.source !== "church-resource") return;
    const key = entryKey(entry);
    setSelectedResourceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllResourceSelection = () => {
    setSelectedResourceKeys(allSelectableEntriesSelected ? new Set() : new Set(selectableEntries.map(entryKey)));
  };

  const requestDeleteSelected = () => {
    if (selectedEntries.length) setDeleteCandidates(selectedEntries);
  };

  const confirmDelete = async () => {
    const candidates = deleteCandidates;
    if (!churchId || !candidates?.length || deletingKey !== null) return;
    setDeletingKey("bulk");
    setError("");
    let storageChanged = false;
    try {
      for (const entry of candidates) {
        if (entry.source === "church-resource") {
          await deleteChurchResource({ churchId, resourceId: entry.resource.id });
          if (entry.resource.sourceType !== "external") storageChanged = true;
          setResources((current) => current.filter((resource) => resource.id !== entry.resource.id));
        } else {
          if (!db) throw new Error("The song library is not available. Try again.");
          await deleteSongAudioBeforeClearingMetadata({
            deleteAudio: () => deleteSongAudioWithRetry({ churchId, songId: entry.songId, audio: entry.audio }),
            clearMetadata: async () => {
              const saved = await persistSongAudioAttachment({ db, songId: entry.songId, audio: null });
              dispatch(upsertItemInAllDocs(saved));
              dispatch(upsertItemInAllItemsList({
                _id: saved._id,
                name: saved.name,
                type: saved.type,
                listId: saved._id,
                background: typeof saved.background === "string" ? saved.background : "",
              }));
              broadcastItemUpdate(saved);
              return saved;
            },
          });
          storageChanged = true;
        }
      }
      setSelectedResourceKeys(new Set());
      setSelectedKey(null);
    } catch (deleteError) {
      const message = errorMessage(deleteError, "The resource could not be deleted.");
      if ((deleteError as { status?: number })?.status !== 409) {
        setResources((current) => current.map((resource) =>
          candidates.some((entry) => entry.source === "church-resource" && entry.resource.id === resource.id)
            ? { ...resource, deletionStatus: "deleting", deletionError: message }
            : resource,
        ));
      }
      setError(message);
    } finally {
      if (storageChanged) void storageQuota.refresh();
      setDeletingKey(null);
      setDeleteCandidates(null);
    }
  };

  return (
    <AppWorkspaceShell title="Resources" mobileTitle="Resources" icon={FolderOpen} churchName={churchName} scrollbarWidth={scrollbarWidth}>
      <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden border border-gray-700 bg-gray-900/40">
        {!canBrowse ? (
          <div className="m-4 rounded border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-100" role="alert">Resource browsing is not available for this session.</div>
        ) : (
          <>
            <StorageUsageIndicators
              status={storageQuota.status}
              quotas={storageQuota.quotas}
              providers={["r2"]}
              onRetry={storageQuota.refresh}
              className="mx-4 mt-3"
            />
            <div className="flex flex-wrap items-end gap-3 border-b border-gray-700 p-4">
              <div className="min-w-[14rem] flex-1"><Input label="Search resources" hideLabel value={query} onChange={(value) => setQuery(String(value))} placeholder="Search..." /></div>
              {selectedEntries.length ? <Button type="button" variant="destructive" svg={Trash2} onClick={requestDeleteSelected}>Delete selected ({selectedEntries.length})</Button> : null}
              {canEdit && churchId ? <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="cta" svg={Plus}>Add resource</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onCloseAutoFocus={() => {
                    // Open after the menu releases its focus scope and restores the trigger.
                    const dialog = pendingResourceDialog.current;
                    pendingResourceDialog.current = null;
                    if (dialog === "upload") setUploadOpen(true);
                    if (dialog === "external") setExternalOpen(true);
                  }}>
                    <DropdownMenuItem onSelect={() => { pendingResourceDialog.current = "upload"; }}><Upload />Upload file</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { pendingResourceDialog.current = "external"; }}><Link2 />Add external link</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                  <ResourceUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} showTrigger={false} churchId={churchId} onResourcesUploaded={(uploadedResources) => {
                    setResources((current) => [...uploadedResources, ...current]);
                    setRecentlyUploadedKeys(new Set(uploadedResources.map((resource) => `resource:${resource.id}`)));
                    void storageQuota.refresh();
                  }} />
                  <ExternalResourceDialog open={externalOpen} onOpenChange={setExternalOpen} showTrigger={false} churchId={churchId} onCreated={(resource) => {
                    setResources((current) => [resource, ...current]);
                    setRecentlyUploadedKeys(new Set([`resource:${resource.id}`]));
                  }} />
              </> : null}
            </div>
            <div className="flex flex-wrap gap-2 border-b border-gray-700 px-4 py-2" role="tablist" aria-label="Resource types">
              {(["all", "document", "image", "audio"] as const).map((value) => (
                <Button key={value} type="button" variant="tertiary" isSelected={filter === value} aria-pressed={filter === value} className={filter === value ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-transparent text-gray-300 hover:border-gray-500 hover:bg-gray-800"} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "document" ? "Documents" : value === "image" ? "Images" : "Audio"}</Button>
              ))}
            </div>
            {loadErrors.map((loadError) => <div key={loadError} className="mx-4 mt-3 rounded border border-red-700/60 bg-red-950/20 p-3 text-sm text-red-200" role="alert">{loadError}</div>)}
            {error ? <div className="mx-4 mt-3 rounded border border-red-700/60 bg-red-950/20 p-3 text-sm text-red-200" role="alert">{error}</div> : null}
            {loading ? <ResourceTableSkeleton /> : null}
            {!loading && !loadErrors.length && !entries.length ? <div className="p-8 text-center text-sm text-gray-400"><FileText className="mx-auto mb-2 size-8 text-gray-600" aria-hidden />No resources match this view.</div> : null}
            {!loading && sortedEntries.length ? (
              <div className="min-h-0 flex-1 overflow-auto pb-4">
                <div className="rounded border border-gray-700">
                  <table className="w-full min-w-[48rem] table-fixed text-left text-sm">
                    <caption className="sr-only">Resources</caption>
                    <thead className="sticky top-0 z-10 bg-gray-950 text-xs uppercase tracking-wide text-gray-400 shadow-sm shadow-black/20">
                      <tr>
                        <th scope="col" className="w-12 px-4 py-3">
                          <Checkbox
                            label="Select all resources"
                            hideLabel
                            checked={allSelectableEntriesSelected}
                            disabled={!selectableEntries.length}
                            onCheckedChange={toggleAllResourceSelection}
                            className="inline-flex"
                          />
                        </th>
                        {([
                          ["name", "Name", "w-[34%]"],
                          ["type", "Type", "w-[10%]"],
                          ["size", "Size", "w-[12%]"],
                          ["updated", "Updated", "w-[16%]"],
                          ["source", "Source", "w-[24%]"],
                        ] as const).map(([key, label, width]) => (
                          <th key={key} scope="col" aria-sort={sortKey === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"} className={`${width} px-4 py-3`}>
                            <button type="button" className="flex cursor-pointer items-center gap-1 text-left hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" onClick={() => changeSort(key)}>
                              {label}
                              {sortKey === key && sortDirection === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : null}
                              {sortKey === key && sortDirection === "desc" ? <ArrowDown className="size-3.5" aria-hidden /> : null}
                              {sortKey !== key ? <ArrowUpDown className="size-3.5" aria-hidden /> : null}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {sortedEntries.map((entry) => {
                        const key = entryKey(entry);
                        const selected = selectedKey === key;
                        const recentlyUploaded = recentlyUploadedKeys.has(key);
                        const canSelect = entry.source === "church-resource";
                        const selectedForDelete = selectedResourceKeys.has(key);
                        return (
                          <tr
                            key={key}
                            tabIndex={0}
                            role="button"
                            aria-label={`Preview ${resourceEntryName(entry)}`}
                            aria-pressed={selected}
                            className={`cursor-pointer outline-none ${recentlyUploaded ? "bg-green-500/10" : selected ? "bg-cyan-500/10" : "bg-gray-900/40 hover:bg-cyan-500/10"} focus-visible:bg-cyan-500/10`}
                            onClick={() => setSelectedKey(key)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedKey(key);
                              }
                            }}
                          >
                            <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                              {canSelect ? (
                                <Checkbox
                                  label={`Select ${resourceEntryName(entry)}`}
                                  hideLabel
                                  checked={selectedForDelete}
                                  onCheckedChange={(checked) => {
                                    if (checked !== selectedForDelete) toggleResourceSelection(entry);
                                  }}
                                  className="inline-flex"
                                />
                              ) : null}
                            </td>
                            <td className="max-w-0 px-4 py-3">
                              <span className="flex w-full min-w-0 items-center gap-2 text-left text-gray-100">
                                {resourceEntryKind(entry) === "audio" ? <AudioLines className="size-4 shrink-0 text-amber-300" aria-hidden /> : resourceEntryKind(entry) === "image" ? <ImageIcon className="size-4 shrink-0 text-cyan-300" aria-hidden /> : <FileText className="size-4 shrink-0 text-cyan-300" aria-hidden />}
                                <span className="truncate font-semibold">{resourceEntryName(entry)}</span>
                                {recentlyUploaded ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-200"><CheckCircle2 className="size-3" aria-hidden />{entry.source === "church-resource" && entry.resource.sourceType === "external" ? "Added" : "Uploaded"}</span> : null}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{typeLabel(entry)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{formatEntrySize(entry)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{formatDate(entryUpdatedAt(entry))}</td>
                            <td className="max-w-0 px-4 py-3 text-gray-400"><span className="block truncate">{entrySource(entry)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {selectedEntry && churchId ? (
              <ResourcePreview churchId={churchId} entry={selectedEntry} onRename={renameResource} onDelete={requestDelete} canEdit={canEdit} onClose={() => setSelectedKey(null)} sourceCache={sourceCache} navigation={previewIndex >= 0 ? {
                index: previewIndex,
                total: sortedEntries.length,
                onPrevious: previewIndex > 0 ? () => setSelectedKey(entryKey(sortedEntries[previewIndex - 1])) : undefined,
                onNext: previewIndex < sortedEntries.length - 1 ? () => setSelectedKey(entryKey(sortedEntries[previewIndex + 1])) : undefined,
              } : undefined} />
            ) : null}
            {deleteCandidates?.length ? (
              <ConfirmDialog
                open
                onCancel={() => setDeleteCandidates(null)}
                onConfirm={() => void confirmDelete()}
                title="Delete resource?"
                confirmLabel="Delete"
                destructive
                busy={deletingKey !== null}
                size="sm"
                zIndexLevel={2}
                description={`Confirm deletion of ${deleteCandidates.length} resource${deleteCandidates.length === 1 ? "" : "s"}`}
              >
                <div className="space-y-4">
                  <p className="text-sm text-gray-200">{deleteCandidates.length === 1 ? resourceEntryDeleteConfirmation(deleteCandidates[0]) : `Delete these ${deleteCandidates.length} resources?`}</p>
                  {deleteCandidates.length > 1 ? <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-gray-300">{deleteCandidates.map((entry) => <li key={entryKey(entry)}>{resourceEntryName(entry)}</li>)}</ul> : null}
                </div>
              </ConfirmDialog>
            ) : null}
          </>
        )}
      </section>
    </AppWorkspaceShell>
  );
};

export const ResourceTableSkeleton = () => (
  <div className="min-h-0 flex-1 overflow-auto pb-4" role="region" aria-label="Loading resources" aria-busy="true">
    <span className="sr-only" role="status">Loading resources...</span>
    <div className="rounded border border-gray-700">
      <table className="w-full min-w-[48rem] table-fixed text-left text-sm" aria-label="Resource list loading">
        <caption className="sr-only">Resources</caption>
        <thead className="sticky top-0 z-10 bg-gray-950 text-xs uppercase tracking-wide text-gray-400 shadow-sm shadow-black/20">
          <tr>
            <th scope="col" className="w-12 px-4 py-3"><div className="size-5 animate-pulse rounded border border-gray-700 bg-gray-800" /></th>
            <th scope="col" className="w-[34%] px-4 py-3">Name</th>
            <th scope="col" className="w-[10%] px-4 py-3">Type</th>
            <th scope="col" className="w-[12%] px-4 py-3">Size</th>
            <th scope="col" className="w-[16%] px-4 py-3">Updated</th>
            <th scope="col" className="w-[24%] px-4 py-3">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {Array.from({ length: 5 }, (_, index) => (
            <tr key={index} className="bg-gray-900/40">
              <td className="px-4 py-3"><div className="size-5 animate-pulse rounded border border-gray-700 bg-gray-800" /></td>
              <td className="max-w-0 px-4 py-3">
                <div className="flex w-full min-w-0 items-center gap-2">
                  <div className="size-4 shrink-0 animate-pulse rounded bg-gray-700" />
                  <div className={`h-4 animate-pulse rounded bg-gray-700 ${index % 2 ? "w-2/3" : "w-4/5"}`} />
                </div>
              </td>
              <td className="px-4 py-3"><div className="h-4 w-10 animate-pulse rounded bg-gray-800" /></td>
              <td className="px-4 py-3"><div className="h-4 w-12 animate-pulse rounded bg-gray-800" /></td>
              <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-800" /></td>
              <td className="max-w-0 px-4 py-3"><div className="h-4 w-3/4 animate-pulse rounded bg-gray-800" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default ResourcesPage;
