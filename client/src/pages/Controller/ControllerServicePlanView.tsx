import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ContentPreviewDialog from "../../components/ContentPreview/ContentPreviewDialog";
import type { ContentPreviewResource } from "../../components/ContentPreview/contentPreview";
import Select from "../../components/Select/Select";
import ServicePlanCustomDocumentPreviewDialog from "../../components/ServicePlanCustomDocumentPreviewDialog";
import ViewPlainLyricsDrawer from "../../components/SongSections/ViewPlainLyricsDrawer";
import ViewSongSectionsDrawer from "../../components/SongSections/ViewSongSectionsDrawer";
import { ServicePlanMicrophoneChip } from "../../components/ServicePlanMicrophoneChip";
import ServicePlanRolePicker from "../../components/ServicePlanRolePicker";
import ServiceFlowRichText from "../../components/ServiceFlowRichText/ServiceFlowRichText";
import {
  buildServiceFlowRoleOptions,
  buildServiceFlowTeamLabels,
  filterServiceFlowRoleOptions,
  selectedServiceFlowRoleTeamNames,
  visibleServiceFlowMicrophoneAssignmentsForItem,
  visibleServiceFlowNotesForItem,
  type ServiceFlowFilterPreference,
} from "../../services/serviceFlowAudience";
import type { PublicServiceFlowResource, PublicServiceFlowSnapshot } from "../../services/serviceFlowTypes";
import type { DBItem, ScrollbarWidth } from "../../types";
import { useSelector } from "../../hooks";
import {
  getServicePlanCustomDocumentId,
  getServicePlanElementContentResources,
  getServicePlanElementAssigneeNames,
  type ServicePlanContentResource,
  type ServicePlanElement,
  type ServicePlanScriptureReference,
  type ServicePlanSongReference,
  type ServicePlan,
} from "../../types/servicePlan";
import { useControllerBasePath } from "../../context/activeController";
import { bibleRefToUrlParams, parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { formatServicePlanDuration } from "../Services/servicePlanDuration";
import { getServicePlanLiveProgress } from "../Services/servicePlanLive";
import {
  getServicePlanCustomDocumentDisplayLabel,
  getServicePlanResourceDefinition,
} from "../Services/servicePlanResources";
import { buildServicePlanFlowSnapshot } from "../buildServicePlanFlowSnapshot";

type ControllerServicePlanPreference = ServiceFlowFilterPreference;
type ScriptureLocation = Pick<
  ServicePlanScriptureReference,
  "book" | "chapter" | "verseRange" | "version"
>;

type SongViewerSelection =
  | { kind: "reference"; reference: ServicePlanSongReference }
  | { kind: "unavailable"; title: string };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const getString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const getSongReference = (
  resource: ServicePlanContentResource | undefined,
): ServicePlanSongReference | null => {
  if (!resource) return null;
  const storedReference = asRecord(resource.data?.songRef);
  if (storedReference?.kind === "pending") {
    return {
      kind: "pending",
      title: getString(storedReference.title) || resource.title,
      lyricsText: typeof storedReference.lyricsText === "string"
        ? storedReference.lyricsText
        : "",
      ...(getString(storedReference.id) ? { id: getString(storedReference.id) } : {}),
      ...(getString(storedReference.key) ? { key: getString(storedReference.key) } : {}),
    };
  }
  if (storedReference?.kind === "library") {
    const songId = getString(storedReference.songId);
    if (songId) {
      return {
        kind: "library",
        songId,
        songName: getString(storedReference.songName) || resource.title,
        ...(getString(storedReference.id) ? { id: getString(storedReference.id) } : {}),
        ...(getString(storedReference.key) ? { key: getString(storedReference.key) } : {}),
      };
    }
  }
  const nestedSongId = getString(storedReference?.songId);
  if (nestedSongId) {
    return {
      kind: "library",
      songId: nestedSongId,
      songName: getString(storedReference?.songName) || resource.title,
      ...(getString(storedReference?.id) ? { id: getString(storedReference?.id) } : {}),
      ...(getString(storedReference?.key) ? { key: getString(storedReference?.key) } : {}),
    };
  }

  // Newer resource references store the durable song ID directly.
  const songId = getString(resource.data?.songId);
  if (songId) {
    return { kind: "library", songId, songName: resource.title };
  }
  if (typeof resource.data?.lyricsText === "string") {
    return {
      kind: "pending",
      title: getString(resource.data?.title) || resource.title,
      lyricsText: resource.data.lyricsText,
    };
  }

  return null;
};

const getScriptureReference = (
  resource: ServicePlanContentResource | undefined,
): ScriptureLocation | null => {
  if (!resource) return null;
  const storedReference =
    asRecord(resource.data?.scripture) ??
    asRecord(resource.data?.scriptureRef) ??
    resource.data;
  if (storedReference) {
    const book = getString(storedReference.book);
    const chapter = getString(storedReference.chapter);
    const parsedLabel = parseBibleReference(resource.title);
    if (book && chapter) {
      const startVerse = getString(storedReference.startVerse);
      const endVerse = getString(storedReference.endVerse);
      const verseRangeFromParts = startVerse && endVerse
        ? startVerse + "-" + endVerse
        : startVerse;
      const verseRange = getString(storedReference.verseRange) || verseRangeFromParts;
      return {
        book,
        chapter,
        verseRange: verseRange || parsedLabel?.verseRange || "",
        version: getString(storedReference.version) || parsedLabel?.version || "",
      };
    }
  }

  // Older resource-only records may contain the structured passage only in the label.
  return parseBibleReference(resource.title);
};

const readPreference = (key: string): ControllerServicePlanPreference => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    if (value && typeof value === "object") {
      const candidate = value as Partial<ControllerServicePlanPreference>;
      return {
        teamName: typeof candidate.teamName === "string" ? candidate.teamName : "",
        positionIds: Array.isArray(candidate.positionIds)
          ? candidate.positionIds.filter((id): id is string => typeof id === "string")
          : [],
      };
    }
  } catch {
    // An unavailable or stale local preference falls back to an unfiltered view.
  }
  return { teamName: "", positionIds: [] };
};

const writePreference = (key: string, preference: ControllerServicePlanPreference) => {
  try {
    localStorage.setItem(key, JSON.stringify(preference));
  } catch {
    // Local preference storage is optional; the controller remains usable.
  }
};

const ControllerResources = ({
  resources,
  element,
  songDocsById,
  customDocumentDocsById,
  onOpenScripture,
}: {
  resources: PublicServiceFlowResource[];
  element?: ServicePlanElement;
  songDocsById: ReadonlyMap<string, DBItem>;
  customDocumentDocsById: ReadonlyMap<string, DBItem>;
  onOpenScripture: (reference: ScriptureLocation) => void;
}) => {
  const [previewResource, setPreviewResource] = useState<ContentPreviewResource | null>(null);
  const [songSelection, setSongSelection] = useState<SongViewerSelection | null>(null);
  const [customDocumentSelection, setCustomDocumentSelection] = useState<{ id: string; title: string } | null>(null);
  const planResources = useMemo(
    () => element ? getServicePlanElementContentResources(element) : [],
    [element],
  );
  const selectedSongReference =
    songSelection?.kind === "reference" ? songSelection.reference : null;
  const songFromLibrary = selectedSongReference?.kind === "library"
    ? songDocsById.get(selectedSongReference.songId)
    : undefined;
  const selectedSong = songFromLibrary?.type === "song" ? songFromLibrary : null;
  let plainLyricsTitle: string | null = null;
  if (songSelection?.kind === "unavailable") {
    plainLyricsTitle = songSelection.title;
  } else if (selectedSongReference?.kind === "pending") {
    plainLyricsTitle = selectedSongReference.title;
  } else if (selectedSongReference?.kind === "library") {
    plainLyricsTitle = selectedSongReference.songName;
  }
  const plainLyricsText = selectedSongReference?.kind === "pending"
    ? selectedSongReference.lyricsText
    : "";
  const plainLyricsEmptyMessage = songSelection?.kind === "unavailable" ||
    (selectedSongReference?.kind === "library" && !selectedSong)
    ? "This song is no longer available in the song library."
    : undefined;
  const customDocumentFromLibrary = customDocumentSelection
    ? customDocumentDocsById.get(customDocumentSelection.id)
    : undefined;
  const selectedCustomDocument =
    customDocumentFromLibrary?.type === "free" ? customDocumentFromLibrary : null;
  if (!resources.length) return null;
  const resourceCounts = new Map<string, number>();
  for (const resource of resources) {
    const labelKey = JSON.stringify([resource.type, resource.title?.trim() || ""]);
    resourceCounts.set(labelKey, (resourceCounts.get(labelKey) || 0) + 1);
  }
  const resourceOccurrences = new Map<string, number>();

  return (
    <>
      <div className="flex min-w-0 flex-wrap gap-1" aria-label="Resources">
        {resources.map((resource, index) => {
          const planResource = planResources[index];
          const resourceType = planResource?.type || resource.type;
          const resourceKey = planResource?.id || resource.type + ":" + resource.title + ":" + index;
          const labelKey = JSON.stringify([resource.type, resource.title?.trim() || ""]);
          const resourceOccurrence = (resourceOccurrences.get(labelKey) || 0) + 1;
          resourceOccurrences.set(labelKey, resourceOccurrence);
          const duplicateResourceCount = resourceCounts.get(labelKey) || 1;
          const definition = getServicePlanResourceDefinition(resourceType);
          const ResourceIcon = definition.icon;
          const songReference = resourceType === "song"
            ? getSongReference(planResource)
            : null;
          const scriptureReference = resourceType === "scripture"
            ? getScriptureReference(planResource)
            : null;
          const customDocumentId = planResource
            ? getServicePlanCustomDocumentId(planResource)
            : "";
          const customDocument = customDocumentDocsById.get(customDocumentId);
          const label = resourceType === "custom-document" && planResource
            ? getServicePlanCustomDocumentDisplayLabel(planResource, customDocument)
            : resource.title?.trim() || planResource?.title || definition.label;
          const repeatedLabel = duplicateResourceCount > 1
            ? ` (attachment ${resourceOccurrence} of ${duplicateResourceCount})`
            : "";
          const canPreview = resourceType === "song" ||
            resourceType === "custom-document" ||
            Boolean(scriptureReference || resource.url || resource.detail || resource.richTextContent);
          const content = (
            <>
              <ResourceIcon className={`size-3.5 shrink-0 ${definition.toneClassName}`} aria-hidden />
              <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">{label}</span>
              {canPreview ? <Eye className="size-3 shrink-0 opacity-70" aria-hidden /> : null}
            </>
          );
          const chipClassName = "inline-flex min-w-0 max-w-full items-center gap-1 whitespace-normal rounded-full border border-neutral-700 bg-neutral-900/80 px-2 py-0.5 text-left text-xs leading-5 text-neutral-300 hover:border-cyan-500/70 hover:bg-neutral-800";
          return canPreview ? (
            <div key={resourceKey} className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <button
                type="button"
                title={`${definition.label}: ${label}`}
                aria-label={`View ${definition.label}: ${label}${repeatedLabel}`}
                className={`${chipClassName} cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400`}
                onClick={() => {
                  if (resourceType === "song" && songReference) {
                    setPreviewResource(null);
                    setCustomDocumentSelection(null);
                    setSongSelection({ kind: "reference", reference: songReference });
                    return;
                  }
                  if (resourceType === "song" && !resource.url && !resource.detail && !resource.richTextContent) {
                    setPreviewResource(null);
                    setCustomDocumentSelection(null);
                    setSongSelection({ kind: "unavailable", title: label });
                    return;
                  }
                  if (resourceType === "scripture" && scriptureReference) {
                    onOpenScripture(scriptureReference);
                    return;
                  }
                  if (resourceType === "custom-document") {
                    setPreviewResource(null);
                    setSongSelection(null);
                    setCustomDocumentSelection({ id: customDocumentId, title: label });
                    return;
                  }
                  setSongSelection(null);
                  setCustomDocumentSelection(null);
                  setPreviewResource({
                    id: planResource?.id || resource.type + ":" + label + ":" + index,
                    type: resource.type,
                    title: label,
                    ...(resource.url ? { url: resource.url } : {}),
                    ...(resource.detail ? { textContent: resource.detail } : {}),
                    ...(resource.richTextContent ? { richTextContent: resource.richTextContent } : {}),
                  });
                }}
              >
                {content}
              </button>
            </div>
          ) : (
            <span
              key={resourceKey}
              title={`${definition.label}: ${label}`}
              className={chipClassName}
            >
              {content}
            </span>
          );
        })}
      </div>
      <ContentPreviewDialog resource={previewResource} onClose={() => setPreviewResource(null)} />
      <ViewSongSectionsDrawer
        song={selectedSong}
        isOpen={Boolean(selectedSong)}
        onClose={() => setSongSelection(null)}
      />
      <ViewPlainLyricsDrawer
        title={plainLyricsTitle}
        lyricsText={plainLyricsText}
        emptyMessage={plainLyricsEmptyMessage}
        isOpen={Boolean(songSelection && !selectedSong)}
        onClose={() => setSongSelection(null)}
      />
      <ServicePlanCustomDocumentPreviewDialog
        document={selectedCustomDocument}
        unavailableName={
          customDocumentSelection && !selectedCustomDocument
            ? customDocumentSelection.title
            : undefined
        }
        onClose={() => setCustomDocumentSelection(null)}
      />
    </>
  );
};

const ControllerServicePlanView = ({
  plan,
  snapshot,
  churchId,
  controllerProfileId,
  sectionLabelColor,
  sectionBorderColor,
  scrollbarWidth = "thin",
}: {
  plan: ServicePlan;
  snapshot?: PublicServiceFlowSnapshot | null;
  churchId: string;
  controllerProfileId: string;
  sectionLabelColor: string;
  sectionBorderColor: string;
  scrollbarWidth?: ScrollbarWidth;
}) => {
  const preferenceKey = `worship-sync:service-plan-operator:${churchId}:${controllerProfileId}`;
  const [preference, setPreference] = useState(() => readPreference(preferenceKey));
  const [clientNow, setClientNow] = useState(() => Date.now());
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const songDocs = useSelector((state) => state.allDocs.allSongDocs);
  const customDocumentDocs = useSelector((state) => state.allDocs.allFreeFormDocs);
  const songDocsById = useMemo(
    () => new Map(songDocs.map((song) => [song._id, song])),
    [songDocs],
  );
  const customDocumentDocsById = useMemo(
    () => new Map(customDocumentDocs.map((document) => [document._id, document])),
    [customDocumentDocs],
  );
  const openScripture = useCallback((reference: ScriptureLocation) => {
    const params = bibleRefToUrlParams(reference);
    navigate(`${controllerBasePath}/bible?${params}`);
  }, [controllerBasePath, navigate]);
  useEffect(() => {
    const interval = window.setInterval(() => setClientNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const fallbackSnapshot = useMemo(
    () => buildServicePlanFlowSnapshot({
      plan,
      startsAt: plan.startsAt || `${plan.date}T00:00:00.000Z`,
    }),
    [plan],
  );
  const serviceSnapshot = snapshot || fallbackSnapshot;
  const serverOffsetMs = useMemo(
    () => snapshot ? snapshot.serverNowMs - Date.now() : 0,
    [snapshot],
  );
  const currentItemId = getServicePlanLiveProgress({
    ...plan,
    startsAt: plan.startsAt || `${plan.date}T00:00:00.000Z`,
  }, clientNow + serverOffsetMs)?.current?.item.id ?? null;
  const teams = useMemo(() => buildServiceFlowTeamLabels(serviceSnapshot), [serviceSnapshot]);
  const allRoles = useMemo(() => buildServiceFlowRoleOptions(serviceSnapshot), [serviceSnapshot]);
  const effectivePreference = useMemo(() => {
    const teamName = teams.includes(preference.teamName) ? preference.teamName : "";
    const rolesForTeam = filterServiceFlowRoleOptions(allRoles, teamName);
    return {
      teamName,
      positionIds: preference.positionIds.filter((id) =>
        rolesForTeam.some((role) => role.positionId === id),
      ),
    };
  }, [allRoles, preference, teams]);
  const roleOptions = useMemo(
    () => filterServiceFlowRoleOptions(allRoles, effectivePreference.teamName),
    [allRoles, effectivePreference.teamName],
  );
  const selectedRoleTeamNames = useMemo(
    () => selectedServiceFlowRoleTeamNames(roleOptions, effectivePreference.positionIds),
    [effectivePreference.positionIds, roleOptions],
  );
  const updatePreference = useCallback((next: ControllerServicePlanPreference) => {
    setPreference(next);
    writePreference(preferenceKey, next);
  }, [preferenceKey]);
  useEffect(() => {
    if (
      preference.teamName !== effectivePreference.teamName ||
      preference.positionIds.length !== effectivePreference.positionIds.length
    ) updatePreference(effectivePreference);
  }, [effectivePreference, preference, updatePreference]);
  const planItemsById = useMemo(() => new Map(
    plan.sections.flatMap((section) => section.elements.map((item) => [item.id, item] as const)),
  ), [plan]);

  return (
    <div className="flex flex-col gap-2 pr-1" aria-label="Selected service plan running order">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/50 p-1.5" aria-label="Service plan filters">
        <Select
          label="Team"
          labelLayout="inline"
          labelFontSize="text-[10px]"
          labelClassName="!p-0 !font-normal text-zinc-400"
          options={[
            { value: "", label: "All teams" },
            ...teams.map((team) => ({ value: team, label: team })),
          ]}
          value={effectivePreference.teamName}
          onChange={(teamName) => updatePreference({
            ...effectivePreference,
            teamName,
          })}
          className="min-w-0 gap-1"
          selectClassName="h-7 min-h-7 w-40 max-w-40 rounded border-zinc-700 bg-zinc-900 px-1.5 text-[11px] text-zinc-100 focus-visible:ring-1 focus-visible:ring-cyan-300"
          backgroundColor="bg-zinc-900"
          textColor="text-zinc-100"
          contentBackgroundColor="bg-zinc-900"
          contentTextColor="text-zinc-100"
        />
        <ServicePlanRolePicker
          multi
          value={effectivePreference.positionIds}
          onValueChange={(positionIds) => updatePreference({
            ...effectivePreference,
            positionIds,
          })}
          options={roleOptions}
          scrollbarWidth={scrollbarWidth}
          teamFilterStorageKey={`${preferenceKey}:role-team-filter`}
          lockedTeamName={effectivePreference.teamName || undefined}
          ariaLabel="Filter roles"
          label="Roles"
          placeholder="All roles"
          className="!h-7 !min-h-0 !max-w-full !rounded !border !border-zinc-700 !bg-zinc-900 !px-1.5 !py-0 !text-[11px] !text-zinc-100 hover:!border-zinc-600 hover:!bg-zinc-800 focus-visible:!ring-1 focus-visible:!ring-cyan-300"
        />
      </div>

      {serviceSnapshot.service.sections.map((section) => (
        <section
          key={section.id}
          aria-label={`Service plan section: ${section.title || "Untitled"}`}
          className="min-w-0 overflow-hidden rounded-lg border border-zinc-700/80 border-l-2 bg-zinc-950/40"
          style={{ borderLeftColor: sectionBorderColor }}
        >
          {section.title ? (
            <h3
              className="border-b border-zinc-700/80 bg-zinc-950/80 px-2.5 py-1.5 text-xs font-semibold"
              style={{ color: sectionLabelColor }}
            >
              {section.title}
            </h3>
          ) : null}
          <ol className="divide-y divide-zinc-700">
            {section.items.map((item) => {
              const planItem = planItemsById.get(item.id);
              const isLive = currentItemId === item.id;
              const leadName = item.creditName?.trim() || (
                planItem ? getServicePlanElementAssigneeNames(planItem).join(", ") : ""
              );
              const notes = visibleServiceFlowNotesForItem(
                item,
                effectivePreference.teamName,
                effectivePreference.positionIds,
                selectedRoleTeamNames,
              );
              const microphones = visibleServiceFlowMicrophoneAssignmentsForItem(
                item,
                effectivePreference.teamName,
                effectivePreference.positionIds,
              );
              const hasAudienceSelection = Boolean(
                effectivePreference.teamName || effectivePreference.positionIds.length,
              );
              // The public snapshot carries IEM holder names, but no role or
              // team audience for them. Treat those cues like unscoped legacy
              // microphones and keep them out of a narrowed audience view.
              const equipment = hasAudienceSelection ? [] : item.equipmentAssignments || [];
              const duration = item.durationSeconds > 0
                ? formatServicePlanDuration({ durationSeconds: item.durationSeconds })
                : "";
              return (
                <li
                  key={item.id}
                  className={`flex min-w-0 flex-col gap-1.5 border-l-2 px-2.5 py-2 ${isLive ? "border-emerald-400 bg-emerald-500/[0.07]" : "border-transparent"}`}
                  aria-current={isLive ? "true" : undefined}
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-zinc-400">
                    {planItem?.startTime ? <time className="shrink-0">{planItem.startTime}</time> : null}
                    {duration ? <span className="shrink-0">{duration}</span> : null}
                    <h4 className="min-w-0 flex-1 break-words whitespace-normal text-xs font-semibold text-zinc-100">{item.title}</h4>
                    {isLive ? <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 font-semibold uppercase text-emerald-200">Live</span> : null}
                  </div>
                  {leadName ? <p className="break-words whitespace-normal text-xs font-normal text-white"><span className="text-zinc-400">Led by:</span> {leadName}</p> : null}

                  {item.resources?.length ? (
                    <ControllerResources
                      key={`${plan.planId}:${item.id}`}
                      resources={item.resources}
                      element={planItem}
                      songDocsById={songDocsById}
                      customDocumentDocsById={customDocumentDocsById}
                      onOpenScripture={openScripture}
                    />
                  ) : null}

                  {item.notes.blocks.length || notes.length ? (
                    <details className="min-w-0 text-xs leading-4 text-zinc-300">
                      <summary className="w-fit cursor-pointer select-none text-amber-300/90 hover:text-amber-200">
                        View notes{notes.length ? ` (${notes.length + (item.notes.blocks.length ? 1 : 0)})` : ""}
                      </summary>
                      <div className="mt-1 min-w-0 break-words space-y-1 overflow-hidden border-l border-amber-500/40 pl-2 [&_*]:break-words">
                        {item.notes.blocks.length ? <ServiceFlowRichText document={item.notes} /> : null}
                        {notes.map((note, index) => (
                          <div key={`${note.label}:${index}`} className="min-w-0">
                            <span className="font-medium text-amber-200">{note.label}{note.scope === "role" ? " role" : ""} notes: </span>
                            <ServiceFlowRichText document={note.notes} />
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  {microphones.length || equipment.length ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {microphones.length ? (
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">Microphones</span>
                      ) : null}
                      {microphones.map((assignment) => (
                        <ServicePlanMicrophoneChip
                          key={`${assignment.microphone.id}:${assignment.holderName || ""}`}
                          microphone={assignment.microphone}
                          details={assignment.holderName ? [assignment.holderName] : []}
                          className="gap-1 rounded-full px-2 py-0.5 text-[11px]"
                        />
                      ))}
                      {equipment.map((assignment) => (
                        <span
                          key={`${assignment.equipment.id}:${assignment.holderName || ""}`}
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-cyan-800/70 bg-cyan-950/30 px-1.5 py-0.5 text-[10px] text-cyan-100"
                          title={`${assignment.equipment.name}${assignment.holderName ? ` · ${assignment.holderName}` : ""}`}
                        >
                          {assignment.equipment.name}{assignment.holderName ? ` · ${assignment.holderName}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {serviceSnapshot.service.sections.every((section) => section.items.length === 0) ? (
        <p className="text-xs text-zinc-400">This service plan has no items.</p>
      ) : null}
    </div>
  );
};

export default ControllerServicePlanView;
