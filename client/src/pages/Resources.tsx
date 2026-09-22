import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Download,
  FileText,
  FolderOpen,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import AppWorkspaceShell from "../components/AppPageShell/AppWorkspaceShell";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  deleteChurchResource,
  deleteSongAudioWithRetry,
  getChurchResourceUrl,
  getSongAudioUrl,
  listChurchResources,
  updateChurchResource,
  uploadChurchResource,
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

type ResourceFilter = "all" | "document" | "audio";

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

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const ResourcePreview = ({
  churchId,
  entry,
  onClose,
  onRename,
  onDelete,
  canEdit,
}: {
  churchId: string;
  entry: ResourceLibraryEntry;
  onClose: () => void;
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
  return (
    <aside className="flex min-h-0 flex-col gap-3 border-t border-gray-700 bg-gray-950/50 p-4" aria-label="Resource details">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
            <>
              <h2 className="truncate text-base font-semibold text-white">{resourceEntryName(entry)}</h2>
          <p className="text-xs text-gray-400">
            {typeLabel(entry)} · {formatBytes(entry.source === "church-resource" ? entry.resource.storage.sizeBytes : entry.audio.sizeBytes)}
            {` · Updated ${formatDate(entryUpdatedAt(entry))}`}
            {entry.source === "song-audio" ? ` · Song attachment: ${entry.songName}` : " · Reusable church resource"}
          </p>
            </>
          )}
        </div>
        <Button type="button" variant="tertiary" svg={X} aria-label="Close resource details" onClick={onClose} />
      </div>

      {resource?.description ? <p className="text-sm text-gray-300">{resource.description}</p> : null}
      {loading ? <p className="text-sm text-gray-400" role="status">Opening resource…</p> : null}
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
        <Button type="button" variant="secondary" svg={Download} isLoading={downloading} disabled={loading || Boolean(error) || downloading || deleting} onClick={() => void download()}>Download</Button>
        {resource && canEdit ? <Button type="button" variant="tertiary" svg={Pencil} disabled={savingName || downloading || deleting} onClick={() => setEditingName(true)}>Rename</Button> : null}
        {canEdit ? <Button type="button" variant="destructive" svg={Trash2} isLoading={deleting} disabled={deleting || downloading || savingName} onClick={() => void deleteResource()}>{resourceEntryDeleteActionLabel(entry)}</Button> : null}
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<ChurchResource[]>([]);
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [churchResourcesLoading, setChurchResourcesLoading] = useState(true);
  const [songDocsLoading, setSongDocsLoading] = useState(true);
  const [churchResourcesError, setChurchResourcesError] = useState("");
  const [songDocsError, setSongDocsError] = useState("");
  const [uploading, setUploading] = useState(false);
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
  const selectedEntry = entries.find((entry) => entryKey(entry) === selectedKey) || null;
  const loading = churchResourcesLoading || songDocsLoading;
  const loadErrors = [churchResourcesError, songDocsError].filter(Boolean);

  const onUpload = async (file: File) => {
    if (!churchId) return;
    setUploading(true);
    setError("");
    try {
      const resource = await uploadChurchResource({ churchId, file });
      setResources((current) => [resource, ...current]);
      setSelectedKey(`resource:${resource.id}`);
    } catch (uploadError) {
      setError(errorMessage(uploadError, "The file could not be uploaded."));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const renameResource = async (resource: ChurchResource, name: string) => {
    if (!churchId) return;
    const result = await updateChurchResource({ churchId, resourceId: resource.id, name });
    setResources((current) => current.map((item) => item.id === resource.id ? result.resource : item));
  };

  const deleteEntry = async (entry: ResourceLibraryEntry) => {
    if (!churchId || !window.confirm(resourceEntryDeleteConfirmation(entry))) return;
    setError("");
    try {
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
      setSelectedKey(null);
    } catch (deleteError) {
      setError(errorMessage(deleteError, "The resource could not be deleted."));
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
              <div className="min-w-[14rem] flex-1"><Input label="Search resources" value={query} onChange={(value) => setQuery(String(value))} placeholder="Search…" /></div>
              {canEdit ? <>
                <input ref={inputRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUpload(file); }} />
                <Button type="button" variant="cta" svg={Upload} isLoading={uploading} disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading…" : "Upload"}</Button>
              </> : null}
            </div>
            <div className="flex flex-wrap gap-2 border-b border-gray-700 px-4 py-2" role="tablist" aria-label="Resource types">
              {(["all", "document", "audio"] as const).map((value) => (
                <Button key={value} type="button" variant="tertiary" isSelected={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "document" ? "Documents" : "Audio"}</Button>
              ))}
            </div>
            {loadErrors.map((loadError) => <div key={loadError} className="mx-4 mt-3 rounded border border-red-700/60 bg-red-950/20 p-3 text-sm text-red-200" role="alert">{loadError}</div>)}
            {error ? <div className="mx-4 mt-3 rounded border border-red-700/60 bg-red-950/20 p-3 text-sm text-red-200" role="alert">{error}</div> : null}
            {loading ? <p className="p-4 text-sm text-gray-400" role="status">Loading resources…</p> : null}
            {!loading && !loadErrors.length && !entries.length ? <div className="p-8 text-center text-sm text-gray-400"><FileText className="mx-auto mb-2 size-8 text-gray-600" aria-hidden />No resources match this view.</div> : null}
            {!loading && entries.length ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {entries.map((entry) => {
                    const key = entryKey(entry);
                    const selected = selectedKey === key;
                    return (
                      <button key={key} type="button" className={`flex min-w-0 cursor-pointer items-center gap-3 rounded border p-3 text-left transition-colors ${selected ? "border-cyan-400/60 bg-cyan-500/10" : "border-gray-700 bg-gray-900/70 hover:border-gray-500"}`} onClick={() => setSelectedKey(key)}>
                        {resourceEntryKind(entry) === "audio" ? <AudioLines className="size-5 shrink-0 text-amber-300" aria-hidden /> : <FileText className="size-5 shrink-0 text-cyan-300" aria-hidden />}
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-100">{resourceEntryName(entry)}</span><span className="block truncate text-xs text-gray-400">{typeLabel(entry)} · {formatBytes(entry.source === "church-resource" ? entry.resource.storage.sizeBytes : entry.audio.sizeBytes)} · Updated {formatDate(entryUpdatedAt(entry))}</span>{entry.source === "song-audio" ? <span className="block truncate text-xs text-amber-200">Song attachment · {entry.songName}</span> : <span className="block truncate text-xs text-gray-500">Reusable church resource</span>}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {selectedEntry && churchId ? <ResourcePreview churchId={churchId} entry={selectedEntry} onClose={() => setSelectedKey(null)} onRename={renameResource} onDelete={deleteEntry} canEdit={canEdit} /> : null}
          </>
        )}
      </section>
    </AppWorkspaceShell>
  );
};

export default ResourcesPage;
