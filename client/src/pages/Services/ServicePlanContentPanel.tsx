import { useState } from "react";
import { ArrowLeft, BookOpen, Music, X } from "lucide-react";
import Button from "../../components/Button/Button";
import Icon from "../../components/Icon/Icon";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import ServicePlanScripturePopover from "./ServicePlanScripturePopover";
import {
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
  type ServicePlanElement,
  type ServicePlanScriptureReference,
  type ServicePlanSongReference,
} from "../../types/servicePlan";
import { richTextToPlainText } from "../../types/richText";

type ServicePlanContentPanelProps = {
  element: ServicePlanElement;
  allowEdit: boolean;
  onUpdate: (changes: Partial<ServicePlanElement>) => void;
  onViewSongLyrics?: (songRef: ServicePlanSongReference) => void;
  onOpenSongDetails?: (songRef: ServicePlanSongReference) => void;
  onCreatePendingSong?: (songRef: Extract<ServicePlanSongReference, { kind: "pending" }>) => void;
  canCreateLibrarySong?: boolean;
};

const ServicePlanContentPanel = ({
  element,
  allowEdit,
  onUpdate,
  onViewSongLyrics,
  onOpenSongDetails,
  onCreatePendingSong,
  canCreateLibrarySong = false,
}: ServicePlanContentPanelProps) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scriptureEditIndex, setScriptureEditIndex] = useState<number | null>(null);
  const [scriptureAddOpen, setScriptureAddOpen] = useState(false);
  const songs = getServicePlanElementSongRefs(element);
  const scriptures = getServicePlanElementScriptureRefs(element);
  const itemLabel = richTextToPlainText(element.title).trim() || "Untitled item";

  const updateSongs = (next: ServicePlanSongReference[]) =>
    onUpdate({ songRef: undefined, songRefs: next });
  const updateScriptures = (next: ServicePlanScriptureReference[]) =>
    onUpdate({ scriptureRef: undefined, scriptureRefs: next });

  const activeScripture = scriptureEditIndex == null
    ? undefined
    : scriptures[scriptureEditIndex];

  if (scriptureAddOpen || activeScripture) {
    const isEditingScripture = Boolean(activeScripture);
    return (
      <div className="flex h-full min-h-0 flex-col gap-4" aria-label="Scripture editor">
        <Button type="button" variant="tertiary" svg={ArrowLeft} padding="p-0" className="min-h-0 max-md:min-h-0 w-fit cursor-pointer" onClick={() => { setScriptureAddOpen(false); setScriptureEditIndex(null); }}>
          Back to content
        </Button>
        <ServicePlanScripturePopover
          inline
          open
          onOpenChange={(open) => { if (!open) { setScriptureAddOpen(false); setScriptureEditIndex(null); } }}
          initialScriptureRef={activeScripture}
          anchor={<div aria-hidden className="h-px w-full" />}
          onSelect={(scripture) => {
            updateScriptures(isEditingScripture
              ? scriptures.map((current, index) => index === scriptureEditIndex ? scripture : current)
              : [...scriptures, scripture]);
            setScriptureAddOpen(false);
            setScriptureEditIndex(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label={`Content for ${itemLabel}`}>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Songs</h3>
        {songs.length ? songs.map((song, index) => {
          const label = song.kind === "pending" ? song.title : song.songName;
          return (
            <div key={`${song.kind}:${label}:${index}`} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/70 px-2 py-1.5">
              <Icon svg={Music} size="xs" className="shrink-0 text-cyan-300" />
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-gray-100 hover:text-cyan-100"
                onClick={() => {
                  if (song.kind === "pending" && onCreatePendingSong) {
                    onCreatePendingSong(song);
                    return;
                  }
                  (onOpenSongDetails || onViewSongLyrics)?.(song);
                }}
                disabled={
                  song.kind === "pending"
                    ? !onCreatePendingSong && !onViewSongLyrics
                    : !onViewSongLyrics && !onOpenSongDetails
                }
              >
                {label}
              </button>
              {song.kind === "pending" ? <span className="text-xs text-amber-200">Not in library</span> : null}
              {allowEdit ? (
                <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-5 w-5" svg={X} aria-label={`Remove song ${label}`} onClick={() => updateSongs(songs.filter((_, current) => current !== index))} />
              ) : null}
            </div>
          );
        }) : <p className="text-sm text-gray-500">No song attached.</p>}
        {allowEdit ? (
          <Button type="button" variant="tertiary" className="cursor-pointer border border-dashed border-gray-600 text-xs" onClick={() => setPickerOpen(true)}>
            Add song
          </Button>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scripture</h3>
        {scriptures.length ? scriptures.map((scripture, index) => (
          <div key={`${scripture.label}:${index}`} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/70 px-2 py-1.5">
            {allowEdit ? (
              <Button type="button" variant="tertiary" className="min-w-0 flex-1 cursor-pointer justify-start p-0 text-sm text-gray-100 hover:text-orange-100" onClick={() => setScriptureEditIndex(index)}><Icon svg={BookOpen} size="xs" className="shrink-0 text-orange-300" /><span className="truncate">{scripture.label}</span></Button>
            ) : <><Icon svg={BookOpen} size="xs" className="shrink-0 text-orange-300" /><span className="truncate text-sm text-gray-100">{scripture.label}</span></>}
            {allowEdit ? <Button type="button" variant="tertiary" iconSize="xs" padding="p-0" className="h-5 w-5" svg={X} aria-label={`Remove scripture ${scripture.label}`} onClick={() => updateScriptures(scriptures.filter((_, current) => current !== index))} /> : null}
          </div>
        )) : <p className="text-sm text-gray-500">No scripture attached.</p>}
        {allowEdit ? (
          <Button type="button" variant="tertiary" className="cursor-pointer border border-dashed border-gray-600 text-xs" onClick={() => setScriptureAddOpen(true)}>Add scripture</Button>
        ) : null}
      </section>

      {pickerOpen ? (
        <ServicePlanLibraryPicker
          isOpen
          onClose={() => setPickerOpen(false)}
          onSelectSong={(song) => updateSongs([...songs, song])}
        />
      ) : null}
    </div>
  );
};

export default ServicePlanContentPanel;
