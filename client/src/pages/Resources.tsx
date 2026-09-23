import { useContext, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  AudioLines,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import AppWorkspaceShell from "../components/AppPageShell/AppWorkspaceShell";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Input from "../components/Input/Input";
import Modal from "../components/Modal/Modal";
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
import {
  buildChurchResourceLibraryEntries,
  resourceEntryContentType,
  resourceEntryDeleteActionLabel,
  resourceEntryDeleteConfirmation,
  resourceEntryKind,
  resourceEntryName,
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

type ResourceFilter = "all" | "document" | "audio";
type ResourceSortKey = "name" | "type" | "size" | "updated" | "source";
type SortDirection = "asc" | "desc";

const formatBytes = (sizeBytes: number) => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString();
};

const entryUpdatedAt = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource"
    ? entry.resource.updatedAt || entry.resource.storage.uploadedAt
    : entry.audio.uploadedAt;

const typeLabel = (entry: ResourceLibraryEntry) => {
  const contentType = resourceEntryContentType(entry);
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "text/plain") return "TXT";
  if (contentType.includes("wordprocessingml") || contentType === "application/msword") return "DOCX";
  if (contentType.includes("presentationml") || contentType === "application/vnd.ms-powerpoint") return "PPTX";
  if (contentType.includes("spreadsheetml") || contentType === "application/vnd.ms-excel") return "XLSX";
  if (contentType === "audio/mpeg") return "MP3";
  return "FILE";
};

const entryKey = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource"
    ? `resource:${entry.resource.id}`
    : `song-audio:${entry.songId}:${entry.audio.id}`;

const entrySize = (entry: ResourceLibraryEntry) =>
  entry.source === "church-resource" ? entry.resource.storage.sizeBytes : entry.audio.sizeBytes;

const entrySource = (entry: ResourceLibraryEntry) =>
  entry.source === "song-audio" ? `Song attachment ${entry.songName}` : "Reusable church resource";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const ResourcePreview = ({
  churchId,
  entry,
  onRename,
  onDelete,
  canEdit,
}: {
  churchId: string;
  entry: ResourceLibraryEntry;
  onRename: (resource: ChurchResource, name: string) => Promise<void>;
  onDelete: (entry: ResourceLibraryEntry) => Promise<void>;
  canEdit: boolean;
}) => {
  const resource = entry.source === "church-resource" ? entry.resource : undefined;
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(resourceEntryName(entry));
  const [savingName, setSavingName] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNameDraft(resourceEntryName(entry));
    setEditingName(false);
    setUrl("");
    setText("");
    setError("");
    setLoading(true);
    setDownloading(false);
    setDeleting(false);
    if (resource?.deletionStatus === "deleting") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      try {
        const result =
          entry.source === "church-resource"
            ? await getChurchResourceUrl({
                churchId,
                resourceId: entry.resource.id,
              })
            : await getSongAudioUrl({
                churchId,
                songId: entry.songId,
                audio: entry.audio,
                disposition: "inline",
              });
        if (!active) return;
        setUrl(result.url);
        if (resource?.storage.contentType === "text/plain") {
          const response = await fetch(result.url, { signal: controller.signal });
          if (!response.ok) throw new Error("The text file could not be opened.");
          const content = await response.text();
          if (active) setText(content);
        }
      } catch (loadError) {
        if (active && (loadError as Error)?.name !== "AbortError") {
          setError(errorMessage(loadError, "This resource could not be opened."));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
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

  const contentType = resourceEntryContentType(entry);
  const deletionIncomplete = resource?.deletionStatus === "deleting";
  return (
    <aside className="flex min-h-0 flex-col gap-3 border-t border-gray-700 bg-gray-950/50 p-4" aria-label="Resource details">
      {editingName && resource ? (
        <div className="flex items-center gap-2">
          <Input
            label="Resource name"
            value={nameDraft}
            onChange={(value) => setNameDraft(String(value))}
            className="min-w-0 flex-1"
            autoFocus
          />
          <Button type="button" variant="cta" isLoading={savingName} disabled={savingName} onClick={() => void saveName()}>Save</Button>
          <Button type="button" variant="tertiary" aria-label="Cancel rename" svg={X} onClick={() => setEditingName(false)} />
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          {typeLabel(entry)} - {formatBytes(entry.source === "church-resource" ? entry.resource.storage.sizeBytes : entry.audio.sizeBytes)}
          {` - Updated ${formatDate(entryUpdatedAt(entry))}`}
          {entry.source === "song-audio" ? ` - Song attachment: ${entry.songName}` : " - Reusable church resource"}
        </p>
      )}
      {resource?.description ? <p className="text-sm text-gray-300">{resource.description}</p> : null}
      {deletionIncomplete ? <p className="text-sm text-amber-200" role="status">Deletion is still in progress. This resource is unavailable until deletion finishes.</p> : null}
      {loading ? <p className="text-sm text-gray-400" role="status">Opening resource...</p> : null}
      {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}

      {!loading && !error && contentType === "application/pdf" && url ? (
        <iframe title={resourceEntryName(entry)} src={url} className="h-[min(60vh,42rem)] w-full rounded border border-gray-700 bg-white" />
      ) : null}
      {!loading && !error && contentType === "text/plain" ? (
        <pre className="max-h-[min(60vh,42rem)] overflow-auto whitespace-pre-wrap rounded border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200">{text}</pre>
      ) : null}
      {!loading && !error && contentType === "audio/mpeg" && url ? (
        <audio controls className="w-full" src={url} aria-label={resourceEntryName(entry)} />
      ) : null}
      {!loading && !error && resource && !["application/pdf", "text/plain", "audio/mpeg"].includes(contentType) ? (
        <dl className="grid gap-x-4 gap-y-1 rounded border border-gray-700 bg-gray-900 p-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-gray-400">File</dt><dd className="truncate text-gray-100">{resource.storage.fileName}</dd>
          <dt className="text-gray-400">Type</dt><dd className="truncate text-gray-100">{resource.storage.contentType}</dd>
          <dt className="text-gray-400">Uploaded</dt><dd className="text-gray-100">{formatDate(resource.storage.uploadedAt)}</dd>
          <dt className="text-gray-400">Updated</dt><dd className="text-gray-100">{formatDate(resource.updatedAt)}</dd>
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" svg={Download} isLoading={downloading} disabled={loading || deletionIncomplete || Boolean(error) || downloading || deleting} onClick={() => void download()}>Download</Button>
        {resource && canEdit ? <Button type="button" variant="tertiary" svg={Pencil} disabled={deletionIncomplete || savingName || downloading || deleting} onClick={() => setEditingName(true)}>Rename</Button> : null}
        {canEdit && entry.source === "church-resource" ? <Button type="button" variant="destructive" svg={Trash2} isLoading={deleting} disabled={deleting || downloading || savingName} onClick={() => void deleteResource()}>{deletionIncomplete ? "Retry deletion" : resourceEntryDeleteActionLabel(entry)}</Button> : null}
      </div>
    </aside>
  );
};

const ResourcesPage = () => {
  const { churchId, churchName, access } = useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const scrollbarWidth = useSelector((state) => state.undoable.present.preferences.scrollbarWidth);
  const [resources, setResources] = useState<ChurchResource[]>([]);
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
        const text = `${resourceEntryName(entry)} ${entry.source === "song-audio" ? entry.songName : ""}`.toLowerCase();
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
      if (sortKey === "size") comparison = entrySize(left) - entrySize(right);
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
    if (!churchId || !candidates?.length) return;
    setDeleteCandidates(null);
    setDeletingKey("bulk");
    setError("");
    try {
      for (const entry of candidates) {
        if (entry.source === "church-resource") {
          await deleteChurchResource({ churchId, resourceId: entry.resource.id });
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
        }
      }
      setSelectedResourceKeys(new Set());
      setSelectedKey(null);
    } catch (deleteError) {
      const message = errorMessage(deleteError, "The resource could not be deleted.");
      setResources((current) => current.map((resource) =>
        candidates.some((entry) => entry.source === "church-resource" && entry.resource.id === resource.id)
          ? { ...resource, deletionStatus: "deleting", deletionError: message }
          : resource,
      ));
      setError(message);
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <AppWorkspaceShell title="Resources" mobileTitle="Resources" icon={FolderOpen} churchName={churchName} scrollbarWidth={scrollbarWidth}>
      <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden border border-gray-700 bg-gray-900/40">
        {!canBrowse ? (
          <div className="m-4 rounded border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-100" role="alert">Resource browsing is not available for this session.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 border-b border-gray-700 p-4">
              <div className="min-w-[14rem] flex-1"><Input label="Search resources" hideLabel value={query} onChange={(value) => setQuery(String(value))} placeholder="Search..." /></div>
              {selectedEntries.length ? <Button type="button" variant="destructive" svg={Trash2} onClick={requestDeleteSelected}>Delete selected ({selectedEntries.length})</Button> : null}
              {canEdit && churchId ? <ResourceUploadDialog churchId={churchId} onResourcesUploaded={(uploadedResources) => {
                setResources((current) => [...uploadedResources, ...current]);
                setRecentlyUploadedKeys(new Set(uploadedResources.map((resource) => `resource:${resource.id}`)));
              }} /> : null}
            </div>
            <div className="flex flex-wrap gap-2 border-b border-gray-700 px-4 py-2" role="tablist" aria-label="Resource types">
              {(["all", "document", "audio"] as const).map((value) => (
                <Button key={value} type="button" variant="tertiary" isSelected={filter === value} aria-pressed={filter === value} className={filter === value ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-transparent text-gray-300 hover:border-gray-500 hover:bg-gray-800"} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "document" ? "Documents" : "Audio"}</Button>
              ))}
            </div>
            {loadErrors.map((loadError) => <div key={loadError} className="mx-4 mt-3 rounded border border-red-700/60 bg-red-950/20 p-3 text-sm text-red-200" role="alert">{loadError}</div>)}
            {error ? <div className="mx-4 mt-3 rounded border border-red-700/60 bg-red-950/20 p-3 text-sm text-red-200" role="alert">{error}</div> : null}
            {loading ? <p className="p-4 text-sm text-gray-400" role="status">Loading resources...</p> : null}
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
                                {resourceEntryKind(entry) === "audio" ? <AudioLines className="size-4 shrink-0 text-amber-300" aria-hidden /> : <FileText className="size-4 shrink-0 text-cyan-300" aria-hidden />}
                                <span className="truncate font-semibold">{resourceEntryName(entry)}</span>
                                {recentlyUploaded ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-200"><CheckCircle2 className="size-3" aria-hidden />Uploaded</span> : null}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{typeLabel(entry)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{formatBytes(entry.source === "church-resource" ? entry.resource.storage.sizeBytes : entry.audio.sizeBytes)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{formatDate(entryUpdatedAt(entry))}</td>
                            <td className="max-w-0 px-4 py-3 text-gray-400"><span className="block truncate">{entry.source === "song-audio" ? `Song attachment - ${entry.songName}` : "Reusable church resource"}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {selectedEntry && churchId ? (
              <Modal isOpen onClose={() => setSelectedKey(null)} title={resourceEntryName(selectedEntry)} size="xl" contentPadding="p-0" description={`Preview of ${resourceEntryName(selectedEntry)}`}>
                <ResourcePreview churchId={churchId} entry={selectedEntry} onRename={renameResource} onDelete={requestDelete} canEdit={canEdit} />
              </Modal>
            ) : null}
            {deleteCandidates?.length ? (
              <Modal isOpen onClose={() => setDeleteCandidates(null)} title="Delete resource?" size="sm" zIndexLevel={2} description={`Confirm deletion of ${deleteCandidates.length} resource${deleteCandidates.length === 1 ? "" : "s"}`}>
                <div className="space-y-4">
                  <p className="text-sm text-gray-200">{deleteCandidates.length === 1 ? resourceEntryDeleteConfirmation(deleteCandidates[0]) : `Delete these ${deleteCandidates.length} resources?`}</p>
                  {deleteCandidates.length > 1 ? <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-gray-300">{deleteCandidates.map((entry) => <li key={entryKey(entry)}>{resourceEntryName(entry)}</li>)}</ul> : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setDeleteCandidates(null)} disabled={deletingKey !== null}>Cancel</Button>
                    <Button type="button" variant="destructive" svg={Trash2} isLoading={deletingKey !== null} disabled={deletingKey !== null} onClick={() => void confirmDelete()}>Delete</Button>
                  </div>
                </div>
              </Modal>
            ) : null}
          </>
        )}
      </section>
    </AppWorkspaceShell>
  );
};

export default ResourcesPage;
