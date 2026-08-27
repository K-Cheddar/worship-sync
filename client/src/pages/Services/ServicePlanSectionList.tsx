import { useEffect, useState, type ReactNode } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
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
import { useSensors } from "../../utils/dndUtils";
import ServicePlanElementRow, {
  elementDndId,
  ServicePlanElementColumnHeader,
  SERVICE_PLAN_INLINE_INPUT_CLASS,
  type ServicePlanRoleNoteOption,
  type ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import {
  removeElement,
  removeSection,
  renameSection,
  reorderElementsInSection,
  reorderSections,
  updateElement,
} from "./servicePlanDraftUtils";
import {
  applyElementDurationSecondsChange,
  applyElementStartTimeChange,
} from "./servicePlanTimingUtils";
import type {
  ServicePlanSection,
  ServicePlanSongReference,
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
} from "../../types/servicePlan";

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
  teamNoteOptions: ServicePlanTeamNoteOption[];
  microphones: ServicePlanMicrophone[];
  microphoneAudiences?: ServicePlanMicrophoneAudience[];
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
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
  teamNoteOptions,
  microphones,
  microphoneAudiences,
  scheduledMicrophoneHolders,
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
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
      className="overflow-hidden rounded-md border border-gray-700/80 bg-gray-950/40"
    >
      <div
        className={cn(
          "flex items-center gap-1 bg-gray-800/95 px-1.5 py-1",
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
              "font-semibold text-gray-100",
            )}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-gray-100">
            {section.name.trim() || "Untitled section"}
          </h3>
        )}
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
            <ServicePlanElementColumnHeader
              isEditing={allowEdit}
              // Keep the flexible title/content columns aligned with edit mode,
              // which always reserves the trailing actions gutter.
              showActionsColumn={canEdit || isServiceDay}
              showAssignedColumn={false}
            />
          ) : null}
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
                  onViewSongLyrics={onViewSongLyrics}
                  canCreateLibrarySong={canCreateLibrarySong}
                  onCreatePendingSong={onCreatePendingSong}
                  resolvedSongRefs={resolvedSongRefs.get(element.id)}
                  structureOnly={structureOnly}
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
  teamNoteOptions?: ServicePlanTeamNoteOption[];
  microphones?: ServicePlanMicrophone[];
  microphoneAudiences?: ServicePlanMicrophoneAudience[];
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
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
  /** Rendered above the sections, inside the same scroll container. */
  header?: ReactNode;
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
  teamNoteOptions = [],
  microphones = [],
  microphoneAudiences,
  scheduledMicrophoneHolders,
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
  header,
  ...liveRowState
}: ServicePlanSectionListProps) => {
  const sensors = useSensors();
  const sectionIds = sections.map((section) => sectionDndId(section.id));
  const selectedSectionId = selection?.sectionId || null;
  const selectedElementId = selection?.elementId || null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!canEdit || !isEditing || !over || active.id === over.id) return;
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
      onSectionsChange(reorderSections(sections, reorderedIds));
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
      onSectionsChange(
        reorderElementsInSection(
          sections,
          owningSection.id,
          arrayMove(ids, oldIndex, newIndex),
        ),
      );
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
        <div
          id={scrollId}
          role="region"
          aria-label={ariaLabel}
          className="scrollbar-variable min-h-0 flex-1 space-y-2 overflow-y-auto"
        >
          {header}

          {sections.map((section) => (
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
              teamNoteOptions={teamNoteOptions}
              microphones={microphones}
              microphoneAudiences={microphoneAudiences}
              scheduledMicrophoneHolders={scheduledMicrophoneHolders}
              hideNotes={hideNotes}
              teamNotesFilter={teamNotesFilter}
              roleNotesFilter={roleNotesFilter}
              onViewSongLyrics={onViewSongLyrics}
              canCreateLibrarySong={canCreateLibrarySong}
              onCreatePendingSong={onCreatePendingSong}
              resolvedSongRefs={resolvedSongRefs}
              structureOnly={structureOnly}
              {...liveRowState}
            />
          ))}

        </div>
      </SortableContext>
    </DndContext>
  );
};

export default ServicePlanSectionList;
