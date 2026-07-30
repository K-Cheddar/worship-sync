import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AnimateCollapse from "../../components/AnimateCollapse/AnimateCollapse";
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
} from "../../components/Button";
import ExpandCollapseChevronButton from "../../components/ExpandCollapseChevronButton/ExpandCollapseChevronButton";
import Input from "../../components/Input/Input";
import TimePicker from "../../components/TimePicker/TimePicker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { cn } from "@/utils/cnHelper";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import { useDispatch, useSelector } from "../../hooks";
import { updateAllDocs } from "../../utils/dbUtils";
import {
  getServicePlan,
  getServicePlanAssignmentHistory,
  publishServicePlan,
  saveServicePlan,
  saveServicePlanAssignmentHistory,
  unpublishServicePlan,
  updateServicePlanPublicLive,
  AuthApiError,
  type ServicePlanPublicUrls,
} from "../../api/auth";
import { showApiErrorToast } from "../../utils/apiErrorToast";
import { useSensors } from "../../utils/dndUtils";
import { getServicePlanKey } from "../../utils/servicePlanKeys";
import {
  formatOccurrenceRowLabel,
  getSharedOccurrenceTiming,
  isOccurrenceOnCalendarDay,
} from "../../utils/teamScheduleOccurrences";
import { memberName } from "../Teams/teamsUtils";
import { getServicePlanningImportDataFromUrl } from "../../containers/Overlays/eventParser";
import {
  buildServicePlanSectionsFromImport,
  buildServicePlanSourceImport,
} from "./servicePlanFromImport";
import ServicePlanTemplateModal, {
  type ServicePlanTemplateModalMode,
} from "./ServicePlanTemplateModal";
import ServicePlanElementRow, {
  elementDndId,
  formatPlanStartTimeDisplay,
  ServicePlanElementColumnHeader,
  SERVICE_PLAN_INLINE_INPUT_CLASS,
} from "./ServicePlanElementRow";
import {
  applyElementDurationSecondsChange,
  applyElementStartTimeChange,
  applyPlanAnchorStartTime,
} from "./servicePlanTimingUtils";
import {
  getServicePlanLiveElementId,
  isServicePlanManualLive,
} from "./servicePlanLive";
import {
  isServicePlanUpdatedEvent,
  useTeamsLiveSync,
} from "../Teams/hooks/useTeamsLiveSync";
import { useServicePlanAutosave } from "./useServicePlanAutosave";
import type {
  TeamRosterMember,
  TeamScheduleOccurrence,
  TeamService,
} from "../../api/authTypes";
import type {
  ServicePlan,
  ServicePlanPayload,
  ServicePlanSection,
  ServicePlanSourceImport,
} from "../../types/servicePlan";
import {
  addElement,
  addSection,
  createEmptyServicePlanSections,
  removeElement,
  removeSection,
  renameSection,
  reorderElementsInSection,
  reorderSections,
  updateElement,
} from "./servicePlanDraftUtils";

const SECTION_ID_PREFIX = "section:";
const ELEMENT_ID_PREFIX = "element:";
const sectionDndId = (sectionId: string) => `${SECTION_ID_PREFIX}${sectionId}`;

const urlsFromPublishResult = (result: {
  publicUrl: string;
  teamPublicUrl?: string;
  generalPublicUrl?: string;
  currentTeamPublicUrl?: string;
  currentGeneralPublicUrl?: string;
}): ServicePlanPublicUrls => {
  const team = result.teamPublicUrl || result.publicUrl;
  return {
    team,
    general: result.generalPublicUrl || team,
    currentTeam: result.currentTeamPublicUrl,
    currentGeneral: result.currentGeneralPublicUrl,
  };
};

/**
 * The occurrence's wall-clock HH:mm *in the plan's own timezone*. Element start
 * times are stored as bare wall-clock strings and rendered to viewers in the
 * plan's timezone, so seeding them from the editor's browser zone would put an
 * operator working from another timezone an hour or more out.
 */
const occurrenceLocalTime = (iso: string, timeZone: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    // An unusable stored zone shouldn't block seeding a time.
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
};

type ServicePlanEditorProps = {
  /** The service this plan belongs to (already chosen by the Plans list). */
  service: TeamService;
  /** The specific dated occurrence being planned (already chosen by the
   * Plans list) — this editor no longer picks a service/date itself. */
  occurrence: TeamScheduleOccurrence;
  /** Roster, for "Assigned to" suggestions (members + free-text history —
   * not roster-linked/position-ranked; see ServicePlanElementRow). */
  members: TeamRosterMember[];
  canEdit: boolean;
  /** When set, renders a shared editor chrome with back control + title. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * Adjacent-plan navigation for the Plans list chrome. When provided, the
   * header shows previous/next controls; omit a callback to disable that side.
   */
  planNavigation?: {
    onPrevious?: () => void;
    onNext?: () => void;
  };
  /** Extra header controls (e.g. mobile Who's serving) rendered next to Actions. */
  headerActions?: ReactNode;
};

type SortableSectionCardProps = {
  section: ServicePlanSection;
  sections: ServicePlanSection[];
  canEdit: boolean;
  isEditing: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onAddElement: () => void;
  onRemoveElement: (elementId: string) => void;
  onUpdateElement: (elementId: string, changes: Parameters<typeof updateElement>[3]) => void;
  onElementDurationChange: (elementId: string, durationSeconds: number) => void;
  onElementStartTimeChange: (elementId: string, time: string) => void;
  assignedToHistoryValues: string[];
  publicSharingEnabled: boolean;
  isServiceDay: boolean;
  liveElementId: string | null;
  isManualLive: boolean;
  publicLiveBusy: boolean;
  onMakePublicLive: (elementId: string) => void;
  onResumePublicSchedule: () => void;
  /** Local view preference: hide shared and team notes on every element. */
  hideNotes?: boolean;
};

const SortableSectionCard = ({
  section,
  sections,
  canEdit,
  isEditing,
  onRename,
  onRemove,
  onAddElement,
  onRemoveElement,
  onUpdateElement,
  onElementDurationChange,
  onElementStartTimeChange,
  assignedToHistoryValues,
  publicSharingEnabled,
  isServiceDay,
  liveElementId,
  isManualLive,
  publicLiveBusy,
  onMakePublicLive,
  onResumePublicSchedule,
  hideNotes = false,
}: SortableSectionCardProps) => {
  const allowEdit = canEdit && isEditing;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionDndId(section.id), disabled: !allowEdit });
  const [isExpanded, setIsExpanded] = useState(true);

  const elementIds = section.elements.map((element) => elementDndId(element.id));

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
      className="overflow-hidden rounded-md border border-gray-700/80 bg-gray-950/40"
    >
      <div className="flex items-center gap-1 bg-gray-800/95 px-1.5 py-1">
        {allowEdit ? (
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="tertiary"
            iconSize="sm"
            className="shrink-0 touch-none max-md:min-h-0"
            svg={GripVertical}
            aria-label={`Drag to reorder ${section.name || "section"}`}
            {...attributes}
            {...listeners}
          />
        ) : null}
        <ExpandCollapseChevronButton
          expanded={isExpanded}
          onExpandedChange={setIsExpanded}
          expandLabel="Expand section"
          collapseLabel="Collapse section"
          className="mt-0 shrink-0 max-md:min-h-0"
        />
        {allowEdit ? (
          <Input
            label="Section name"
            hideLabel
            value={section.name}
            onChange={(value) => onRename(String(value))}
            className="min-w-0 flex-1"
            inputClassName={cn(
              SERVICE_PLAN_INLINE_INPUT_CLASS,
              "font-semibold text-gray-100",
            )}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-gray-100">
            {section.name.trim() || "Untitled section"}
          </h3>
        )}
        <span className="shrink-0 tabular-nums text-[11px] text-gray-400">
          {section.elements.length}
        </span>
        {allowEdit ? (
          <Button
            type="button"
            variant="tertiary"
            iconSize="sm"
            className="max-md:min-h-0"
            svg={Trash2}
            aria-label={`Remove section ${section.name || ""}`}
            onClick={onRemove}
          />
        ) : null}
      </div>

      <AnimateCollapse open={isExpanded}>
        <div className="pb-1">
          {section.elements.length > 0 ? (
            <ServicePlanElementColumnHeader isEditing={allowEdit} />
          ) : null}
          <SortableContext items={elementIds} strategy={verticalListSortingStrategy}>
            <div>
              {section.elements.map((element, elementIndex) => (
                <ServicePlanElementRow
                  key={element.id}
                  element={element}
                  canEdit={canEdit}
                  isEditing={isEditing}
                  onRemove={() => onRemoveElement(element.id)}
                  onUpdate={(changes) => onUpdateElement(element.id, changes)}
                  onDurationChange={(durationSeconds) =>
                    onElementDurationChange(element.id, durationSeconds)
                  }
                  onStartTimeChange={(time) => onElementStartTimeChange(element.id, time)}
                  assignedToHistoryValues={assignedToHistoryValues}
                  toneIndex={elementIndex}
                  publicSharingEnabled={publicSharingEnabled}
                  isServiceDay={isServiceDay}
                  isLive={liveElementId === element.id}
                  isManualLive={isManualLive && liveElementId === element.id}
                  publicLiveBusy={publicLiveBusy}
                  onMakePublicLive={() => onMakePublicLive(element.id)}
                  onResumePublicSchedule={onResumePublicSchedule}
                  hideNotes={hideNotes}
                />
              ))}
            </div>
          </SortableContext>

          {allowEdit ? (
            <Button
              type="button"
              variant="tertiary"
              svg={Plus}
              iconSize="sm"
              className="mx-1 mt-1 max-md:min-h-0"
              onClick={onAddElement}
            >
              Add element
            </Button>
          ) : null}
        </div>
      </AnimateCollapse>
    </section>
  );
};

/**
 * Build or import a service's order-of-service plan for one dated occurrence,
 * then edit every element freely. This is a separate planning document
 * (Firestore-backed ServicePlan) from the live PouchDB outline. Edits autosave
 * here; applying items into the Controller list is a separate, opt-in step
 * for the presentation operator (see servicePlanOutlineBridge.ts).
 *
 * The occurrence itself is chosen up front by the Plans list (see
 * TeamsPlansPage.tsx) — this component is purely "the editor for this one
 * already-chosen date," not a picker.
 */
const ServicePlanEditor = ({
  service,
  occurrence,
  members,
  canEdit,
  onBack,
  backLabel = "Back to Plans",
  planNavigation,
  headerActions,
}: ServicePlanEditorProps) => {
  const { churchId } = useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const { showToast } = useToast();
  const dispatch = useDispatch();
  const sensors = useSensors();
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const [assignmentHistory, setAssignmentHistory] = useState<string[]>([]);

  // The song library (allDocs.allSongDocs) is normally populated by the
  // Controller page's own lifecycle hook — a session that opens straight to
  // Teams and Services without ever visiting the Controller would otherwise
  // see an empty library here (no search results, no import song matches).
  useEffect(() => {
    if (!db) return;
    updateAllDocs(dispatch);
  }, [db, dispatch]);

  const planKey = getServicePlanKey(occurrence);

  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [sections, setSections] = useState<ServicePlanSection[] | null>(null);
  const [sourceImport, setSourceImport] = useState<ServicePlanSourceImport | undefined>(
    undefined,
  );
  // Do not expose the empty-plan actions until the first fetch has answered.
  // Otherwise a fast click can create a local draft that the initial response
  // immediately replaces.
  const [loading, setLoading] = useState(Boolean(churchId && planKey));
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [templateModal, setTemplateModal] =
    useState<ServicePlanTemplateModalMode | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [updatingPublicLive, setUpdatingPublicLive] = useState(false);
  const [publicUrls, setPublicUrls] = useState<ServicePlanPublicUrls | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draftChangeVersion, setDraftChangeVersion] = useState(0);
  const [conflictPlan, setConflictPlan] = useState<ServicePlan | null>(null);
  // View-only: collapses note chrome so operators can scan structure/timing.
  const [hideNotes, setHideNotes] = useState(false);
  // Compact read layout by default; Edit switches to stacked/editable fields.
  const [isEditing, setIsEditing] = useState(false);
  const [planActionsOpen, setPlanActionsOpen] = useState(false);

  const markDraftChanged = useCallback(() => {
    setDraftChangeVersion((version) => version + 1);
  }, []);

  const updateDraftSections = useCallback((next: ServicePlanSection[]) => {
    setSections(next);
    markDraftChanged();
  }, [markDraftChanged]);

  const updateDraftName = useCallback((next: string) => {
    setPlanName(next);
    markDraftChanged();
  }, [markDraftChanged]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setPlan(null);
    setSections(null);
    setPlanName("");
    setSourceImport(undefined);
    setTemplateModal(null);
    setShowImport(false);
    setImportUrl("");
    setPublicUrls(null);
    setConflictPlan(null);
    setDraftChangeVersion(0);
    setIsEditing(false);
    if (!planKey || !churchId) return;
    let cancelled = false;
    setLoading(true);
    getServicePlan(churchId, planKey)
      .then((res) => {
        if (cancelled) return;
        setPlan(res.servicePlan);
        setSections(res.servicePlan?.sections ?? null);
        setPlanName(res.servicePlan?.name || occurrence.name || "");
        setSourceImport(res.servicePlan?.sourceImport);
        setDraftChangeVersion(0);
        // Restores the share links for an already-published plan, so they
        // survive a reload instead of only existing in the publish response.
        setPublicUrls(res.publicUrls ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          showApiErrorToast(showToast, error, "Could not load this service plan.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, churchId]);

  // Assignment suggestions are church-wide, not per-occurrence, so this loads
  // once per church rather than resetting on every occurrence switch.
  useEffect(() => {
    if (!churchId) return;
    let cancelled = false;
    getServicePlanAssignmentHistory(churchId)
      .then((res) => {
        if (!cancelled) setAssignmentHistory(res.values);
      })
      .catch(() => {
        // Suggestions are a nice-to-have — the field still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const assignedToSuggestions = useMemo(
    () => Array.from(new Set([...members.map((member) => memberName(member)), ...assignmentHistory])),
    [members, assignmentHistory],
  );

  // The published timeline renders in this timezone, so it must stay whatever
  // it was first saved as. Re-stamping the current browser's zone on every
  // save would let an editor working from another timezone silently shift the
  // wall-clock times public viewers see.
  const planTimezone =
    plan?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** Best-effort: remembers any newly-typed "Assigned to" names for future
   * suggestions. Never blocks or fails the plan save itself. */
  const rememberAssignmentHistory = (savedSections: ServicePlanSection[]) => {
    if (!churchId) return;
    const usedNames = savedSections.flatMap((section) =>
      section.elements
        .map((element) => element.assignedName?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    const merged = Array.from(new Set([...assignmentHistory, ...usedNames]));
    if (merged.length === assignmentHistory.length) return;
    setAssignmentHistory(merged);
    saveServicePlanAssignmentHistory(churchId, merged).catch(() => {
      // Best-effort — suggestions just won't include these names yet.
    });
  };

  const buildAutosavePayload = useCallback(() => {
    if (!sections) return null;
    return {
      serviceId: occurrence.serviceId,
      serviceIds: occurrence.serviceIds || [occurrence.serviceId],
      groupId: occurrence.groupId,
      date: occurrence.startsAt.slice(0, 10),
      name: planName || occurrence.name,
      startsAt: occurrence.startsAt,
      timezone: planTimezone,
      sections,
      ...(sourceImport ? { sourceImport } : {}),
    };
  }, [occurrence, planName, planTimezone, sections, sourceImport]);

  const saveAutosavePayload = useCallback(
    (payload: ServicePlanPayload, baseRevision: number) => {
      if (!churchId) return Promise.reject(new Error("A church is required."));
      // Autosave consumes the saved plan itself, not the response envelope —
      // handing back the wrapper would leave `sections`/`revision` undefined.
      return saveServicePlan(churchId, planKey, { ...payload, baseRevision })
        .then((res) => res.servicePlan);
    },
    [churchId, planKey],
  );

  const getConflictPlan = useCallback((error: unknown) => {
    if (!(error instanceof AuthApiError) || error.status !== 409) return null;
    const details = error.details;
    if (!details || typeof details !== "object" || !("servicePlan" in details)) {
      return null;
    }
    const latestPlan = details.servicePlan;
    return latestPlan && typeof latestPlan === "object"
      ? latestPlan as ServicePlan
      : null;
  }, []);

  const autosave = useServicePlanAutosave({
    enabled: Boolean(canEdit && churchId && sections),
    resetKey: planKey,
    changeVersion: draftChangeVersion,
    baseRevision: plan?.revision || 0,
    buildPayload: buildAutosavePayload,
    save: saveAutosavePayload,
    getConflictPlan,
    onSaved: (savedPlan) => {
      // Defence in depth alongside the hook's generation guard: this editor
      // stays mounted across prev/next, so a late response could otherwise
      // describe a plan the operator has already navigated away from.
      if (savedPlan.planKey && savedPlan.planKey !== planKey) return;
      setPlan(savedPlan);
      rememberAssignmentHistory(savedPlan.sections);
    },
    onConflict: (latestPlan) => {
      if (latestPlan.planKey && latestPlan.planKey !== planKey) return;
      setConflictPlan(latestPlan);
    },
  });

  // Clean editors follow remote plan changes. Local edits are never silently
  // replaced; the server's revision check turns that situation into a conflict.
  useTeamsLiveSync(churchId, (event) => {
    if (!isServicePlanUpdatedEvent(event)) return;
    const { servicePlan } = event;
    if (servicePlan.planKey !== planKey) return;
    if ((servicePlan.revision ?? 0) === (plan?.revision ?? 0)) {
      // Publishing and live-progress changes share the same document but do
      // not alter editable plan content. Keep those controls current without
      // turning a local text edit into a content conflict.
      setPlan((current) => current ? {
        ...current,
        published: servicePlan.published,
        publicLive: servicePlan.publicLive,
        updatedAt: servicePlan.updatedAt,
      } : current);
      return;
    }
    if (autosave.state !== "saved") {
      setConflictPlan(servicePlan);
      return;
    }
    setPlan(servicePlan);
    setSections(servicePlan.sections);
    setPlanName(servicePlan.name || occurrence.name || "");
    setSourceImport(servicePlan.sourceImport);
    autosave.acceptRemoteRevision(servicePlan);
  });

  useEffect(() => {
    if (autosave.state === "saved") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [autosave.state]);

  const reloadConflictPlan = () => {
    if (!conflictPlan) return;
    setPlan(conflictPlan);
    setSections(conflictPlan.sections);
    setPlanName(conflictPlan.name || occurrence.name || "");
    setSourceImport(conflictPlan.sourceImport);
    setConflictPlan(null);
    autosave.acceptRemoteRevision(conflictPlan);
  };

  const startFromScratch = () => {
    updateDraftSections(createEmptyServicePlanSections());
    updateDraftName(occurrence.name || service.name || "");
    setIsEditing(true);
  };

  const handleImportFromServicePlanning = async () => {
    const trimmedUrl = importUrl.trim();
    if (!trimmedUrl) return;
    setImporting(true);
    try {
      const data = await getServicePlanningImportDataFromUrl(trimmedUrl);
      const importedSections = buildServicePlanSectionsFromImport(data, allSongDocs);
      const hasElements = importedSections.some((section) => section.elements.length > 0);
      const hasSourceTiming = importedSections.some((section) =>
        section.elements.some((element) => Boolean(element.startTime)),
      );
      updateDraftSections(
        // Preserve the source's actual schedule when the printout provides
        // it. Older printouts without time columns still receive our normal
        // occurrence-time anchor as a useful starting point.
        hasElements && !hasSourceTiming
          ? applyPlanAnchorStartTime(importedSections, occurrenceLocalTime(occurrence.startsAt, planTimezone))
          : importedSections,
      );
      // The occurrence being planned names the plan — the imported source's
      // own plan label (its own date/service, not necessarily this one) is
      // provenance info only, kept on sourceImport.planLabel, never the name.
      updateDraftName(occurrence.name || service.name || "");
      setSourceImport(buildServicePlanSourceImport(data, trimmedUrl));
      markDraftChanged();
      setShowImport(false);
      setImportUrl("");
      setIsEditing(true);
      showToast("Imported from Service Planning — review before saving.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not import from Service Planning.");
    } finally {
      setImporting(false);
    }
  };

  const handleAddElement = (sectionId: string) => {
    if (!sections) return;
    const isFirstElementOverall = sections.every((s) => s.elements.length === 0);
    let next = addElement(sections, sectionId);
    if (isFirstElementOverall) {
      const anchor = occurrenceLocalTime(occurrence.startsAt, planTimezone);
      const newElement = next
        .find((s) => s.id === sectionId)
        ?.elements.slice(-1)[0];
      if (newElement) {
        next = applyPlanAnchorStartTime(
          updateElement(next, sectionId, newElement.id, {
            startTime: anchor,
            durationSeconds: 0,
            durationMinutes: 0,
          }),
          anchor,
        );
      }
    }
    updateDraftSections(next);
  };

  const ensurePublishedUrls = async (): Promise<ServicePlanPublicUrls | null> => {
    if (!churchId || !planKey || !plan) return null;
    if (plan.published && publicUrls?.team) return publicUrls;
    if (!(await autosave.flush())) return null;
    const result = await publishServicePlan(churchId, planKey);
    setPlan(result.servicePlan);
    const urls = urlsFromPublishResult(result);
    setPublicUrls(urls);
    return urls;
  };

  const sharePlanLink = async (
    kind: "detailed" | "simple",
    action: "copy" | "view",
  ) => {
    if (!churchId || !planKey || !plan) return;
    setPublishing(true);
    try {
      const urls = await ensurePublishedUrls();
      if (!urls?.team) {
        showToast("Could not get a share link. Try again.", "error");
        return;
      }
      const url =
        kind === "detailed" ? urls.team : urls.general || urls.team;
      const label = kind === "detailed" ? "Detailed view" : "Simple view";
      if (action === "view") {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      try {
        await navigator.clipboard?.writeText(url);
        showToast(`${label} link copied.`, "success");
      } catch {
        showToast(`${label} link is ready. Use Plan actions to copy it again.`, "success");
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not publish this service plan.");
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!churchId || !planKey || !plan) return;
    setPublishing(true);
    try {
      const result = await unpublishServicePlan(churchId, planKey);
      setPlan(result.servicePlan);
      setPublicUrls(null);
      showToast("Shared links disabled.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not unpublish this service plan.");
    } finally {
      setPublishing(false);
    }
  };

  const handleMakePublicLive = async (elementId: string) => {
    if (!churchId || !planKey || !plan) return;
    setUpdatingPublicLive(true);
    try {
      const result = await updateServicePlanPublicLive(churchId, planKey, {
        mode: "manual",
        currentElementId: elementId,
      });
      setPlan(result.servicePlan);
      showToast("Detailed and simple views are on this item.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update shared service progress.");
    } finally {
      setUpdatingPublicLive(false);
    }
  };

  const handleResumePublicSchedule = async () => {
    if (!churchId || !planKey || !plan) return;
    setUpdatingPublicLive(true);
    try {
      const result = await updateServicePlanPublicLive(churchId, planKey, {
        mode: "schedule",
      });
      setPlan(result.servicePlan);
      showToast("Detailed and simple views are following the schedule.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update shared service progress.");
    } finally {
      setUpdatingPublicLive(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!canEdit || !isEditing || !over || active.id === over.id || !sections) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (
      activeId.startsWith(SECTION_ID_PREFIX) &&
      overId.startsWith(SECTION_ID_PREFIX)
    ) {
      const ids = sections.map((section) => sectionDndId(section.id));
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reorderedIds = arrayMove(ids, oldIndex, newIndex).map((id) =>
        id.slice(SECTION_ID_PREFIX.length),
      );
      updateDraftSections(reorderSections(sections, reorderedIds));
      return;
    }

    if (
      activeId.startsWith(ELEMENT_ID_PREFIX) &&
      overId.startsWith(ELEMENT_ID_PREFIX)
    ) {
      const rawActiveId = activeId.slice(ELEMENT_ID_PREFIX.length);
      const rawOverId = overId.slice(ELEMENT_ID_PREFIX.length);
      const owningSection = sections.find((section) =>
        section.elements.some((element) => element.id === rawActiveId),
      );
      // Cross-section drag reorder isn't supported — use "Move to section" instead.
      if (!owningSection || !owningSection.elements.some((element) => element.id === rawOverId)) {
        return;
      }
      const ids = owningSection.elements.map((element) => element.id);
      const oldIndex = ids.indexOf(rawActiveId);
      const newIndex = ids.indexOf(rawOverId);
      if (oldIndex === -1 || newIndex === -1) return;
      updateDraftSections(
        reorderElementsInSection(
          sections,
          owningSection.id,
          arrayMove(ids, oldIndex, newIndex),
        ),
      );
    }
  };

  const sectionIds = (sections || []).map((section) => sectionDndId(section.id));
  const anchorStartTime = sections?.[0]?.elements?.[0]?.startTime || "";
  const occurrenceTiming = formatOccurrenceRowLabel(
    occurrence,
    getSharedOccurrenceTiming([occurrence]),
  );
  // Starter actions stay available both before a plan exists and after every
  // section has been removed. A fresh "Start from scratch" draft still has one
  // empty section, so it does not bounce back into this empty state.
  const hasSections = Boolean(sections && sections.length > 0);
  const isEmpty = !loading && !hasSections;
  const showChrome = Boolean(onBack);
  const publicSharingEnabled = Boolean(plan?.published);
  const isServiceDay = isOccurrenceOnCalendarDay(occurrence, planTimezone);
  const isManualLive = isServicePlanManualLive(plan);
  const liveElementId =
    plan && sections
      ? getServicePlanLiveElementId({ ...plan, sections }, nowMs)
      : null;
  const shareActionsDisabled = !canEdit || publishing || !hasSections;

  const shareViewActions = (
    kind: "detailed" | "simple",
    label: string,
  ) => (
    <div className="space-y-1.5 px-2 py-1.5">
      <DropdownMenuLabel className="p-0 text-xs font-medium text-gray-300">
        {label}
      </DropdownMenuLabel>
      <ButtonGroup className="w-full border-gray-500" display="flex">
        <ButtonGroupItem
          type="button"
          iconSize="sm"
          svg={Copy}
          disabled={shareActionsDisabled}
          className="max-md:min-h-0"
          aria-label={`Copy ${label.toLowerCase()} link`}
          onClick={() => {
            setPlanActionsOpen(false);
            void sharePlanLink(kind, "copy");
          }}
        >
          Copy
        </ButtonGroupItem>
        <ButtonGroupItem
          type="button"
          iconSize="sm"
          svg={ExternalLink}
          disabled={shareActionsDisabled}
          className="max-md:min-h-0"
          aria-label={`View ${label.toLowerCase()}`}
          onClick={() => {
            setPlanActionsOpen(false);
            void sharePlanLink(kind, "view");
          }}
        >
          View
        </ButtonGroupItem>
      </ButtonGroup>
    </div>
  );

  const shareMenu =
    plan || hasSections ? (
      <DropdownMenu open={planActionsOpen} onOpenChange={setPlanActionsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            svg={MoreHorizontal}
            iconSize="sm"
            className="max-md:min-h-0"
            disabled={publishing}
            aria-label={publishing ? "Updating plan actions" : "Plan actions"}
            aria-haspopup="menu"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {hasSections ? (
            <>
              <DropdownMenuCheckboxItem
                checked={hideNotes}
                onCheckedChange={(checked) => setHideNotes(Boolean(checked))}
              >
                Hide notes
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator className="my-1 bg-gray-600" />
            </>
          ) : null}
          <DropdownMenuItem
            disabled={!canEdit || !hasSections}
            onSelect={() => setTemplateModal("save")}
          >
            Save as template
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-gray-600" />
          {shareViewActions("detailed", "Detailed view")}
          {shareViewActions("simple", "Simple view")}
          {publicSharingEnabled ? (
            <>
              <DropdownMenuSeparator className="my-1 bg-gray-600" />
              <DropdownMenuItem
                variant="destructive"
                disabled={!canEdit || publishing}
                onSelect={() => {
                  void handleUnpublish();
                }}
              >
                Disable shared links
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/70">
      {showChrome || plan || hasSections ? (
        <header className="shrink-0 space-y-2 border-b border-gray-800 px-3 py-2">
          {showChrome ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="tertiary"
                svg={ArrowLeft}
                iconSize="sm"
                className="max-md:min-h-0"
                onClick={onBack}
              >
                {backLabel}
              </Button>
              {planNavigation ? (
                <div
                  className="flex shrink-0 items-center gap-1"
                  role="group"
                  aria-label="Plan navigation"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    svg={ChevronLeft}
                    iconSize="sm"
                    className="max-md:min-h-0"
                    aria-label="Previous plan"
                    disabled={!planNavigation.onPrevious}
                    onClick={planNavigation.onPrevious}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    svg={ChevronRight}
                    iconSize="sm"
                    className="max-md:min-h-0"
                    aria-label="Next plan"
                    disabled={!planNavigation.onNext}
                    onClick={planNavigation.onNext}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-gray-50 sm:text-lg">
                {occurrence.name || service.name}
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">{occurrenceTiming}</p>
            </div>
            {plan || hasSections || headerActions ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {headerActions}
                {canEdit && hasSections ? (
                  <Button
                    type="button"
                    variant={isEditing ? "secondary" : "primary"}
                    svg={isEditing ? undefined : Pencil}
                    iconSize="sm"
                    className="max-md:min-h-0"
                    onClick={() => setIsEditing((prev) => !prev)}
                  >
                    {isEditing ? "Done" : "Edit"}
                  </Button>
                ) : null}
                {shareMenu}
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3">
        {loading ? <p className="text-sm text-gray-400">Loading plan…</p> : null}

        {!loading && isEmpty && canEdit ? (
          <div
            className={cn(
              "flex flex-col gap-3",
              showChrome &&
              "flex-1 items-center justify-center rounded-lg border border-dashed border-gray-700 bg-black/20 px-4 py-8 text-center",
            )}
          >
            {showChrome ? (
              <>
                <p className="text-sm font-medium text-gray-200">
                  {plan ? "This plan is empty" : "No plan yet"}
                </p>
                <p className="max-w-md text-sm text-gray-400">
                  Start from a saved template, build from a blank plan, or
                  import one from Service Planning.
                </p>
              </>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => setTemplateModal("apply")}>
                Apply a template
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={startFromScratch}
              >
                Start from scratch
              </Button>
              <Popover open={showImport} onOpenChange={setShowImport}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    isSelected={showImport}
                    aria-expanded={showImport}
                    aria-haspopup="dialog"
                  >
                    Import from Service Planning
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="center"
                  sideOffset={8}
                  className="w-[min(24rem,calc(100vw-2rem))] border border-gray-700 bg-gray-900 p-3 text-white shadow-xl"
                >
                  <div className="flex flex-col gap-2 text-left">
                    <Input
                      label="Planning URL"
                      placeholder="https://..."
                      value={importUrl}
                      disabled={importing}
                      onChange={(value) => setImportUrl(String(value))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleImportFromServicePlanning();
                        }
                      }}
                    />
                    <p className="text-xs text-gray-400">
                      Sections and items are imported as a starting point — review
                      and edit everything before saving.
                    </p>
                    <Button
                      type="button"
                      onClick={() => void handleImportFromServicePlanning()}
                      disabled={importing || !importUrl.trim()}
                    >
                      {importing ? "Importing…" : "Import plan"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        ) : null}
        {isEmpty && !canEdit ? (
          <p className="text-xs text-gray-500">
            You don&apos;t have permission to create a plan for this service.
          </p>
        ) : null}

        {hasSections && sections ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
                <div className="scrollbar-variable min-h-0 flex-1 space-y-2 overflow-y-auto">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                    {isEditing ? (
                      <>
                        <Input
                          label="Plan name"
                          className="min-w-0 w-full sm:max-w-md sm:flex-1"
                          value={planName}
                          disabled={!canEdit}
                          onChange={(value) => updateDraftName(String(value))}
                        />
                        <TimePicker
                          label="Service start time"
                          labelLayout="stacked"
                          className="w-full shrink-0 sm:w-40"
                          value={anchorStartTime}
                          disabled={!canEdit || sections.every((s) => s.elements.length === 0)}
                          onChange={(value) =>
                            value && updateDraftSections(applyPlanAnchorStartTime(sections, String(value)))
                          }
                        />
                      </>
                    ) : (
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-100">
                          {planName.trim() || occurrence.name || service.name}
                        </p>
                        {anchorStartTime ? (
                          <p className="mt-0.5 text-xs text-gray-400">
                            Starts {formatPlanStartTimeDisplay(anchorStartTime)}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {sections.map((section) => (
                    <SortableSectionCard
                      key={section.id}
                      section={section}
                      sections={sections}
                      canEdit={canEdit}
                      isEditing={isEditing}
                      onRename={(name) =>
                        updateDraftSections(renameSection(sections, section.id, name))
                      }
                      onRemove={() =>
                        updateDraftSections(removeSection(sections, section.id))
                      }
                      onAddElement={() => handleAddElement(section.id)}
                      onRemoveElement={(elementId) =>
                        updateDraftSections(removeElement(sections, section.id, elementId))
                      }
                      onUpdateElement={(elementId, changes) =>
                        updateDraftSections(
                          updateElement(sections, section.id, elementId, changes),
                        )
                      }
                      assignedToHistoryValues={assignedToSuggestions}
                      onElementDurationChange={(elementId, durationSeconds) =>
                        updateDraftSections(
                          applyElementDurationSecondsChange(
                            sections,
                            elementId,
                            durationSeconds,
                          ),
                        )
                      }
                      onElementStartTimeChange={(elementId, time) =>
                        updateDraftSections(
                          applyElementStartTimeChange(sections, elementId, time),
                        )
                      }
                      publicSharingEnabled={publicSharingEnabled}
                      isServiceDay={isServiceDay}
                      liveElementId={liveElementId}
                      isManualLive={isManualLive}
                      publicLiveBusy={updatingPublicLive}
                      onMakePublicLive={handleMakePublicLive}
                      onResumePublicSchedule={handleResumePublicSchedule}
                      hideNotes={hideNotes}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Autosave state is rendered in the toolbar below.
              <div
                className={cn(
                  "hidden flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  autosave.state === "conflict"
                    ? "border-amber-700/70 bg-amber-950/30 text-amber-100"
                    : autosave.state === "error"
                      ? "border-red-800/70 bg-red-950/30 text-red-100"
                      : "border-slate-700 bg-slate-900/70 text-slate-300",
                )}
                role={autosave.state === "error" || autosave.state === "conflict" ? "alert" : "status"}
              >
                {autosave.state === "dirty" ? "Changes waiting to save." : null}
                {autosave.state === "saving" ? "Saving changes…" : null}
                {autosave.state === "retrying" ? "Could not save. Retrying…" : null}
                {autosave.state === "error" ? "Could not save your changes." : null}
                {autosave.state === "conflict" ? "Another editor changed this plan." : null}
                {autosave.state === "error" ? (
                  <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={autosave.retry}>
                    Retry
                  </Button>
                ) : null}
                {autosave.state === "conflict" ? (
                  <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={reloadConflictPlan}>
                    Reload latest
                  </Button>
                ) : null}
              </div>
            */}

            <div className="flex shrink-0 flex-wrap gap-2">
              {canEdit && isEditing ? (
                <Button
                  type="button"
                  variant="tertiary"
                  svg={Plus}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  onClick={() => updateDraftSections(addSection(sections))}
                >
                  Add section
                </Button>
              ) : null}
              <div
                className={cn(
                  "ml-auto flex min-h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium",
                  autosave.state === "conflict"
                    ? "bg-amber-950/50 text-amber-100"
                    : autosave.state === "error"
                      ? "bg-red-950/50 text-red-100"
                      : "text-gray-400",
                )}
                role={autosave.state === "error" || autosave.state === "conflict" ? "alert" : "status"}
                aria-live="polite"
              >
                {autosave.state === "saved" ? "Synced" : null}
                {autosave.state === "dirty" ? "Saving soon" : null}
                {autosave.state === "saving" ? "Saving…" : null}
                {autosave.state === "retrying" ? "Retrying save…" : null}
                {autosave.state === "error" ? "Could not save" : null}
                {autosave.state === "conflict" ? "Plan changed elsewhere" : null}
                {autosave.state === "error" ? (
                  <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={autosave.retry}>
                    Retry
                  </Button>
                ) : null}
                {autosave.state === "conflict" ? (
                  <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={reloadConflictPlan}>
                    Reload latest
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {templateModal && churchId ? (
        <ServicePlanTemplateModal
          mode={templateModal}
          churchId={churchId}
          serviceId={service.serviceId}
          serviceName={service.name}
          sections={sections || []}
          onClose={() => setTemplateModal(null)}
          onApply={(templateSections) => {
            updateDraftSections(templateSections);
            if (!planName) updateDraftName(occurrence.name || service.name || "");
            setIsEditing(true);
          }}
        />
      ) : null}
    </div>
  );
};

export default ServicePlanEditor;
