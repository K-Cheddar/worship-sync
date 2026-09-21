import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Download,
  BookOpen,
  ExternalLink,
  FilePlus,
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
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";
import SongAudioPlayer from "../../components/SongAudioPlayer/SongAudioPlayer";
import YouTubePlaylistPlayer from "../../components/YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import type { YouTubePlaylistEntry } from "../../components/YouTubePlaylistPlayer/youtubePlaylist";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import ServicePlanScripturePopover from "./ServicePlanScripturePopover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useSelector } from "../../hooks";
import { getSongAudioUrl } from "../../api/auth";
import { getChurchResourceUrl, listChurchResources } from "../../api/auth";
import { isElectron } from "../../utils/environment";
import {
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
  type ServicePlanContentResource,
  type ServicePlanElement,
  type ServicePlanScriptureReference,
  type ServicePlanSongReference,
} from "../../types/servicePlan";
import { getServicePlanSongRefLabel } from "../../integrations/servicePlanning/formatSongTitleWithKey";
import { richTextToPlainText } from "../../types/richText";
import {
  createServicePlanAudioResource,
  createServicePlanDocumentResource,
  createServicePlanGenericResource,
  createServicePlanLinkResource,
  createServicePlanTextResource,
  getServicePlanResourceDataString,
  getServicePlanResourceDefinition,
  getServicePlanResourceNotes,
  isHttpUrl,
} from "./servicePlanResources";
import type { ChurchResource } from "../../types/churchResource";

type ResourceEditorMode = "url" | "text" | "generic";

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scriptureEditIndex, setScriptureEditIndex] = useState<number | null>(null);
  const [scriptureAddOpen, setScriptureAddOpen] = useState(false);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [churchResourcePickerOpen, setChurchResourcePickerOpen] = useState(false);
  const [churchResources, setChurchResources] = useState<ChurchResource[]>([]);
  const [churchResourceLoading, setChurchResourceLoading] = useState(false);
  const [churchResourceError, setChurchResourceError] = useState("");
  const [activeYouTubeResourceId, setActiveYouTubeResourceId] = useState<string | null>(null);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [resourceEditorMode, setResourceEditorMode] = useState<ResourceEditorMode | null>(null);
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceText, setResourceText] = useState("");
  const [resourceNotes, setResourceNotes] = useState("");
  const [resourceError, setResourceError] = useState("");
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);
  const churchResourceRequestRef = useRef(0);

  useEffect(() => {
    setPickerOpen(false);
    setScriptureEditIndex(null);
    setScriptureAddOpen(false);
    setAudioPickerOpen(false);
    setChurchResourcePickerOpen(false);
    setActiveYouTubeResourceId(null);
    setOpeningResourceId(null);
    resetResourceEditor();
    onScriptureAttachModeChange?.(false);
    // The selected element id is the lifecycle boundary for panel-local drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id]);

  const songs = getServicePlanElementSongRefs(element);
  const scriptures = getServicePlanElementScriptureRefs(element);
  const resources = element.resources || [];
  const hasChurchResourceReference = resources.some(
    (resource) => resource.type === "document",
  );
  const itemLabel = richTextToPlainText(element.title).trim() || "Untitled item";
  const audioSongs = useMemo(
    () => allSongDocs.filter((song) => Boolean(song.songAudio)),
    [allSongDocs],
  );
  const activeYouTubeResource = resources.find(
    (resource) => resource.id === activeYouTubeResourceId && resource.type === "youtube",
  );
  const activeYouTubeQueue = useMemo<YouTubePlaylistEntry[]>(() => {
    if (!activeYouTubeResource?.mediaId) return [];
    return [{
      entryKey: activeYouTubeResource.id,
      songId: activeYouTubeResource.id,
      title: activeYouTubeResource.title,
      artist: "",
      videoId: activeYouTubeResource.mediaId,
    }];
  }, [activeYouTubeResource]);

  const updateSongs = (next: ServicePlanSongReference[]) =>
    onUpdate({ songRef: undefined, songRefs: next });
  const updateScriptures = (next: ServicePlanScriptureReference[]) =>
    onUpdate({ scriptureRef: undefined, scriptureRefs: next });
  const updateResources = (next: ServicePlanContentResource[]) =>
    onUpdate({ resources: next });

  const loadChurchResources = async () => {
    const requestId = ++churchResourceRequestRef.current;
    if (!churchId) {
      setChurchResourceError("Sign in to choose a church resource.");
      setChurchResourceLoading(false);
      return;
    }
    setChurchResourceLoading(true);
    setChurchResourceError("");
    try {
      const result = await listChurchResources(churchId);
      if (requestId !== churchResourceRequestRef.current) return;
      setChurchResources(result.resources);
    } catch (error) {
      if (requestId !== churchResourceRequestRef.current) return;
      setChurchResourceError(
        error instanceof Error
          ? error.message
          : "Church resources could not be loaded.",
      );
    } finally {
      if (requestId === churchResourceRequestRef.current) {
        setChurchResourceLoading(false);
      }
    }
  };

  useEffect(() => {
    if (hasChurchResourceReference) {
      void loadChurchResources();
    } else {
      churchResourceRequestRef.current += 1;
      setChurchResources([]);
      setChurchResourceLoading(false);
      setChurchResourceError("");
    }
    // The element id effect above owns draft reset; this load follows the
    // persisted reference and is intentionally independent of edit mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId, hasChurchResourceReference]);

  const resetResourceEditor = () => {
    onResourceEditorModeChange?.(false);
    setEditingResourceId(null);
    setResourceEditorMode(null);
    setResourceTitle("");
    setResourceUrl("");
    setResourceText("");
    setResourceNotes("");
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
    setResourceText(getServicePlanResourceDataString(resource || ({} as ServicePlanContentResource), "text"));
    setResourceNotes(getServicePlanResourceNotes(resource || ({} as ServicePlanContentResource)));
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
    if (resourceEditorMode === "text" && !resourceText.trim()) {
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
      if (isElectron() && window.electronAPI?.openExternalUrl) {
        await window.electronAPI.openExternalUrl(resource.url);
      } else {
        window.open(resource.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setOpeningResourceId(null);
    }
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
            onClick={() => setActiveYouTubeResourceId(resource.id)}
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
    if (resource.type === "document") {
      const resourceId = getServicePlanResourceDataString(resource, "resourceId");
      const churchResource = churchResources.find((item) => item.id === resourceId);
      const openChurchResource = async (disposition: "inline" | "attachment") => {
        if (!churchId || !resourceId) return;
        setOpeningResourceId(resource.id);
        try {
          const result = await getChurchResourceUrl({
            churchId,
            resourceId,
            disposition,
          });
          window.open(result.url, "_blank", "noopener,noreferrer");
        } finally {
          setOpeningResourceId(null);
        }
      };
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
        </div>
      );
    }
    if (resource.type === "text") {
      return <p className="whitespace-pre-wrap text-sm text-gray-200">{getServicePlanResourceDataString(resource, "text")}</p>;
    }
    if (resource.type === "generic" || !SERVICE_PLAN_RESOURCE_TYPES.has(resource.type)) {
      return resource.data?.notes ? <p className="whitespace-pre-wrap text-sm text-gray-300">{getServicePlanResourceNotes(resource)}</p> : null;
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
            <TextArea label="Notes" value={resourceText} onChange={setResourceText} />
          ) : (
            <TextArea label="Notes (optional)" value={resourceNotes} onChange={setResourceNotes} />
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
      {activeYouTubeQueue.length ? <YouTubePlaylistPlayer queue={activeYouTubeQueue} /> : null}

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

      <section className="space-y-2" aria-label="Attached resources">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Resources</h3>
        {resources.length ? resources.map((resource) => {
          const definition = getServicePlanResourceDefinition(resource.type);
          const ResourceIcon = definition.icon;
          const churchResource = resource.type === "document"
            ? churchResources.find(
                (item) =>
                  item.id === getServicePlanResourceDataString(resource, "resourceId"),
              )
            : undefined;
          const displayTitle = churchResource?.name || resource.title;
          const isEditable = allowEdit && definition.canEdit &&
            (resource.type === "url" || resource.type === "text" || resource.type === "generic");
          return (
            <article key={resource.id} className="rounded-md border border-gray-700 bg-gray-900/70 px-2 py-2">
              <div className="flex min-w-0 items-start gap-2">
                <ResourceIcon className={`mt-0.5 size-4 shrink-0 ${definition.toneClassName}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-100">{displayTitle}</p>
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
              <DropdownMenuItem onSelect={() => { setChurchResourcePickerOpen(true); void loadChurchResources(); }}><FileText className="size-4 text-cyan-300" aria-hidden />Church file</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openResourceEditor("url")}><LinkIcon className="size-4 text-blue-300" aria-hidden />Link</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openResourceEditor("text")}><StickyNote className="size-4 text-emerald-300" aria-hidden />Text / Notes</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openResourceEditor("generic")}><FilePlus className="size-4 text-gray-300" aria-hidden />Other</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </section>

      {pickerOpen ? <ServicePlanLibraryPicker isOpen onClose={() => setPickerOpen(false)} onSelectSong={(song) => { updateSongs([...songs, song]); setPickerOpen(false); }} /> : null}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label="Choose a church file">
          <div className="max-h-[min(32rem,calc(100vh-2rem))] w-[min(30rem,100%)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">Choose a church file</h3><Button type="button" variant="tertiary" iconSize="sm" svg={X} aria-label="Close church file picker" onClick={() => setChurchResourcePickerOpen(false)} /></div>
            {churchResourceLoading ? <p className="text-sm text-gray-400" role="status">Loading resources…</p> : null}
            {churchResourceError ? <p className="text-sm text-red-300" role="alert">{churchResourceError}</p> : null}
            {!churchResourceLoading && !churchResourceError && churchResources.length ? <div className="space-y-1">{churchResources.map((resource) => {
              const alreadyAttached = resources.some((candidate) => candidate.type === "document" && getServicePlanResourceDataString(candidate, "resourceId") === resource.id);
              return <Button key={resource.id} type="button" variant="tertiary" className="w-full justify-start" disabled={alreadyAttached} onClick={() => { updateResources([...resources, createServicePlanDocumentResource({ resourceId: resource.id })]); setChurchResourcePickerOpen(false); }}><FileText className="size-4 shrink-0 text-cyan-300" aria-hidden /><span className="truncate">{resource.name}</span><span className="ml-auto text-xs text-gray-500">{resource.storage.fileName}</span></Button>;
            })}</div> : null}
            {!churchResourceLoading && !churchResourceError && !churchResources.length ? <p className="text-sm text-gray-400">No church resources are available yet.</p> : null}
          </div>
        </div>
      ) : null}
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
