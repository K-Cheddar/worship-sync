import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Download,
  BookOpen,
  Eye,
  ExternalLink,
  FilePlus,
  Files,
  FileText,
  Link as LinkIcon,
  Music,
  Pencil,
  Play,
  StickyNote,
  X,
} from "lucide-react";
import Button from "../../components/Button/Button";
import Icon from "../../components/Icon/Icon";
import ContentPreviewDialog from "../../components/ContentPreview/ContentPreviewDialog";
import Input from "../../components/Input/Input";
import RichTextEditor from "../../components/RichTextEditor/RichTextEditor";
import ServiceFlowRichText from "../../components/ServiceFlowRichText/ServiceFlowRichText";
import SongAudioPlayer from "../../components/SongAudioPlayer/SongAudioPlayer";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import ServicePlanCustomDocumentPicker from "./ServicePlanCustomDocumentPicker";
import ServicePlanCustomDocumentPreviewDialog from "./ServicePlanCustomDocumentPreviewDialog";
import ServicePlanScripturePopover from "./ServicePlanScripturePopover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { DBItem } from "../../types";
import { useSelector } from "../../hooks";
import { getChurchResource, getChurchResourceUrl, listChurchResources, getSongAudioUrl } from "../../api/auth";
import { openExternalUrl } from "../../utils/openExternalUrl";
import {
  getServicePlanElementContentResources,
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
  getServicePlanCustomDocumentId,
  type ServicePlanContentResource,
  type ServicePlanElement,
  type ServicePlanScriptureReference,
  type ServicePlanSongReference,
} from "../../types/servicePlan";
import { getServicePlanSongRefLabel } from "../../integrations/servicePlanning/formatSongTitleWithKey";
import {
  EMPTY_RICH_TEXT,
  isRichTextEmpty,
  richTextToPlainText,
  type RichTextDocument,
} from "../../types/richText";
import {
  createServicePlanAudioResource,
  createServicePlanCustomDocumentReference,
  createServicePlanChurchResourceReference,
  createServicePlanGenericResource,
  createServicePlanLinkResource,
  createServicePlanTextResource,
  getEffectiveServicePlanResourceDefinition,
  getServicePlanChurchResourceId,
  getServicePlanResourceDataString,
  getServicePlanResourceDisplayLabel,
  getServicePlanResourceTypeLabel,
  getServicePlanCustomDocumentDisplayLabel,
  getServicePlanResourceRichNotes,
  getServicePlanResourceText,
  isHttpUrl,
  normalizeServicePlanResourceForPreview,
  isServicePlanChurchResourceReference,
} from "./servicePlanResources";
import type { ChurchResource } from "../../types/churchResource";
import generateRandomId from "../../utils/generateRandomId";

type ResourceEditorMode = "url" | "text" | "generic";
const EMPTY_SERVICE_PLAN_RESOURCES: ServicePlanContentResource[] = [];

type ServicePlanContentPanelProps = {
  element: ServicePlanElement;
  allowEdit: boolean;
  onUpdate: (changes: Partial<ServicePlanElement>) => void | Promise<void>;
  onViewSongLyrics?: (songRef: ServicePlanSongReference) => void;
  onOpenSongDetails?: (songRef: ServicePlanSongReference) => void;
  onCreatePendingSong?: (songRef: Extract<ServicePlanSongReference, { kind: "pending" }>) => void;
  canCreateLibrarySong?: boolean;
  onScriptureAttachModeChange?: (active: boolean) => void;
  onResourceEditorModeChange?: (active: boolean) => void;
};

const resourceEditorLabel = (mode: ResourceEditorMode) =>
  mode === "url" ? "Web link" : mode === "text" ? "Notes" : "Other resource";

const ChurchResourceAudioPlayer = ({
  churchId,
  resourceId,
  fileName,
}: {
  churchId: string;
  resourceId: string;
  fileName: string;
}) => {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setUrl("");
    setError("");
    void getChurchResourceUrl({ churchId, resourceId })
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {
        if (active) setError("This MP3 could not be opened.");
      });
    return () => {
      active = false;
    };
  }, [churchId, resourceId]);

  if (error) return <p className="text-xs text-amber-200">{error}</p>;
  if (!url) return <p className="text-xs text-gray-400" role="status">Loading audio…</p>;
  return <audio controls className="min-w-[min(24rem,100%)]" src={url} aria-label={fileName} />;
};

const ServicePlanContentPanel = ({
  element,
  allowEdit,
  onUpdate,
  onViewSongLyrics,
  onOpenSongDetails,
  onCreatePendingSong,
  onScriptureAttachModeChange,
  onResourceEditorModeChange,
}: ServicePlanContentPanelProps) => {
  const { churchId } = useContext(GlobalInfoContext) || {};
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const allFreeFormDocs = useSelector((state) => state.allDocs.allFreeFormDocs);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customDocumentPickerOpen, setCustomDocumentPickerOpen] = useState(false);
  const [previewCustomDocument, setPreviewCustomDocument] = useState<DBItem | null>(null);
  const [scriptureEditIndex, setScriptureEditIndex] = useState<number | null>(null);
  const [scriptureAddOpen, setScriptureAddOpen] = useState(false);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [churchResourcePickerOpen, setChurchResourcePickerOpen] = useState(false);
  const [churchResourceSearch, setChurchResourceSearch] = useState("");
  const [churchResources, setChurchResources] = useState<ChurchResource[]>([]);
  const [referencedChurchResources, setReferencedChurchResources] = useState<Record<string, ChurchResource | null>>({});
  const [churchResourceLoading, setChurchResourceLoading] = useState(false);
  const [churchResourceError, setChurchResourceError] = useState("");
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [resourceEditorMode, setResourceEditorMode] = useState<ResourceEditorMode | null>(null);
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceText, setResourceText] = useState<RichTextDocument>(EMPTY_RICH_TEXT);
  const [resourceNotes, setResourceNotes] = useState<RichTextDocument>(EMPTY_RICH_TEXT);
  const [resourceError, setResourceError] = useState("");
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);
  const [previewResource, setPreviewResource] = useState<ReturnType<typeof normalizeServicePlanResourceForPreview> | null>(null);
  const churchResourcePickerRequestRef = useRef(0);
  const churchResourceReferenceRequestRef = useRef(0);
  const churchResourceCacheRef = useRef(new Map<string, ChurchResource | null>());
  const churchResourceCacheChurchIdRef = useRef<string | undefined>(churchId);

  useEffect(() => {
    setPickerOpen(false);
    setCustomDocumentPickerOpen(false);
    setScriptureEditIndex(null);
    setScriptureAddOpen(false);
    setAudioPickerOpen(false);
    setChurchResourcePickerOpen(false);
    setOpeningResourceId(null);
    resetResourceEditor();
    onScriptureAttachModeChange?.(false);
    // The selected element id is the lifecycle boundary for panel-local drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id]);

  useEffect(() => {
    setCustomDocumentPickerOpen(false);
  }, [churchId]);

  const songs = getServicePlanElementSongRefs(element);
  const scriptures = getServicePlanElementScriptureRefs(element);
  const persistedResources = element.resources ?? EMPTY_SERVICE_PLAN_RESOURCES;
  const displayResources = useMemo(
    () => getServicePlanElementContentResources(element),
    [element],
  );
  const resources = persistedResources;
  const customDocumentResources = displayResources.filter(
    (resource) => resource.type === "custom-document",
  );
  const otherResources = displayResources.filter(
    (resource) => !["song", "scripture", "custom-document"].includes(resource.type),
  );
  const attachedCustomDocumentIds = customDocumentResources
    .map(getServicePlanCustomDocumentId)
    .filter(Boolean);
  const referencedChurchResourceIds = useMemo(
    () => [
      ...new Set(
        displayResources
          .filter(isServicePlanChurchResourceReference)
          .map(getServicePlanChurchResourceId)
          .filter(Boolean),
      ),
    ],
    [displayResources],
  );
  const itemLabel = richTextToPlainText(element.title).trim() || "Untitled item";
  const audioSongs = useMemo(
    () => allSongDocs.filter((song) => Boolean(song.songAudio)),
    [allSongDocs],
  );
  const filteredChurchResources = useMemo(() => {
    const query = churchResourceSearch.trim().toLowerCase();
    if (!query) return churchResources;
    return churchResources.filter((resource) =>
      [resource.name, resource.storage.fileName]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [churchResourceSearch, churchResources]);
  const updateContent = (changes: Partial<ServicePlanElement>) => {
    return onUpdate(changes);
  };
  const moveAttachment = (resourceId: string, direction: -1 | 1) => {
    const ordered = [...displayResources];
    const index = ordered.findIndex((resource) => resource.id === resourceId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= ordered.length) return;
    [ordered[index], ordered[destination]] = [ordered[destination], ordered[index]];
    updateContent({ contentOrder: ordered.map((resource) => resource.id) });
  };
  const updateSongs = (next: ServicePlanSongReference[]) =>
    updateContent({
      songRef: undefined,
      songRefs: next.map((songRef) => songRef.id ? songRef : { ...songRef, id: generateRandomId() }),
    });
  const updateScriptures = (next: ServicePlanScriptureReference[]) =>
    updateContent({
      scriptureRef: undefined,
      scriptureRefs: next.map((scriptureRef) => scriptureRef.id ? scriptureRef : { ...scriptureRef, id: generateRandomId() }),
    });
  const updateResources = (next: ServicePlanContentResource[]) => updateContent({ resources: next });

  const loadChurchResources = async () => {
    const requestId = ++churchResourcePickerRequestRef.current;
    if (!churchId) {
      setChurchResourceError("Sign in to choose a file.");
      setChurchResourceLoading(false);
      return;
    }
    setChurchResourceLoading(true);
    setChurchResourceError("");
    try {
      const result = await listChurchResources(churchId);
      if (requestId !== churchResourcePickerRequestRef.current) return;
      setChurchResources(result.resources);
    } catch (error) {
      if (requestId !== churchResourcePickerRequestRef.current) return;
      setChurchResourceError(
        error instanceof Error
          ? error.message
          : "Files could not be loaded.",
      );
    } finally {
      if (requestId === churchResourcePickerRequestRef.current) {
        setChurchResourceLoading(false);
      }
    }
  };

  useEffect(() => {
    const requestId = ++churchResourceReferenceRequestRef.current;
    if (churchResourceCacheChurchIdRef.current !== churchId) {
      churchResourceCacheChurchIdRef.current = churchId;
      churchResourceCacheRef.current.clear();
      setReferencedChurchResources({});
    }
    if (!churchId || !referencedChurchResourceIds.length) {
      churchResourceCacheRef.current.clear();
      setReferencedChurchResources({});
      setChurchResourceLoading(false);
      setChurchResourceError("");
      return;
    }

    const cached = Object.fromEntries(
      referencedChurchResourceIds
        .filter((id) => churchResourceCacheRef.current.has(id))
        .map((id) => [id, churchResourceCacheRef.current.get(id) || null]),
    );
    if (Object.keys(cached).length) {
      setReferencedChurchResources(cached);
    }
    const missingIds = referencedChurchResourceIds.filter(
      (id) => !churchResourceCacheRef.current.has(id),
    );
    if (!missingIds.length) {
      setChurchResourceLoading(false);
      setChurchResourceError("");
      return;
    }

    setChurchResourceLoading(true);
    setChurchResourceError("");
    void Promise.all(
      missingIds.map(async (resourceId) => {
        try {
          return [resourceId, (await getChurchResource(churchId, resourceId)).resource] as const;
        } catch (error) {
          if ((error as { status?: number })?.status === 404) {
            return [resourceId, null] as const;
          }
          throw error;
        }
      }),
    )
      .then((results) => {
        if (requestId !== churchResourceReferenceRequestRef.current) return;
        results.forEach(([resourceId, resource]) => {
          churchResourceCacheRef.current.set(resourceId, resource);
        });
        setReferencedChurchResources(
          Object.fromEntries(
            referencedChurchResourceIds.map((resourceId) => [
              resourceId,
              churchResourceCacheRef.current.get(resourceId) || null,
            ]),
          ),
        );
      })
      .catch((error) => {
        if (requestId !== churchResourceReferenceRequestRef.current) return;
        setChurchResourceError(
          error instanceof Error
            ? error.message
            : "Files could not be loaded.",
        );
      })
      .finally(() => {
        if (requestId === churchResourceReferenceRequestRef.current) {
          setChurchResourceLoading(false);
        }
      });
  }, [churchId, referencedChurchResourceIds]);

  const resetResourceEditor = () => {
    onResourceEditorModeChange?.(false);
    setEditingResourceId(null);
    setResourceEditorMode(null);
    setResourceTitle("");
    setResourceUrl("");
    setResourceText(EMPTY_RICH_TEXT);
    setResourceNotes(EMPTY_RICH_TEXT);
    setResourceError("");
  };

  const openResourceEditor = (
    mode: ResourceEditorMode,
    resource?: ServicePlanContentResource,
  ) => {
    onResourceEditorModeChange?.(true);
    setEditingResourceId(resource?.id || null);
    setResourceEditorMode(mode);
    setResourceTitle(resource?.title || "");
    setResourceUrl(resource?.url || "");
    setResourceText(resource ? getServicePlanResourceText(resource) : EMPTY_RICH_TEXT);
    setResourceNotes(resource ? getServicePlanResourceRichNotes(resource) : EMPTY_RICH_TEXT);
    setResourceError("");
  };

  const saveResource = () => {
    if (!resourceEditorMode) return;
    const title = resourceTitle.trim();
    const url = resourceUrl.trim();
    if ((resourceEditorMode === "url" && !isHttpUrl(url)) ||
      (resourceEditorMode === "generic" && url && !isHttpUrl(url))) {
      setResourceError("Enter a valid http or https URL.");
      return;
    }
    if (resourceEditorMode === "text" && isRichTextEmpty(resourceText)) {
      setResourceError("Add a note before saving.");
      return;
    }
    const nextResource = resourceEditorMode === "url"
      ? createServicePlanLinkResource({ title, url })
      : resourceEditorMode === "text"
        ? createServicePlanTextResource({ title, text: resourceText })
        : createServicePlanGenericResource({ title, notes: resourceNotes, url });
    const savedResource = editingResourceId
      ? { ...nextResource, id: editingResourceId }
      : nextResource;
    updateResources(editingResourceId
      ? resources.map((resource) => resource.id === editingResourceId ? savedResource : resource)
      : [...resources, savedResource]);
    resetResourceEditor();
  };

  const openExternalResource = async (resource: ServicePlanContentResource) => {
    if (!resource.url) return;
    setOpeningResourceId(resource.id);
    try {
      await openExternalUrl(resource.url, { allowArbitraryHttps: true });
    } finally {
      setOpeningResourceId(null);
    }
  };

  const openResourcePreview = (
    resource: ServicePlanContentResource,
    churchResource?: ChurchResource,
  ) => {
    const resourceId = getServicePlanChurchResourceId(resource);
    const songId = getServicePlanResourceDataString(resource, "songId");
    const audioId = getServicePlanResourceDataString(resource, "audioId");
    const song = allSongDocs.find((candidate) => candidate._id === songId);
    const audio = song?.songAudio?.id === audioId ? song.songAudio : undefined;
    const resolveSource = churchId && resourceId
      ? async () => {
          const result = await getChurchResourceUrl({ churchId, resourceId });
          return {
            url: result.url,
            mimeType: churchResource?.storage.contentType,
            fileName: churchResource?.storage.fileName,
          };
        }
      : churchId && songId && audio
        ? async () => {
            const result = await getSongAudioUrl({
              churchId,
              songId,
              audio,
              disposition: "inline",
            });
            return {
              url: result.url,
              mimeType: audio.contentType,
              fileName: audio.fileName,
            };
          }
        : undefined;
    setPreviewResource(
      normalizeServicePlanResourceForPreview(resource, {
        churchResource,
        ...(resolveSource ? { resolveSource } : {}),
      }),
    );
  };

  const openChurchResourcePreview = (resource: ChurchResource) => {
    const reference = createServicePlanChurchResourceReference({ resourceId: resource.id });
    setPreviewResource(
      normalizeServicePlanResourceForPreview(reference, {
        churchResource: resource,
        resolveSource: async () => {
          const result = await getChurchResourceUrl({
            churchId: resource.churchId,
            resourceId: resource.id,
            disposition: "inline",
          });
          return {
            url: result.url,
            mimeType: resource.storage.contentType,
            fileName: resource.storage.fileName,
          };
        },
      }),
    );
  };

  const renderResourceBody = (resource: ServicePlanContentResource) => {
    if (resource.type === "youtube") {
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="tertiary"
            svg={Play}
            className="max-md:min-h-0"
            onClick={() => openResourcePreview(resource)}
          >
            Play
          </Button>
          {resource.url ? (
            <Button
              type="button"
              variant="tertiary"
              svg={ExternalLink}
              className="max-md:min-h-0"
              disabled={openingResourceId === resource.id}
              isLoading={openingResourceId === resource.id}
              onClick={() => void openExternalResource(resource)}
            >
              Open
            </Button>
          ) : null}
        </div>
      );
    }
    if (resource.type === "audio") {
      const songId = getServicePlanResourceDataString(resource, "songId");
      const audioId = getServicePlanResourceDataString(resource, "audioId");
      const song = allSongDocs.find((candidate) => candidate._id === songId);
      const audio = song?.songAudio?.id === audioId ? song.songAudio : undefined;
      if (!song || !audio || !churchId) {
        return <p className="text-xs text-amber-200">This MP3 is no longer available in the song library.</p>;
      }
      const selectedSong = song;
      return (
        <SongAudioPlayer
          audio={audio}
          compact
          showFileDetails={false}
          onGetUrl={async (disposition) => {
            const result = await getSongAudioUrl({ churchId, songId: selectedSong._id, audio, disposition });
            return result.url;
          }}
        />
      );
    }
    if (isServicePlanChurchResourceReference(resource)) {
      const resourceId = getServicePlanChurchResourceId(resource);
      const churchResource = referencedChurchResources[resourceId];
      const openChurchResource = async (disposition: "inline" | "attachment") => {
        if (!churchId || !resourceId) return;
        setOpeningResourceId(resource.id);
        try {
          const result = await getChurchResourceUrl({
            churchId,
            resourceId,
            disposition,
          });
          await openExternalUrl(result.url, { allowArbitraryHttps: true });
        } finally {
          setOpeningResourceId(null);
        }
      };
      if (churchResource?.kind === "audio") {
        return (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-xs text-gray-400">
              {churchResource.name}
            </span>
            <ChurchResourceAudioPlayer
              churchId={churchId || ""}
              resourceId={resourceId}
              fileName={churchResource.storage.fileName}
            />
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-xs text-gray-400">
            {churchResource?.name || resource.title}
          </span>
          <Button
            type="button"
            variant="tertiary"
            svg={ExternalLink}
            className="max-md:min-h-0"
            disabled={!churchResource || openingResourceId === resource.id}
            isLoading={openingResourceId === resource.id}
            onClick={() => void openChurchResource("inline")}
          >
            Open
          </Button>
          <Button
            type="button"
            variant="tertiary"
            svg={Download}
            className="max-md:min-h-0"
            disabled={!churchResource || openingResourceId === resource.id}
            onClick={() => void openChurchResource("attachment")}
          >
            Download
          </Button>
          {!churchResource && !churchResourceLoading ? (
            <span className="text-xs text-amber-200">This file is unavailable.</span>
          ) : null}
        </div>
      );
    }
    if (resource.type === "text") {
      return (
        <ServiceFlowRichText
          document={getServicePlanResourceText(resource)}
          className="text-gray-200"
        />
      );
    }
    if (resource.type === "generic" || !SERVICE_PLAN_RESOURCE_TYPES.has(resource.type)) {
      const notes = getServicePlanResourceRichNotes(resource);
      return !isRichTextEmpty(notes) ? (
        <ServiceFlowRichText document={notes} className="text-gray-300" />
      ) : null;
    }
    return null;
  };

  const activeScripture = scriptureEditIndex == null ? undefined : scriptures[scriptureEditIndex];
  if (scriptureAddOpen || activeScripture) {
    const isEditingScripture = Boolean(activeScripture);
    return (
      <div className="flex h-full min-h-0 flex-col gap-4" aria-label="Scripture editor">
        <Button type="button" variant="tertiary" svg={ArrowLeft} padding="p-0" className="min-h-0 max-md:min-h-0 w-fit cursor-pointer" onClick={() => { setScriptureAddOpen(false); setScriptureEditIndex(null); onScriptureAttachModeChange?.(false); }}>
          Back to content
        </Button>
        <ServicePlanScripturePopover
          inline
          open
          onOpenChange={(open) => { if (!open) { setScriptureAddOpen(false); setScriptureEditIndex(null); onScriptureAttachModeChange?.(false); } }}
          initialScriptureRef={activeScripture}
          anchor={<div aria-hidden className="h-px w-full" />}
          onSelect={async (scripture) => {
            await updateScriptures(isEditingScripture
              ? scriptures.map((current, index) => index === scriptureEditIndex ? scripture : current)
              : [...scriptures, scripture]);
            setScriptureAddOpen(false);
            setScriptureEditIndex(null);
            onScriptureAttachModeChange?.(false);
          }}
        />
      </div>
    );
  }

  if (resourceEditorMode) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4" aria-label={`${resourceEditorLabel(resourceEditorMode)} editor`}>
        <Button type="button" variant="tertiary" svg={ArrowLeft} padding="p-0" className="min-h-0 max-md:min-h-0 w-fit cursor-pointer" onClick={resetResourceEditor}>
          Back to content
        </Button>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-100">{resourceEditorLabel(resourceEditorMode)}</h3>
          <Input label="Title" value={resourceTitle} onChange={(value) => setResourceTitle(String(value))} autoFocus />
          {resourceEditorMode !== "text" ? (
            <Input label="URL (optional)" value={resourceUrl} onChange={(value) => setResourceUrl(String(value))} placeholder="https://…" />
          ) : null}
          {resourceEditorMode === "text" ? (
            <RichTextEditor
              label="Notes"
              value={resourceText}
              onChange={setResourceText}
              placeholder="Notes for this item (optional)"
            />
          ) : (
            <RichTextEditor
              label="Notes (optional)"
              value={resourceNotes}
              onChange={setResourceNotes}
              placeholder="Notes about this resource (optional)"
            />
          )}
          {resourceError ? <p className="text-sm text-red-300" role="alert">{resourceError}</p> : null}
          <Button variant="cta" className="w-full cursor-pointer justify-center" onClick={saveResource}>
            {editingResourceId ? "Save resource" : "Add resource"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label={`Content for ${itemLabel}`}>
      {allowEdit && displayResources.length > 1 ? (
        <section className="space-y-2" aria-label="Presentation attachment order">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Presentation order</h3>
          <ol className="space-y-1">
            {displayResources.map((resource, index) => (
              <li key={resource.id} className="flex min-w-0 items-center gap-2 rounded-md border border-gray-700 bg-gray-900/70 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-xs text-gray-200">{getServicePlanResourceTypeLabel(resource.type)}: {getServicePlanResourceDisplayLabel(resource)}</span>
                <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-6 w-6" svg={ArrowUp} aria-label={`Move ${resource.title} earlier`} disabled={index === 0} onClick={() => moveAttachment(resource.id, -1)} />
                <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-6 w-6" svg={ArrowDown} aria-label={`Move ${resource.title} later`} disabled={index === displayResources.length - 1} onClick={() => moveAttachment(resource.id, 1)} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Songs</h3>
        {songs.length ? songs.map((song, index) => {
          const label = getServicePlanSongRefLabel(song);
          return (
            <div key={`${song.kind}:${label}:${index}`} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/70 px-2 py-1.5">
              <Icon svg={Music} size="xs" className="shrink-0 text-cyan-300" />
              <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-gray-100 hover:text-cyan-100" onClick={() => {
                if (song.kind === "pending" && onCreatePendingSong) { onCreatePendingSong(song); return; }
                (onOpenSongDetails || onViewSongLyrics)?.(song);
              }} disabled={song.kind === "pending" ? !onCreatePendingSong && !onViewSongLyrics : !onViewSongLyrics && !onOpenSongDetails}>{label}</button>
              {song.kind === "pending" ? <span className="text-xs text-amber-200">Not in library</span> : null}
              {allowEdit ? <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-5 w-5" svg={X} aria-label={`Remove song ${label}`} onClick={() => updateSongs(songs.filter((_, current) => current !== index))} /> : null}
            </div>
          );
        }) : <p className="text-sm text-gray-500">No song attached.</p>}
        {allowEdit ? <Button type="button" variant="primary" svg={Music} color="#67e8f9" iconSize="sm" className="max-md:min-h-0" onClick={() => setPickerOpen(true)}>Add song</Button> : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scripture</h3>
        {scriptures.length ? scriptures.map((scripture, index) => (
          <div key={`${scripture.label}:${index}`} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/70 px-2 py-1.5">
            {allowEdit ? <Button type="button" variant="tertiary" className="min-w-0 flex-1 cursor-pointer justify-start p-0 text-sm text-gray-100 hover:text-violet-100" onClick={() => { setScriptureAddOpen(false); setScriptureEditIndex(index); onScriptureAttachModeChange?.(false); }}><Icon svg={BookOpen} size="xs" className="shrink-0 text-violet-300" /><span className="truncate">{scripture.label}</span></Button> : <><Icon svg={BookOpen} size="xs" className="shrink-0 text-violet-300" /><span className="truncate text-sm text-gray-100">{scripture.label}</span></>}
            {allowEdit ? <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-5 w-5" svg={X} aria-label={`Remove scripture ${scripture.label}`} onClick={() => updateScriptures(scriptures.filter((_, current) => current !== index))} /> : null}
          </div>
        )) : <p className="text-sm text-gray-500">No scripture attached.</p>}
        {allowEdit ? <Button type="button" variant="primary" svg={BookOpen} color="#c4b5fd" iconSize="sm" className="max-md:min-h-0" onClick={() => { setScriptureAddOpen(true); onScriptureAttachModeChange?.(true); }}>Add scripture</Button> : null}
      </section>

      <section className="space-y-2" aria-label="Attached custom documents">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Custom Documents</h3>
        {customDocumentResources.length ? customDocumentResources.map((resource) => {
          const documentId = getServicePlanCustomDocumentId(resource);
          const document = allFreeFormDocs.find((candidate) => candidate._id === documentId);
          const label = getServicePlanCustomDocumentDisplayLabel(resource, document);
          return (
            <div key={resource.id} className="flex min-w-0 items-center gap-2 rounded-md border border-gray-700 bg-gray-900/70 px-2 py-1.5">
              <Icon svg={Files} size="xs" className="shrink-0 text-indigo-300" />
              {document ? (
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-gray-100 hover:text-indigo-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300"
                  title={label}
                  aria-label={`Preview custom document ${label}`}
                  onClick={() => setPreviewCustomDocument(document)}
                >
                  {label}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-gray-100" title={label}>{label}</span>
              )}
              {!document ? <span className="shrink-0 text-xs text-amber-200">Unavailable</span> : null}
              {allowEdit ? <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-5 w-5" svg={X} aria-label={`Remove custom document ${label}`} onClick={() => updateResources(resources.filter((candidate) => candidate.id !== resource.id))} /> : null}
            </div>
          );
        }) : <p className="text-sm text-gray-500">No custom documents attached.</p>}
        {allowEdit ? <Button type="button" variant="primary" svg={Files} color="#c4b5fd" iconSize="sm" className="max-md:min-h-0" onClick={() => setCustomDocumentPickerOpen(true)}>Add custom document</Button> : null}
      </section>

      <section className="space-y-2" aria-label="Attached resources">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Resources</h3>
        {otherResources.length ? otherResources.map((resource) => {
          const churchResource = isServicePlanChurchResourceReference(resource)
            ? referencedChurchResources[getServicePlanChurchResourceId(resource)]
            : undefined;
          const definition = getEffectiveServicePlanResourceDefinition(resource, churchResource || undefined);
          const ResourceIcon = definition.icon;
          const displayTitle = getServicePlanResourceDisplayLabel(resource, churchResource || undefined);
          const isEditable = allowEdit && definition.canEdit &&
            (resource.type === "url" || resource.type === "text" || resource.type === "generic");
          const canPreviewResource = Boolean(resource.url) || !allowEdit;
          return (
            <article key={resource.id} className="rounded-md border border-gray-700 bg-gray-900/70 px-2 py-2">
              <div className="flex min-w-0 items-start gap-2">
                <ResourceIcon className={`mt-0.5 size-4 shrink-0 ${definition.toneClassName}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  {!canPreviewResource ? (
                    <p className="truncate text-sm text-gray-100" title={displayTitle}>{displayTitle}</p>
                  ) : (
                  <button
                      type="button"
                      className="block w-full min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-cyan-100 hover:text-cyan-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
                      title={displayTitle}
                      aria-label={`Preview ${displayTitle}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openResourcePreview(resource, churchResource || undefined);
                      }}
                    >
                      {displayTitle}
                    </button>
                  )}
                  <p className="text-xs text-gray-400">{definition.label}</p>
                </div>
                {isEditable ? <Button type="button" variant="tertiary" iconSize="sm" padding="p-0" className="h-8 w-8 min-h-0 justify-center max-md:min-h-0" svg={Pencil} aria-label={`Edit resource ${resource.title}`} onClick={() => openResourceEditor(resource.type === "text" ? "text" : resource.type === "url" ? "url" : "generic", resource)} /> : null}
                {allowEdit ? <Button type="button" variant="tertiary" iconSize="sm" padding="p-0" className="h-8 w-8 min-h-0 justify-center max-md:min-h-0" svg={X} aria-label={`Remove resource ${resource.title}`} onClick={() => updateResources(resources.filter((candidate) => candidate.id !== resource.id))} /> : null}
              </div>
              <div className="mt-2 pl-6">{renderResourceBody(resource)}</div>
            </article>
          );
        }) : <p className="text-sm text-gray-500">No additional resources attached.</p>}
        {allowEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="primary" svg={FilePlus} color="#d1d5db" className="max-md:min-h-0">Add resource</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={() => setAudioPickerOpen(true)}><AudioLines className="size-4 text-amber-300" aria-hidden />Media / MP3</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setChurchResourceSearch(""); setChurchResourcePickerOpen(true); void loadChurchResources(); }}><FileText className="size-4 text-cyan-300" aria-hidden />File</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openResourceEditor("url")}><LinkIcon className="size-4 text-blue-300" aria-hidden />Link</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openResourceEditor("text")}><StickyNote className="size-4 text-emerald-300" aria-hidden />Text / Notes</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </section>

      {pickerOpen ? <ServicePlanLibraryPicker isOpen onClose={() => setPickerOpen(false)} onSelectSong={(song) => { updateSongs([...songs, song]); setPickerOpen(false); }} /> : null}
      {customDocumentPickerOpen ? (
        <ServicePlanCustomDocumentPicker
          isOpen
          onClose={() => setCustomDocumentPickerOpen(false)}
          attachedDocumentIds={attachedCustomDocumentIds}
          onSelectDocument={(document) => {
            const documentId = document._id;
            if (!documentId || attachedCustomDocumentIds.includes(documentId)) return;
            updateResources([
              ...resources,
              createServicePlanCustomDocumentReference({
                documentId,
                title: document.name,
              }),
            ]);
          }}
        />
      ) : null}
      {audioPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label="Choose media">
          <div className="max-h-[min(32rem,calc(100vh-2rem))] w-[min(30rem,100%)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">Choose an MP3</h3><Button type="button" variant="tertiary" iconSize="sm" svg={X} aria-label="Close media picker" onClick={() => setAudioPickerOpen(false)} /></div>
            {audioSongs.length ? <div className="space-y-1">{audioSongs.map((song) => {
              const audio = song.songAudio!;
              const alreadyAttached = resources.some((resource) => resource.type === "audio" && resource.mediaId === audio.id);
              return <Button key={`${song._id}:${audio.id}`} type="button" variant="tertiary" className="w-full justify-start" disabled={alreadyAttached} onClick={() => { updateResources([...resources, createServicePlanAudioResource({ title: audio.fileName, songId: song._id, audioId: audio.id })]); setAudioPickerOpen(false); }}><AudioLines className="size-4 shrink-0 text-amber-300" aria-hidden /><span className="truncate">{audio.fileName}</span><span className="ml-auto text-xs text-gray-500">{song.name}</span></Button>;
            })}</div> : <p className="text-sm text-gray-400">No MP3s are available in the song library yet.</p>}
          </div>
        </div>
      ) : null}
      {churchResourcePickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label="Choose a file">
          <div className="max-h-[min(32rem,calc(100vh-2rem))] w-[min(30rem,100%)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">Choose a file</h3><Button type="button" variant="tertiary" iconSize="sm" svg={X} aria-label="Close file picker" onClick={() => { setChurchResourcePickerOpen(false); setChurchResourceSearch(""); }} /></div>
            <Input
              label="Search files"
              hideLabel
              value={churchResourceSearch}
              onChange={(value) => setChurchResourceSearch(String(value))}
              placeholder="Search files..."
              aria-label="Search files"
              autoFocus
              className="mb-3"
              inputClassName="bg-gray-950"
            />
            {churchResourceLoading ? <p className="text-sm text-gray-400" role="status">Loading resources…</p> : null}
            {churchResourceError ? <p className="text-sm text-red-300" role="alert">{churchResourceError}</p> : null}
            {!churchResourceLoading && !churchResourceError && filteredChurchResources.length ? <div className="space-y-1">{filteredChurchResources.map((resource) => {
              const alreadyAttached = resources.some((candidate) => getServicePlanChurchResourceId(candidate) === resource.id);
              const ResourceIcon = resource.kind === "audio" ? AudioLines : FileText;
              return (
                <div key={resource.id} className="flex min-w-0 items-center gap-1 rounded-md border border-gray-800 bg-gray-950/50 px-1">
                  <Button type="button" variant="tertiary" className="min-w-0 flex-1 justify-start" disabled={alreadyAttached} onClick={() => { updateResources([...resources, createServicePlanChurchResourceReference({ resourceId: resource.id })]); setChurchResourcePickerOpen(false); }}><ResourceIcon className={`size-4 shrink-0 ${resource.kind === "audio" ? "text-amber-300" : "text-cyan-300"}`} aria-hidden /><span className="truncate">{resource.name}</span><span className="ml-auto truncate text-xs text-gray-500">{resource.storage.fileName}</span></Button>
                  <Button type="button" variant="tertiary" svg={Eye} iconSize="sm" padding="p-1" className="shrink-0" aria-label={`Preview file ${resource.name}`} onClick={() => openChurchResourcePreview(resource)} />
                </div>
              );
            })}</div> : null}
            {!churchResourceLoading && !churchResourceError && !filteredChurchResources.length ? <p className="text-sm text-gray-400">{churchResources.length ? "No files match your search." : "No files are available yet."}</p> : null}
          </div>
        </div>
      ) : null}
      <ContentPreviewDialog
        resource={previewResource}
        onClose={() => setPreviewResource(null)}
      />
      <ServicePlanCustomDocumentPreviewDialog
        document={previewCustomDocument}
        onClose={() => setPreviewCustomDocument(null)}
      />
    </div>
  );
};

const SERVICE_PLAN_RESOURCE_TYPES = new Set([
  "song",
  "scripture",
  "youtube",
  "audio",
  "document",
  "url",
  "text",
  "generic",
]);

export default ServicePlanContentPanel;
