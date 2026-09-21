import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, GripVertical, MoreHorizontal, Trash2, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AnimateCollapse from "../../components/AnimateCollapse/AnimateCollapse";
import { Button } from "../../components/Button";
import DebouncedInput from "../../components/DebouncedInput/DebouncedInput";
import ExpandCollapseChevronButton from "../../components/ExpandCollapseChevronButton/ExpandCollapseChevronButton";
import { cn } from "@/utils/cnHelper";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import ServicePlanAssigneeList from "./ServicePlanAssigneeList";
import ServicePlanContentPanel from "./ServicePlanContentPanel";
import ServicePlanSongDetailsPanel from "./ServicePlanSongDetailsPanel";
import ServicePlanElementRow, {
  elementDndId,
  ServicePlanElementColumnHeader,
  SERVICE_PLAN_INLINE_INPUT_CLASS,
  SERVICE_PLAN_COL,
  formatPlanStartTimeDisplay,
  type ServicePlanRoleNoteOption,
  type ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import {
  SERVICE_PLAN_ELEMENT_DND_PREFIX,
  SERVICE_PLAN_SECTION_DND_PREFIX,
  commitServicePlanElementDrag,
  pointerYFromDragEvent,
  previewServicePlanSections,
  resolveServicePlanElementPlacement,
  servicePlanCollisionDetection,
  servicePlanElementPlacementsEqual,
  type ServicePlanElementPlacement,
  useServicePlanSensors,
} from "./servicePlanDnd";
import {
  removeSection,
  renameSection,
  reorderSections,
  updateElement,
} from "./servicePlanDraftUtils";
import {
  applyElementDurationSecondsChange,
  applyElementRemoval,
  applyElementStartTimeChange,
  applyPlanAnchorStartTime,
} from "./servicePlanTimingUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import { Sheet, SheetContent, SheetTitle } from "../../components/ui/sheet";
import type {
  ServicePlanSection,
  ServicePlanSongReference,
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
  ServicePlanAssignee,
} from "../../types/servicePlan";
import { getServicePlanElementAssignees, getServicePlanElementLead } from "../../types/servicePlan";
import { richTextToPlainText } from "../../types/richText";
import type { TeamsAssignmentSummaryRow } from "../Teams/pages/teamsAssignmentsSummary";
import type { DBItem } from "../../types";

export const sectionDndId = (sectionId: string) =>
  `${SERVICE_PLAN_SECTION_DND_PREFIX}${sectionId}`;

export const servicePlanSectionDomId = (sectionId: string) =>
  `service-plan-section-${sectionId}`;

export type ServicePlanSelection = {
  sectionId: string;
  elementId?: string;
};

const EMPTY_RESOLVED_SONG_REFS: ReadonlyMap<string, ServicePlanSongReference[]> =
  new Map();

/**
 * Per-row state the plan editor derives from a dated occurrence's live
 * progress. Templates have no date, so they simply omit all of it.
 */
type ServicePlanLiveRowState = {
  /** True on the calendar day of the occurrence (in the plan timezone). */
  isServiceDay?: boolean;
  liveElementId?: string | null;
  isManualLive?: boolean;
  isTimelineAdjusted?: boolean;
  adjustedStartTimes?: ReadonlyMap<string, string>;
  liveStartedAtLabel?: string | null;
  publicLiveBusy?: boolean;
  onMakePublicLive?: (elementId: string) => void;
};

type SortableSectionCardProps = ServicePlanLiveRowState & {
  section: ServicePlanSection;
  canEdit: boolean;
  isEditing: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  isSelected: boolean;
  selectedElementId?: string;
  onSelectSection: () => void;
  onSelectElement: (elementId: string) => void;
  onRemoveElement: (elementId: string) => void;
  onUpdateElement: (
    elementId: string,
    changes: Parameters<typeof updateElement>[3],
    coalesceKey?: string,
  ) => void;
  onElementDurationChange: (elementId: string, durationSeconds: number) => void;
  onElementStartTimeChange: (elementId: string, time: string) => void;
  assignedToHistoryValues: string[];
  onRemoveAssignedToHistoryValue?: (value: string) => void;
  isAssignedToHistoryValueRemovable?: (value: string) => boolean;
  roleNoteOptions: ServicePlanRoleNoteOption[];
  scheduledPositionOptions: ServicePlanRoleNoteOption[];
  teamNoteOptions: ServicePlanTeamNoteOption[];
  microphones: ServicePlanMicrophone[];
  microphoneAudiences?: ServicePlanMicrophoneAudience[];
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
  scheduledAssignmentRows?: TeamsAssignmentSummaryRow[];
  onOpenScheduledAssignment?: (row: TeamsAssignmentSummaryRow) => void;
  /** Local view preference: hide shared and team notes on every element. */
  hideNotes?: boolean;
  /** Empty string = all teams; otherwise only team notes with this label. */
  teamNotesFilter?: string;
  /** Empty string = all roles; otherwise only notes for this position. */
  roleNotesFilter?: string;
  onViewSongLyrics?: (songRef: ServicePlanSongReference) => void;
  canCreateLibrarySong?: boolean;
  onCreatePendingSong?: (
    songRef: Extract<ServicePlanSongReference, { kind: "pending" }>,
  ) => void;
  /** Elements whose stored song reference is out of date — see
   * servicePlanSongResolution.ts. Absent means the stored one still stands. */
  resolvedSongRefs: ReadonlyMap<string, ServicePlanSongReference[]>;
  /** See ServicePlanSectionListProps.structureOnly. */
  structureOnly?: boolean;
  sectionLabelColor: string;
  sectionBorderColor: string;
  onOpenAssignment: (elementId: string, trigger?: HTMLElement) => void;
  onOpenContent: (elementId: string, trigger?: HTMLElement) => void;
  onOpenSongDetails: (
    elementId: string,
    songRef: ServicePlanSongReference,
  ) => void;
  /** When an item is dragging, section cards must not also translate — the preview array is the layout. */
  lockSortableLayout?: boolean;
};

const SortableSectionCard = ({
  section,
  canEdit,
  isEditing,
  onRename,
  onRemove,
  isSelected,
  selectedElementId,
  onSelectSection,
  onSelectElement,
  onRemoveElement,
  onUpdateElement,
  onElementDurationChange,
  onElementStartTimeChange,
  assignedToHistoryValues,
  onRemoveAssignedToHistoryValue,
  isAssignedToHistoryValueRemovable,
  roleNoteOptions,
  scheduledPositionOptions,
  teamNoteOptions,
  microphones,
  microphoneAudiences,
  scheduledMicrophoneHolders,
  scheduledAssignmentRows,
  onOpenScheduledAssignment,
  isServiceDay = false,
  liveElementId = null,
  isManualLive = false,
  isTimelineAdjusted = false,
  adjustedStartTimes,
  liveStartedAtLabel = null,
  publicLiveBusy = false,
  onMakePublicLive,
  hideNotes = false,
  teamNotesFilter = "",
  roleNotesFilter = "",
  onViewSongLyrics,
  canCreateLibrarySong = false,
  onCreatePendingSong,
  resolvedSongRefs,
  structureOnly = false,
  sectionLabelColor,
  sectionBorderColor,
  onOpenAssignment,
  onOpenContent,
  onOpenSongDetails,
  lockSortableLayout = false,
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

  useEffect(() => {
    if (isEditing || !liveElementId) return;
    if (section.elements.some((element) => element.id === liveElementId)) {
      setIsExpanded(true);
    }
  }, [isEditing, liveElementId, section.elements]);

  const elementIds = section.elements.map((element) => elementDndId(element.id));

  return (
    <section
      id={servicePlanSectionDomId(section.id)}
      ref={setNodeRef}
      className="overflow-hidden rounded-lg border border-gray-700/80 border-l-2 bg-gray-950/40"
      style={{
        transform: lockSortableLayout ? undefined : CSS.Transform.toString(transform),
        transition: lockSortableLayout ? undefined : transition,
        opacity: isDragging ? 0.6 : undefined,
        borderLeftColor: sectionBorderColor,
      }}
    >
      <div
        className={cn(
          "flex items-center gap-1 border-b border-gray-700/80 bg-gray-950/95 px-1.5 py-0.5",
          isSelected && "bg-cyan-950/50",
        )}
        onClick={onSelectSection}
      >
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
          <DebouncedInput
            label="Section name"
            hideLabel
            value={section.name}
            onChange={onRename}
            className="min-w-0 flex-1"
            inputClassName={cn(
              SERVICE_PLAN_INLINE_INPUT_CLASS,
              "h-6 border-gray-800/60 bg-gray-950/80 text-xs font-semibold text-gray-100",
            )}
            style={{ color: sectionLabelColor }}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate px-1 text-xs font-semibold max-md:text-sm" style={{ color: sectionLabelColor }}>
            {section.name.trim() || "Untitled section"}
          </h3>
        )}
        {allowEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="tertiary" iconSize="sm" className="max-md:min-h-0" svg={MoreHorizontal} aria-label={`More tools for ${section.name || "section"}`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRemove} className="text-red-200">
                <Trash2 className="size-4" aria-hidden /> Remove section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <AnimateCollapse open={isExpanded}>
        <div>
          <SortableContext items={elementIds} strategy={verticalListSortingStrategy}>
            <div>
              {section.elements.map((element, elementIndex) => (
                <ServicePlanElementRow
                  key={element.id}
                  element={element}
                  canEdit={canEdit}
                  isEditing={isEditing}
                  isSelected={selectedElementId === element.id}
                  onSelect={() => onSelectElement(element.id)}
                  onRemove={() => onRemoveElement(element.id)}
                  onUpdate={(changes, coalesceKey) =>
                    onUpdateElement(element.id, changes, coalesceKey)
                  }
                  onDurationChange={(durationSeconds) =>
                    onElementDurationChange(element.id, durationSeconds)
                  }
                  onStartTimeChange={(time) => onElementStartTimeChange(element.id, time)}
                  assignedToHistoryValues={assignedToHistoryValues}
                  onRemoveAssignedToHistoryValue={onRemoveAssignedToHistoryValue}
                  isAssignedToHistoryValueRemovable={isAssignedToHistoryValueRemovable}
                  toneIndex={elementIndex}
                  isServiceDay={isServiceDay}
                  isLive={liveElementId === element.id}
                  isManualLive={isManualLive && liveElementId === element.id}
                  isAdjustedLive={isTimelineAdjusted && liveElementId === element.id}
                  adjustedStartTime={adjustedStartTimes?.get(element.id)}
                  liveStartedAtDescription={
                    liveElementId === element.id ? liveStartedAtLabel || undefined : undefined
                  }
                  publicLiveBusy={publicLiveBusy}
                  onMakePublicLive={
                    onMakePublicLive
                      ? () => onMakePublicLive(element.id)
                      : undefined
                  }
                  hideNotes={hideNotes}
                  teamNotesFilter={teamNotesFilter}
                  roleNotesFilter={roleNotesFilter}
                  roleNoteOptions={roleNoteOptions}
                  teamNoteOptions={teamNoteOptions}
                  microphones={microphones}
                  microphoneAudiences={microphoneAudiences}
                  scheduledMicrophoneHolders={scheduledMicrophoneHolders}
                  scheduledAssignmentRows={scheduledAssignmentRows}
                  onOpenScheduledAssignment={onOpenScheduledAssignment}
                  onViewSongLyrics={onViewSongLyrics}
                  canCreateLibrarySong={canCreateLibrarySong}
                  onCreatePendingSong={onCreatePendingSong}
                  resolvedSongRefs={resolvedSongRefs.get(element.id)}
                  structureOnly={structureOnly}
                  onOpenAssignment={(trigger) => onOpenAssignment(element.id, trigger)}
                  onOpenContent={(trigger) => onOpenContent(element.id, trigger)}
                  onOpenSongDetails={(songRef) => onOpenSongDetails(element.id, songRef)}
                />
              ))}
            </div>
          </SortableContext>
        </div>
      </AnimateCollapse>
    </section>
  );
};

type ServicePlanSectionListProps = ServicePlanLiveRowState & {
  sections: ServicePlanSection[];
  canEdit: boolean;
  isEditing: boolean;
  /**
   * The single funnel for every structural edit. `coalesceKey` names the field
   * being edited so a typing burst collapses into one undo step — see
   * useServicePlanDraftHistory.
   */
  onSectionsChange: (next: ServicePlanSection[], coalesceKey?: string) => void;
  selection?: ServicePlanSelection | null;
  onSelectionChange?: (selection: ServicePlanSelection) => void;
  assignedToHistoryValues?: string[];
  onRemoveAssignedToHistoryValue?: (value: string) => void;
  isAssignedToHistoryValueRemovable?: (value: string) => boolean;
  roleNoteOptions?: ServicePlanRoleNoteOption[];
  scheduledPositionOptions?: ServicePlanRoleNoteOption[];
  teamNoteOptions?: ServicePlanTeamNoteOption[];
  microphones?: ServicePlanMicrophone[];
  microphoneAudiences?: ServicePlanMicrophoneAudience[];
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
  scheduledAssignmentRows?: TeamsAssignmentSummaryRow[];
  onOpenScheduledAssignment?: (row: TeamsAssignmentSummaryRow) => void;
  hideNotes?: boolean;
  teamNotesFilter?: string;
  roleNotesFilter?: string;
  onViewSongLyrics?: (songRef: ServicePlanSongReference) => void;
  canCreateLibrarySong?: boolean;
  onCreatePendingSong?: (
    songRef: Extract<ServicePlanSongReference, { kind: "pending" }>,
  ) => void;
  resolvedSongRefs?: ReadonlyMap<string, ServicePlanSongReference[]>;
  /**
   * Structure-only surfaces (templates) drop the per-week columns — song and
   * scripture attachments, and "Assigned to" — because a template deliberately
   * carries none of them (see cloneSectionsForTemplate).
   */
  structureOnly?: boolean;
  /** Id on the scroll container, so a caller can scroll a row into view. */
  scrollId?: string;
  ariaLabel?: string;
  sectionLabelColor?: string;
  sectionBorderColor?: string;
  /** Rendered above the sections, inside the same scroll container. */
  header?: ReactNode;
  /** Validated church colors; fall back to the WorshipSync palette. */
  onOpenAssignment?: (elementId: string, trigger?: HTMLElement) => void;
  onOpenContent?: (elementId: string, trigger?: HTMLElement) => void;
  allSongDocs?: DBItem[];
};

/**
 * The scrollable, drag-reorderable list of plan sections and their items.
 *
 * Shared by the dated-plan editor (ServicePlanEditor) and the template editor
 * (ServicePlanTemplateEditor) so both surfaces build an order of service the
 * same way — the difference is only which per-week columns are offered and
 * what wraps the list.
 */
const ServicePlanSectionList = ({
  sections,
  canEdit,
  isEditing,
  onSectionsChange,
  selection = null,
  onSelectionChange,
  assignedToHistoryValues = [],
  onRemoveAssignedToHistoryValue,
  isAssignedToHistoryValueRemovable,
  roleNoteOptions = [],
  scheduledPositionOptions = roleNoteOptions,
  teamNoteOptions = [],
  microphones = [],
  microphoneAudiences,
  scheduledMicrophoneHolders,
  scheduledAssignmentRows,
  onOpenScheduledAssignment,
  hideNotes = false,
  teamNotesFilter = "",
  roleNotesFilter = "",
  onViewSongLyrics,
  canCreateLibrarySong = false,
  onCreatePendingSong,
  resolvedSongRefs = EMPTY_RESOLVED_SONG_REFS,
  structureOnly = false,
  scrollId,
  ariaLabel = "Service plan",
  sectionLabelColor = "#f97316",
  sectionBorderColor = "#f97316",
  header,
  onOpenAssignment: onOpenAssignmentProp,
  onOpenContent: onOpenContentProp,
  allSongDocs = [],
  ...liveRowState
}: ServicePlanSectionListProps) => {
  const sensors = useServicePlanSensors();
  const isDesktopPanel = useMediaQuery("(min-width: 1280px)");
  const sectionIds = sections.map((section) => sectionDndId(section.id));
  const selectedSectionId = selection?.sectionId || null;
  const selectedElementId = selection?.elementId || null;
  const [assignmentPanelElementId, setAssignmentPanelElementId] = useState<string | null>(null);
  const [contentPanelElementId, setContentPanelElementId] = useState<string | null>(null);
  const [isScriptureAttachMode, setIsScriptureAttachMode] = useState(false);
  const [isResourceEditorMode, setIsResourceEditorMode] = useState(false);
  const [songDetailsRef, setSongDetailsRef] = useState<{
    elementId: string;
    songRef: ServicePlanSongReference;
  } | null>(null);
  const [songDetailsEditing, setSongDetailsEditing] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [elementPlacement, setElementPlacement] =
    useState<ServicePlanElementPlacement | null>(null);
  const elementPlacementRef = useRef<ServicePlanElementPlacement | null>(null);
  const planListRef = useRef<HTMLDivElement | null>(null);
  const setDragElementPlacement = (
    next: ServicePlanElementPlacement | null,
  ) => {
    elementPlacementRef.current = next;
    setElementPlacement(next);
  };
  const clearDragState = () => {
    setActiveDragId(null);
    setDragElementPlacement(null);
  };
  const activeElementId = activeDragId?.startsWith(SERVICE_PLAN_ELEMENT_DND_PREFIX)
    ? activeDragId.slice(SERVICE_PLAN_ELEMENT_DND_PREFIX.length)
    : null;
  const displayedSections = useMemo(
    () =>
      activeElementId
        ? previewServicePlanSections(sections, activeElementId, elementPlacement)
        : sections,
    [activeElementId, elementPlacement, sections],
  );
  const lockSectionSortableLayout = Boolean(activeElementId);
  const assignmentPanelTriggerRef = useRef<HTMLElement | null>(null);
  const assignmentPanelElement = assignmentPanelElementId
    ? sections.flatMap((section) => section.elements).find(
      (element) => element.id === assignmentPanelElementId,
    )
    : undefined;
  const contentPanelElement = contentPanelElementId
    ? sections.flatMap((section) => section.elements).find(
      (element) => element.id === contentPanelElementId,
    )
    : undefined;
  const assignmentPanelSection = assignmentPanelElement
    ? sections.find((section) =>
      section.elements.some((element) => element.id === assignmentPanelElement.id),
    )
    : undefined;
  const resetItemSpecificPanel = useCallback(() => {
    setAssignmentPanelElementId(null);
    setContentPanelElementId(null);
    setIsScriptureAttachMode(false);
    setIsResourceEditorMode(false);
    setSongDetailsRef(null);
    setSongDetailsEditing(false);
    assignmentPanelTriggerRef.current = null;
  }, []);
  useEffect(() => {
    const elementIds = new Set(
      sections.flatMap((section) => section.elements).map((element) => element.id),
    );
    const activePanelElementId =
      assignmentPanelElementId || contentPanelElementId || songDetailsRef?.elementId;
    if (activePanelElementId && !elementIds.has(activePanelElementId)) {
      setAssignmentPanelElementId(null);
      setContentPanelElementId(null);
      setIsScriptureAttachMode(false);
      setIsResourceEditorMode(false);
      setSongDetailsRef(null);
      setSongDetailsEditing(false);
      assignmentPanelTriggerRef.current = null;
    }
  }, [assignmentPanelElementId, contentPanelElementId, sections, songDetailsRef?.elementId]);
  const closeAssignmentPanel = () => {
    const trigger = assignmentPanelTriggerRef.current;
    resetItemSpecificPanel();
    trigger?.focus();
  };
  const backToContentPanel = () => {
    if (songDetailsRef) {
      setContentPanelElementId(songDetailsRef.elementId);
    }
    setSongDetailsRef(null);
    setSongDetailsEditing(false);
  };
  const openAssignmentPanel = (elementId: string, trigger?: HTMLElement) => {
    assignmentPanelTriggerRef.current = trigger || null;
    setContentPanelElementId(null);
    setSongDetailsRef(null);
    setSongDetailsEditing(false);
    setAssignmentPanelElementId(elementId);
  };
  const updatePanelAssignees = (nextAssignees: ServicePlanAssignee[], coalesceKey?: string) => {
    if (!assignmentPanelElement || !assignmentPanelSection) return;
    onSectionsChange(
      updateElement(sections, assignmentPanelSection.id, assignmentPanelElement.id, {
        assignees: nextAssignees,
      }),
      coalesceKey && `element:${assignmentPanelElement.id}:${coalesceKey}`,
    );
  };
  const handleOpenAssignment = (elementId: string, trigger?: HTMLElement) => {
    openAssignmentPanel(elementId, trigger);
    onOpenAssignmentProp?.(elementId, trigger);
  };
  const handleOpenContent = (elementId: string, trigger?: HTMLElement) => {
    assignmentPanelTriggerRef.current = trigger || null;
    setAssignmentPanelElementId(null);
    setSongDetailsRef(null);
    setSongDetailsEditing(false);
    setIsScriptureAttachMode(false);
    setIsResourceEditorMode(false);
    setContentPanelElementId(elementId);
    onOpenContentProp?.(elementId, trigger);
  };
  const handleSelectSection = (sectionId: string) => {
    if (assignmentPanelElementId || contentPanelElementId || songDetailsRef) {
      resetItemSpecificPanel();
    }
    onSelectionChange?.({ sectionId });
  };
  const handleSelectElement = (sectionId: string, elementId: string) => {
    setIsScriptureAttachMode(false);
    setIsResourceEditorMode(false);
    if (assignmentPanelElementId) {
      setAssignmentPanelElementId(elementId);
      assignmentPanelTriggerRef.current = null;
    } else if (songDetailsRef) {
      setAssignmentPanelElementId(null);
      setContentPanelElementId(elementId);
      setSongDetailsRef(null);
      setSongDetailsEditing(false);
      assignmentPanelTriggerRef.current = null;
    } else if (contentPanelElementId) {
      setContentPanelElementId(elementId);
      assignmentPanelTriggerRef.current = null;
    }
    onSelectionChange?.({ sectionId, elementId });
  };
  const previousSelectionRef = useRef({
    sectionId: selectedSectionId,
    elementId: selectedElementId,
  });
  useEffect(() => {
    const previousSelection = previousSelectionRef.current;
    const selectionChanged =
      previousSelection.sectionId !== selectedSectionId
      || previousSelection.elementId !== selectedElementId;
    previousSelectionRef.current = {
      sectionId: selectedSectionId,
      elementId: selectedElementId,
    };
    if (!selectionChanged) return;
    if (!selectedElementId) {
      if (assignmentPanelElementId || contentPanelElementId || songDetailsRef) {
        resetItemSpecificPanel();
      }
      return;
    }
    if (assignmentPanelElementId && assignmentPanelElementId !== selectedElementId) {
      setAssignmentPanelElementId(selectedElementId);
      assignmentPanelTriggerRef.current = null;
      return;
    }
    if (songDetailsRef && songDetailsRef.elementId !== selectedElementId) {
      setAssignmentPanelElementId(null);
      setContentPanelElementId(selectedElementId);
      setSongDetailsRef(null);
      setSongDetailsEditing(false);
      assignmentPanelTriggerRef.current = null;
      return;
    }
    if (contentPanelElementId && contentPanelElementId !== selectedElementId) {
      setContentPanelElementId(selectedElementId);
      assignmentPanelTriggerRef.current = null;
    }
  }, [
    assignmentPanelElementId,
    contentPanelElementId,
    resetItemSpecificPanel,
    selectedElementId,
    selectedSectionId,
    songDetailsRef,
  ]);
  const handleRemoveSection = (sectionId: string) => {
    const panelElementIsInSection = sections
      .find((section) => section.id === sectionId)
      ?.elements.some((element) =>
        element.id === assignmentPanelElementId
        || element.id === contentPanelElementId
        || element.id === songDetailsRef?.elementId,
      );
    if (panelElementIsInSection) resetItemSpecificPanel();
    onSectionsChange(removeSection(sections, sectionId));
  };
  const handleRemoveElement = (elementId: string) => {
    if (
      elementId === assignmentPanelElementId
      || elementId === contentPanelElementId
      || elementId === songDetailsRef?.elementId
    ) {
      resetItemSpecificPanel();
    }
    onSectionsChange(applyElementRemoval(sections, elementId));
  };
  const activePanelElement = assignmentPanelElement || contentPanelElement;
  const songDetailsSongRef = songDetailsRef?.songRef;
  const songDetails = songDetailsSongRef?.kind === "library"
    ? allSongDocs.find((song) => song._id === songDetailsSongRef.songId && song.type === "song")
    : undefined;

  const commitDisplayedSections = (next: ServicePlanSection[]) => {
    if (next === sections) return;
    const anchor = sections.flatMap((section) => section.elements)[0]?.startTime;
    onSectionsChange(anchor ? applyPlanAnchorStartTime(next, anchor) : next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);
    const overId = over ? String(over.id) : null;
    const draggedElementId = activeId.startsWith(SERVICE_PLAN_ELEMENT_DND_PREFIX)
      ? activeId.slice(SERVICE_PLAN_ELEMENT_DND_PREFIX.length)
      : null;
    const placement = elementPlacementRef.current;
    const previewSections =
      draggedElementId && placement
        ? previewServicePlanSections(sections, draggedElementId, placement)
        : null;
    clearDragState();
    if (!canEdit || !isEditing) return;

    if (
      activeId.startsWith(SERVICE_PLAN_SECTION_DND_PREFIX) &&
      overId &&
      overId.startsWith(SERVICE_PLAN_SECTION_DND_PREFIX) &&
      activeId !== overId
    ) {
      const ids = sections.map((section) => sectionDndId(section.id));
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reorderedIds = arrayMove(ids, oldIndex, newIndex).map((id) =>
        id.slice(SERVICE_PLAN_SECTION_DND_PREFIX.length),
      );
      commitDisplayedSections(reorderSections(sections, reorderedIds));
      return;
    }

    if (!draggedElementId) return;
    commitDisplayedSections(
      commitServicePlanElementDrag({
        originalSections: sections,
        previewSections,
        overId,
      }),
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setDragElementPlacement(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!canEdit || !isEditing) return;
    const activeId = String(event.active.id);
    if (!activeId.startsWith(SERVICE_PLAN_ELEMENT_DND_PREFIX)) return;
    const nextPlacement = resolveServicePlanElementPlacement({
      sections,
      activeElementId: activeId.slice(SERVICE_PLAN_ELEMENT_DND_PREFIX.length),
      overId: event.over ? String(event.over.id) : null,
      pointerY: pointerYFromDragEvent(event),
      overRect: event.over?.rect
        ? { top: event.over.rect.top, height: event.over.rect.height }
        : null,
      previousPlacement: elementPlacementRef.current,
    });
    if (servicePlanElementPlacementsEqual(nextPlacement, elementPlacementRef.current)) {
      return;
    }
    setDragElementPlacement(nextPlacement);
  };

  const activeDragSection = activeDragId?.startsWith(SERVICE_PLAN_SECTION_DND_PREFIX)
    ? sections.find((section) => sectionDndId(section.id) === activeDragId)
    : undefined;
  const activeDragElement = activeDragId?.startsWith(SERVICE_PLAN_ELEMENT_DND_PREFIX)
    ? displayedSections
      .flatMap((section) => section.elements)
      .find((element) => elementDndId(element.id) === activeDragId)
    : undefined;
  const activePanelTitle = activePanelElement?.title
    ? richTextToPlainText(activePanelElement.title).trim()
    : "";

  const panelAriaLabel = songDetails
    ? `Song details for ${songDetails.name}`
    : `${contentPanelElement ? "Content editor" : "Assignment editor"} for ${activePanelTitle || "Untitled item"}`;
  const panelTitle = songDetails
    ? (songDetailsEditing ? "Edit song details" : "Song details")
    : contentPanelElement
      ? (isEditing ? "Edit content" : "Content details")
      : (isEditing ? "Edit people and microphones" : "People and microphones");
  const panelSubtitle = songDetails
    ? songDetails.name
    : activePanelTitle || "Untitled item";
  const panelHeader = (
    <div className="flex items-start gap-2 border-b border-gray-800 px-4 py-3">
      {songDetails && contentPanelElement ? (
        <Button
          type="button"
          variant="tertiary"
          iconSize="sm"
          svg={ArrowLeft}
          aria-label="Back to content"
          onClick={backToContentPanel}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-gray-100">{panelTitle}</h2>
        <p className="truncate text-xs text-gray-400">{panelSubtitle}</p>
      </div>
      <Button
        type="button"
        variant="tertiary"
        iconSize="sm"
        svg={X}
        aria-label="Close side panel"
        onClick={closeAssignmentPanel}
      />
    </div>
  );
  const panelFooter = isScriptureAttachMode || isResourceEditorMode ? null : (
    <div className="border-t border-gray-800 p-4">
      <Button
        type="button"
        variant="cta"
        className="w-full cursor-pointer justify-center"
        onClick={closeAssignmentPanel}
      >
        Done
      </Button>
    </div>
  );
  const panelContent = (
    <>
      {songDetails ? (
        <ServicePlanSongDetailsPanel
          song={songDetails}
          canEdit={canEdit}
          onEditingChange={setSongDetailsEditing}
        />
      ) : contentPanelElement ? (
        <ServicePlanContentPanel
          element={contentPanelElement}
          allowEdit={canEdit && isEditing}
          onUpdate={(changes) => onSectionsChange(updateElement(sections, sections.find((section) => section.elements.some((element) => element.id === contentPanelElement.id))?.id || "", contentPanelElement.id, changes))}
          onScriptureAttachModeChange={setIsScriptureAttachMode}
          onResourceEditorModeChange={setIsResourceEditorMode}
          onViewSongLyrics={onViewSongLyrics}
          onOpenSongDetails={(songRef) => {
            if (songRef.kind !== "library") {
              onViewSongLyrics?.(songRef);
              return;
            }
            setSongDetailsEditing(false);
            setSongDetailsRef({ elementId: contentPanelElement.id, songRef });
          }}
          onCreatePendingSong={onCreatePendingSong}
          canCreateLibrarySong={canCreateLibrarySong}
        />
      ) : assignmentPanelElement ? (
        <ServicePlanAssigneeList
          assignees={getServicePlanElementAssignees(assignmentPanelElement)}
          allowEdit={canEdit && isEditing}
          microphones={microphones}
          assignedToHistoryValues={assignedToHistoryValues}
          onRemoveAssignedToHistoryValue={onRemoveAssignedToHistoryValue}
          isAssignedToHistoryValueRemovable={isAssignedToHistoryValueRemovable}
          itemLabel={richTextToPlainText(assignmentPanelElement.title).trim() || "Untitled item"}
          structureOnly={structureOnly}
          scheduledMicrophoneHolders={scheduledMicrophoneHolders}
          onChange={updatePanelAssignees}
        />
      ) : null}
    </>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={servicePlanCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={clearDragState}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          <div
            id={scrollId}
            ref={planListRef}
            role="region"
            aria-label={ariaLabel}
            className="scrollbar-variable min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto"
          >
            {header}
            <ServicePlanElementColumnHeader
              isEditing={isEditing}
              showActionsColumn={isEditing || Boolean(liveRowState.isServiceDay)}
              showAssignedColumn={!structureOnly}
            />

            {displayedSections.map((section) => (
              <SortableSectionCard
                key={section.id}
                section={section}
                canEdit={canEdit}
                isEditing={isEditing}
                lockSortableLayout={lockSectionSortableLayout}
                onRename={(name) =>
                  onSectionsChange(
                    renameSection(sections, section.id, name),
                    `section:${section.id}:name`,
                  )
                }
                onRemove={() => handleRemoveSection(section.id)}
                isSelected={selectedSectionId === section.id && !selectedElementId}
                selectedElementId={
                  selectedSectionId === section.id ? selectedElementId || undefined : undefined
                }
                onSelectSection={() => {
                  if (!canEdit || !isEditing) return;
                  handleSelectSection(section.id);
                }}
                onSelectElement={(elementId) => {
                  if (!canEdit || !isEditing) return;
                  handleSelectElement(section.id, elementId);
                }}
                onRemoveElement={handleRemoveElement}
                onUpdateElement={(elementId, changes, coalesceKey) =>
                  onSectionsChange(
                    updateElement(sections, section.id, elementId, changes),
                    // Only the row knows whether this is continuous typing or a
                    // discrete action — every note edit arrives as the same
                    // `teamNotes` shape, so the change itself can't tell a
                    // keystroke from a removal.
                    coalesceKey && `element:${elementId}:${coalesceKey}`,
                  )
                }
                onElementDurationChange={(elementId, durationSeconds) =>
                  onSectionsChange(
                    applyElementDurationSecondsChange(
                      sections,
                      elementId,
                      durationSeconds,
                    ),
                    `element:${elementId}:duration`,
                  )
                }
                onElementStartTimeChange={(elementId, time) =>
                  onSectionsChange(
                    applyElementStartTimeChange(sections, elementId, time),
                    `element:${elementId}:startTime`,
                  )
                }
                assignedToHistoryValues={assignedToHistoryValues}
                onRemoveAssignedToHistoryValue={onRemoveAssignedToHistoryValue}
                isAssignedToHistoryValueRemovable={isAssignedToHistoryValueRemovable}
                roleNoteOptions={roleNoteOptions}
                scheduledPositionOptions={scheduledPositionOptions}
                teamNoteOptions={teamNoteOptions}
                microphones={microphones}
                microphoneAudiences={microphoneAudiences}
                scheduledMicrophoneHolders={scheduledMicrophoneHolders}
                scheduledAssignmentRows={scheduledAssignmentRows}
                onOpenScheduledAssignment={onOpenScheduledAssignment}
                hideNotes={hideNotes}
                teamNotesFilter={teamNotesFilter}
                roleNotesFilter={roleNotesFilter}
                onViewSongLyrics={onViewSongLyrics}
                canCreateLibrarySong={canCreateLibrarySong}
                onCreatePendingSong={onCreatePendingSong}
                resolvedSongRefs={resolvedSongRefs}
                structureOnly={structureOnly}
                sectionLabelColor={sectionLabelColor}
                sectionBorderColor={sectionBorderColor}
                onOpenAssignment={handleOpenAssignment}
                onOpenContent={handleOpenContent}
                onOpenSongDetails={(elementId, songRef) => {
                  if (songRef.kind !== "library") {
                    onViewSongLyrics?.(songRef);
                    return;
                  }
                  setContentPanelElementId(null);
                  setAssignmentPanelElementId(null);
                  setSongDetailsEditing(false);
                  setSongDetailsRef({ elementId, songRef });
                }}
                {...liveRowState}
              />
            ))}

          </div>
        </SortableContext>
        {isDesktopPanel && (activePanelElement || songDetails) ? (
          <aside
            aria-label={panelAriaLabel}
            className="hidden min-h-0 w-[min(26rem,32vw)] shrink-0 flex-col overflow-hidden rounded-lg border border-gray-500/35 bg-sheet-surface text-neutral-100 shadow-xl xl:flex"
          >
            {panelHeader}
            <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4 [&_.service-plan-assignee-list]:!pl-0 [&_.service-plan-assignee-list>div:first-child]:flex-col [&_.service-plan-assignee-list>div:first-child]:items-stretch [&_.service-plan-assignee-list>div:first-child]:gap-2 [&_.service-plan-assignee-list>div:first-child>div:first-child]:w-full [&_.service-plan-assignee-list>div:first-child>div:last-child]:w-full">
              {panelContent}
            </div>
            {panelFooter}
          </aside>
        ) : null}
        <Sheet
          modal={false}
          open={!isDesktopPanel && Boolean(activePanelElement || songDetails)}
          onOpenChange={(open) => {
            if (!open) closeAssignmentPanel();
          }}
        >
          <SheetContent
            side="right"
            showClose={false}
            onPointerDownOutside={(event) => {
              if (planListRef.current?.contains(event.target as Node)) {
                event.preventDefault();
              }
            }}
            onFocusOutside={(event) => {
              if (planListRef.current?.contains(event.target as Node)) {
                event.preventDefault();
              }
            }}
            className="w-full max-w-md gap-0 p-0 xl:hidden"
            aria-label={panelAriaLabel}
          >
            <SheetTitle className="sr-only">{panelTitle}</SheetTitle>
            {panelHeader}
            <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4 [&_.service-plan-assignee-list]:!pl-0 [&_.service-plan-assignee-list>div:first-child]:flex-col [&_.service-plan-assignee-list>div:first-child]:items-stretch [&_.service-plan-assignee-list>div:first-child]:gap-2 [&_.service-plan-assignee-list>div:first-child>div:first-child]:w-full [&_.service-plan-assignee-list>div:first-child>div:last-child]:w-full">
              {panelContent}
            </div>
            {panelFooter}
          </SheetContent>
        </Sheet>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragSection ? (
          <div className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-100 shadow-xl">
            {activeDragSection.name.trim() || "Untitled section"}
          </div>
        ) : activeDragElement ? (
          <div className="min-w-[32rem] rounded-md border border-gray-600 bg-gray-900 px-1.5 py-1.5 text-sm font-medium text-gray-100 shadow-xl">
            <div className={SERVICE_PLAN_COL.row}>
              <span className={SERVICE_PLAN_COL.drag} aria-hidden="true" />
              <span className="whitespace-nowrap text-xs text-gray-400">{formatPlanStartTimeDisplay(activeDragElement.startTime) || "—"}</span>
              <span className="whitespace-nowrap text-xs text-gray-400">{Math.round((activeDragElement.durationSeconds || 0) / 60)} min</span>
              <span className="min-w-0 truncate">{richTextToPlainText(activeDragElement.title).trim() || "Untitled item"}</span>
              <span className="min-w-0 truncate text-xs text-gray-400">{getServicePlanElementLead(activeDragElement)?.name || "Add content"}</span>
              <span className="min-w-0 truncate text-xs text-gray-400">{getServicePlanElementLead(activeDragElement)?.name || "Led by"}</span>
              <span />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default ServicePlanSectionList;
