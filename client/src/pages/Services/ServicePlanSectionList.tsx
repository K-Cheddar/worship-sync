import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, GripVertical, MoreHorizontal, Trash2, X } from "lucide-react";
import { closestCenter, DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
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
import { useSensors } from "../../utils/dndUtils";
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
  removeElement,
  removeSection,
  renameSection,
  moveElementToPosition,
  reorderSections,
  updateElement,
} from "./servicePlanDraftUtils";
import {
  applyElementDurationSecondsChange,
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

const SECTION_ID_PREFIX = "section:";
const ELEMENT_ID_PREFIX = "element:";

export const sectionDndId = (sectionId: string) =>
  `${SECTION_ID_PREFIX}${sectionId}`;

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
  onOpenSongDetails: (songRef: ServicePlanSongReference) => void;
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
        transform: CSS.Transform.toString(transform),
        transition,
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
                  onOpenSongDetails={onOpenSongDetails}
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
  const sensors = useSensors();
  const isDesktopPanel = useMediaQuery("(min-width: 1280px)");
  const sectionIds = sections.map((section) => sectionDndId(section.id));
  const selectedSectionId = selection?.sectionId || null;
  const selectedElementId = selection?.elementId || null;
  const [assignmentPanelElementId, setAssignmentPanelElementId] = useState<string | null>(null);
  const [contentPanelElementId, setContentPanelElementId] = useState<string | null>(null);
  const [songDetailsRef, setSongDetailsRef] = useState<ServicePlanSongReference | null>(null);
  const [songDetailsEditing, setSongDetailsEditing] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragSections, setDragSections] = useState<ServicePlanSection[] | null>(null);
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
  const closeAssignmentPanel = () => {
    setAssignmentPanelElementId(null);
    setContentPanelElementId(null);
    setSongDetailsRef(null);
    setSongDetailsEditing(false);
    assignmentPanelTriggerRef.current?.focus();
    assignmentPanelTriggerRef.current = null;
  };
  const backToContentPanel = () => {
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
    setContentPanelElementId(elementId);
    onOpenContentProp?.(elementId, trigger);
  };
  const activePanelElement = assignmentPanelElement || contentPanelElement;
  const songDetails = songDetailsRef?.kind === "library"
    ? allSongDocs.find((song) => song._id === songDetailsRef.songId && song.type === "song")
    : undefined;

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const previewSections = dragSections;
    const sectionsAtDrop = previewSections || sections;
    setDragSections(null);
    const { active, over } = event;
    if (!canEdit || !isEditing || !over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (
      activeId.startsWith(SECTION_ID_PREFIX) &&
      overId.startsWith(SECTION_ID_PREFIX)
    ) {
      const ids = sectionsAtDrop.map((section) => sectionDndId(section.id));
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reorderedIds = arrayMove(ids, oldIndex, newIndex).map((id) =>
        id.slice(SECTION_ID_PREFIX.length),
      );
      const next = reorderSections(sectionsAtDrop, reorderedIds);
      const anchor = sectionsAtDrop.flatMap((section) => section.elements)[0]?.startTime;
      onSectionsChange(anchor ? applyPlanAnchorStartTime(next, anchor) : next);
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
      const destination = sections.find((section) =>
        section.elements.some((element) => element.id === rawOverId),
      );
      if (!owningSection || !destination) return;
      const targetIndex = destination.elements.findIndex((element) => element.id === rawOverId);
      const next = owningSection.id !== destination.id && previewSections
        ? previewSections
        : moveElementToPosition(sections, rawActiveId, owningSection.id, destination.id, targetIndex);
      const anchor = sectionsAtDrop.flatMap((section) => section.elements)[0]?.startTime;
      onSectionsChange(anchor ? applyPlanAnchorStartTime(next, anchor) : next);
      return;
    }

    if (activeId.startsWith(ELEMENT_ID_PREFIX) && overId.startsWith(SECTION_ID_PREFIX)) {
      const rawActiveId = activeId.slice(ELEMENT_ID_PREFIX.length);
      const destinationId = overId.slice(SECTION_ID_PREFIX.length);
      const owningSection = sections.find((section) => section.elements.some((element) => element.id === rawActiveId));
      const destination = sections.find((section) => section.id === destinationId);
      if (!owningSection || !destination) return;
      const next = owningSection.id !== destination.id && previewSections
        ? previewSections
        : moveElementToPosition(sections, rawActiveId, owningSection.id, destination.id, destination.elements.length);
      const anchor = sectionsAtDrop.flatMap((section) => section.elements)[0]?.startTime;
      onSectionsChange(anchor ? applyPlanAnchorStartTime(next, anchor) : next);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setDragSections(sections);
  };

  const handleDragOver = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    if (!canEdit || !isEditing || !event.over || !String(event.active.id).startsWith(ELEMENT_ID_PREFIX)) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const current = dragSections || sections;
    const source = current.find((section) => section.elements.some((element) => elementDndId(element.id) === activeId));
    const destination = overId.startsWith(SECTION_ID_PREFIX)
      ? current.find((section) => sectionDndId(section.id) === overId)
      : current.find((section) => section.elements.some((element) => elementDndId(element.id) === overId));
    if (!source || !destination || source.id === destination.id) return;
    const targetIndex = overId.startsWith(ELEMENT_ID_PREFIX)
      ? destination.elements.findIndex((element) => elementDndId(element.id) === overId)
      : destination.elements.length;
    setDragSections(moveElementToPosition(current, activeId.slice(ELEMENT_ID_PREFIX.length), source.id, destination.id, targetIndex));
  };

  const activeDragSection = activeDragId?.startsWith(SECTION_ID_PREFIX)
    ? sections.find((section) => sectionDndId(section.id) === activeDragId)
    : undefined;
  const activeDragElement = activeDragId?.startsWith(ELEMENT_ID_PREFIX)
    ? (dragSections || sections)
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
  const panelFooter = (
    <div className="border-t border-gray-800 p-4">
      <Button
        type="button"
        variant="primary"
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
          onViewSongLyrics={onViewSongLyrics}
          onOpenSongDetails={(songRef) => {
            if (songRef.kind !== "library") {
              onViewSongLyrics?.(songRef);
              return;
            }
            setSongDetailsEditing(false);
            setSongDetailsRef(songRef);
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
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={() => setActiveDragId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          <div
            id={scrollId}
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

          {(dragSections || sections).map((section) => (
            <SortableSectionCard
              key={section.id}
              section={section}
              canEdit={canEdit}
              isEditing={isEditing}
              onRename={(name) =>
                onSectionsChange(
                  renameSection(sections, section.id, name),
                  `section:${section.id}:name`,
                )
              }
              onRemove={() => onSectionsChange(removeSection(sections, section.id))}
              isSelected={selectedSectionId === section.id && !selectedElementId}
              selectedElementId={
                selectedSectionId === section.id ? selectedElementId || undefined : undefined
              }
              onSelectSection={() => {
                if (!canEdit || !isEditing) return;
                onSelectionChange?.({ sectionId: section.id });
              }}
              onSelectElement={(elementId) => {
                if (!canEdit || !isEditing) return;
                onSelectionChange?.({ sectionId: section.id, elementId });
              }}
              onRemoveElement={(elementId) =>
                onSectionsChange(removeElement(sections, section.id, elementId))
              }
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
              onOpenSongDetails={(songRef) => {
                if (songRef.kind !== "library") {
                  onViewSongLyrics?.(songRef);
                  return;
                }
                setContentPanelElementId(null);
                setAssignmentPanelElementId(null);
                setSongDetailsEditing(false);
                setSongDetailsRef(songRef);
              }}
              {...liveRowState}
            />
          ))}

          </div>
        </SortableContext>
        {activePanelElement || songDetails ? (
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
          open={!isDesktopPanel && Boolean(activePanelElement || songDetails)}
          onOpenChange={(open) => {
            if (!open) closeAssignmentPanel();
          }}
        >
          <SheetContent
            side="right"
            showClose={false}
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
