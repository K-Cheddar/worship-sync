import { useEffect, useState, type FunctionComponent, type ReactNode, type SVGProps } from "react";
import {
  BookOpen,
  ChevronDown,
  GripVertical,
  Music,
  Plus,
  Radio,
  StickyNote,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AnimateCollapse from "../../components/AnimateCollapse/AnimateCollapse";
import Button from "../../components/Button/Button";
import Icon from "../../components/Icon/Icon";
import HistorySuggestField from "../../components/HistorySuggestField/HistorySuggestField";
import Input from "../../components/Input/Input";
import TimePicker from "../../components/TimePicker/TimePicker";
import {
  formatServicePlanDuration,
  parseServicePlanDuration,
} from "./servicePlanDuration";
import RichTextEditor from "../../components/RichTextEditor/RichTextEditor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import {
  EMPTY_RICH_TEXT,
  isRichTextEmpty,
  plainTextToRichText,
  richTextToPlainText,
  type RichTextDocument,
} from "../../types/richText";
import { parseTimeCountdown } from "../../components/TimePicker/utils";
import { cn } from "../../utils/cnHelper";
import generateRandomId from "../../utils/generateRandomId";
import { pad2 } from "../../constants";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import ServicePlanScripturePopover, {
  SERVICE_PLAN_SCRIPTURE_ICON_CLASS,
} from "./ServicePlanScripturePopover";
import type { ServicePlanElement } from "../../types/servicePlan";

export const elementDndId = (elementId: string) => `element:${elementId}`;

/** Match TimePicker's 12-hour display for compact view-mode rows. */
export const formatPlanStartTimeDisplay = (startTime: string | undefined): string => {
  const parsed = parseTimeCountdown(startTime);
  if (!parsed?.hour || !parsed.minute || !parsed.meridiem) return startTime?.trim() || "";
  return `${pad2(parsed.hour)}:${parsed.minute} ${parsed.meridiem}`;
};

/** Soft field chrome so inline editors sit closer to the row surface. */
export const SERVICE_PLAN_INLINE_INPUT_CLASS =
  "h-7 min-h-0 border-0 bg-gray-950/70 px-1 py-0.5 shadow-none placeholder:text-gray-500";

export const SERVICE_PLAN_SONG_ICON_CLASS = "text-cyan-400";
export const SERVICE_PLAN_NOTE_ICON_CLASS = "text-yellow-300";
export const SERVICE_PLAN_TEAM_NOTE_ICON_CLASS = "text-emerald-400";
/** Light red for day-of-service Make live. */
export const SERVICE_PLAN_MAKE_LIVE_ICON_COLOR = "#fca5a5";

export const SERVICE_PLAN_SONG_CHIP_CLASS = "border-cyan-500/50 text-cyan-50";
export const SERVICE_PLAN_SCRIPTURE_CHIP_CLASS =
  "border-orange-500/50 text-orange-50";

/** Compact attachment chips (song / scripture) on the second row. */
export const SERVICE_PLAN_ATTACHMENT_CHIP_CLASS =
  "flex items-center gap-0.5 rounded border px-1.5 py-0 text-[11px] leading-5";

/** Shared column header for the compact plan list. */
export const ServicePlanElementColumnHeader = ({
  isEditing = false,
}: {
  isEditing?: boolean;
}) => (
  <div
    className={cn(
      "flex items-center gap-3 border-b border-gray-700/80 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400",
      isEditing && "max-md:hidden",
    )}
    aria-hidden
  >
    {isEditing ? <span className="w-7 shrink-0" /> : null}
    <span
      className={cn(
        "shrink-0",
        isEditing ? "w-14 sm:w-24" : "w-[3.75rem]",
      )}
    >
      Time
    </span>
    <span
      className={cn(
        "shrink-0",
        isEditing ? "w-12 sm:w-16" : "w-12",
      )}
    >
      {isEditing ? "Length" : "Len"}
    </span>
    <span className="min-w-0 flex-1">Title</span>
    {isEditing ? (
      <>
        <span className="w-20 shrink-0 sm:w-36">Assigned</span>
        <span className="w-7 shrink-0" />
      </>
    ) : (
      <span className="hidden w-28 shrink-0 md:block lg:w-36">Assigned</span>
    )}
  </div>
);

/** One-line plain preview of rich text for collapsed note rows. */
export const richTextOneLinePreview = (
  doc: RichTextDocument | undefined | null,
): string => richTextToPlainText(doc).replace(/\s+/g, " ").trim();

/**
 * Alternating list surfaces — divider rows, not heavy cards, so more items
 * fit on screen (Planning Center–style density).
 */
export const getServicePlanElementSurfaceClassName = ({
  toneIndex,
  isLive = false,
}: {
  toneIndex: number;
  isLive?: boolean;
}): string => {
  const zebra =
    toneIndex % 2 === 0
      ? "bg-gray-900/50"
      : "bg-transparent";

  return cn(
    "border-b border-gray-800/90",
    zebra,
    isLive && "bg-emerald-950/30 ring-1 ring-inset ring-emerald-500/35",
  );
};

const songRefLabel = (element: ServicePlanElement): string | null => {
  if (!element.songRef) return null;
  return element.songRef.kind === "library"
    ? element.songRef.songName
    : element.songRef.title || "Untitled song";
};

type MinimizedNoteRowProps = {
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  iconClassName: string;
  title: string;
  preview: string;
  emptyPreview: string;
  expandLabel: string;
  removeLabel: string;
  canEdit: boolean;
  onExpand: () => void;
  onRemove: () => void;
};

/** Collapsed note: one line with title + truncated body, no toolbar. */
const MinimizedNoteRow = ({
  icon,
  iconClassName,
  title,
  preview,
  emptyPreview,
  expandLabel,
  removeLabel,
  canEdit,
  onExpand,
  onRemove,
}: MinimizedNoteRowProps) => (
  <div className="flex min-w-0 items-center gap-1">
    <button
      type="button"
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-gray-800/60"
      aria-expanded={false}
      aria-label={expandLabel}
      onClick={onExpand}
    >
      <ChevronDown
        className="size-3.5 shrink-0 -rotate-90 text-gray-400 transition-transform duration-200 ease-out motion-reduce:transition-none"
        aria-hidden
      />
      <Icon svg={icon} size="xs" className={cn("shrink-0", iconClassName)} />
      <span className="shrink-0 text-xs font-medium text-white">{title}</span>
      <span className="min-w-0 truncate text-xs text-gray-400">
        {preview || emptyPreview}
      </span>
    </button>
    {canEdit ? (
      <Button
        type="button"
        variant="tertiary"
        iconSize="xs"
        padding="p-0.5"
        className="h-6 w-6 shrink-0 max-md:min-h-0"
        svg={Trash2}
        aria-label={removeLabel}
        onClick={onRemove}
      />
    ) : null}
  </div>
);

/** Swap minimized ↔ expanded note bodies with a shared height animation. */
const ExpandableNotePanel = ({
  expanded,
  minimized,
  children,
}: {
  expanded: boolean;
  minimized: ReactNode;
  children: ReactNode;
}) => (
  <>
    {!expanded ? minimized : null}
    <AnimateCollapse open={expanded} unmountOnExit>
      {children}
    </AnimateCollapse>
  </>
);

type AddAttachmentMenuProps = {
  itemLabel: string;
  canEdit: boolean;
  canAddSong: boolean;
  canAddScripture: boolean;
  canAddNote: boolean;
  canAddTeamNote: boolean;
  onAddSong: () => void;
  onAddScripture: () => void;
  onAddNote: () => void;
  onAddTeamNote: () => void;
};

const AddAttachmentMenu = ({
  itemLabel,
  canEdit,
  canAddSong,
  canAddScripture,
  canAddNote,
  canAddTeamNote,
  onAddSong,
  onAddScripture,
  onAddNote,
  onAddTeamNote,
}: AddAttachmentMenuProps) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="tertiary"
        svg={Plus}
        iconSize="sm"
        disabled={!canEdit}
        aria-haspopup="menu"
        aria-label={`Add to ${itemLabel}`}
        className="max-md:min-h-0 border border-dashed border-gray-600/80 text-gray-300 hover:border-cyan-500/50 hover:text-cyan-50"
      >
        Add
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-48">
      {canAddSong ? (
        <DropdownMenuItem onSelect={onAddSong}>
          <Music
            className={cn("size-4", SERVICE_PLAN_SONG_ICON_CLASS)}
            aria-hidden
          />
          Song
        </DropdownMenuItem>
      ) : null}
      {canAddScripture ? (
        <DropdownMenuItem onSelect={onAddScripture}>
          <BookOpen
            className={cn("size-4", SERVICE_PLAN_SCRIPTURE_ICON_CLASS)}
            aria-hidden
          />
          Scripture
        </DropdownMenuItem>
      ) : null}
      {canAddNote ? (
        <DropdownMenuItem onSelect={onAddNote}>
          <StickyNote
            className={cn("size-4", SERVICE_PLAN_NOTE_ICON_CLASS)}
            aria-hidden
          />
          Note
        </DropdownMenuItem>
      ) : null}
      {canAddTeamNote ? (
        <DropdownMenuItem onSelect={onAddTeamNote}>
          <Users
            className={cn("size-4", SERVICE_PLAN_TEAM_NOTE_ICON_CLASS)}
            aria-hidden
          />
          Team-specific note
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);

type ServicePlanElementRowProps = {
  element: ServicePlanElement;
  canEdit: boolean;
  onRemove: () => void;
  onUpdate: (changes: Partial<ServicePlanElement>) => void;
  /** Duration/start-time edits cascade across the whole plan (see
   * servicePlanTimingUtils.ts), so they're handled one level up rather than
   * folded into onUpdate. */
  onDurationChange: (durationSeconds: number) => void;
  onStartTimeChange: (startTime: string) => void;
  /** Suggestions for "Assigned to": roster member names + past free-text
   * entries — not roster-linked/position-ranked, just names to autocomplete
   * (same pattern HistorySuggestField already provides for Overlays/Credits). */
  assignedToHistoryValues: string[];
  /** Index within the section — drives alternating row surfaces. */
  toneIndex?: number;
  /** When the plan is published, operators can pin which item shared viewers
   * (serving + public) treat as live — shown as a highlight + action on each row. */
  publicSharingEnabled?: boolean;
  /** True on the calendar day of this occurrence (in the plan timezone).
   * Make live / Follow schedule only appear then. */
  isServiceDay?: boolean;
  /** True when this row is the current live item (schedule or manual pin). */
  isLive?: boolean;
  /** True when this row is live because of an explicit manual pin. */
  isManualLive?: boolean;
  publicLiveBusy?: boolean;
  onMakePublicLive?: () => void;
  onResumePublicSchedule?: () => void;
  /** Hide shared and team notes (and note add options) without changing saved data. */
  hideNotes?: boolean;
  /**
   * When false, render a compact read-only row (view mode). When true and
   * canEdit, show editable fields — stacked on small screens, columns on md+.
   */
  isEditing?: boolean;
};

/**
 * One line per element for timing/title/assignee. Song, scripture, notes, and
 * team notes attach from a single Add menu (each option has its own color and
 * icon). Attached refs stay as removable chips; notes open inline editors.
 *
 * Elements have no operator-facing "type": an item is just a titled row, and
 * attaching a song or scripture is what gives it a kind (see
 * getServicePlanElementType).
 */
const ServicePlanElementRow = ({
  element,
  canEdit,
  onRemove,
  onUpdate,
  onDurationChange,
  onStartTimeChange,
  assignedToHistoryValues,
  toneIndex = 0,
  publicSharingEnabled = false,
  isServiceDay = false,
  isLive = false,
  isManualLive = false,
  publicLiveBusy = false,
  onMakePublicLive,
  onResumePublicSchedule,
  hideNotes = false,
  isEditing = false,
}: ServicePlanElementRowProps) => {
  const hasNotes = !isRichTextEmpty(element.notes);
  const [notesEditorOpen, setNotesEditorOpen] = useState(hasNotes);
  // Existing notes start minimized; newly added notes open expanded for editing.
  const [notesExpanded, setNotesExpanded] = useState(() => !hasNotes);
  const [expandedTeamNoteIds, setExpandedTeamNoteIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [scriptureOpen, setScriptureOpen] = useState(false);
  const formattedDuration = formatServicePlanDuration(element);
  const [durationText, setDurationText] = useState(formattedDuration);

  useEffect(() => {
    setDurationText(formattedDuration);
  }, [formattedDuration]);
  const allowEdit = canEdit && isEditing;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: elementDndId(element.id), disabled: !allowEdit });

  const teamNotes = element.teamNotes || [];
  const titleText = richTextToPlainText(element.title);
  const itemLabel = titleText.trim() || "item";
  const songLabel = songRefLabel(element);
  const scriptureLabel = element.scriptureRef?.label || null;
  const showNotesEditor = !hideNotes && (notesEditorOpen || hasNotes);
  const surfaceClassName = getServicePlanElementSurfaceClassName({
    toneIndex,
    isLive,
  });
  const canAddSong = !songLabel;
  const canAddScripture = !scriptureLabel;
  const canAddNote = !hideNotes && !showNotesEditor;
  const canAddTeamNote = !hideNotes;
  const canAddAttachment =
    canAddSong || canAddScripture || canAddNote || canAddTeamNote;
  const showPublicLiveControls = publicSharingEnabled && isServiceDay;

  const handleAddNote = () => {
    setNotesEditorOpen(true);
    setNotesExpanded(true);
    if (!element.notes) {
      onUpdate({ notes: EMPTY_RICH_TEXT });
    }
  };

  const handleRemoveNote = () => {
    setNotesEditorOpen(false);
    setNotesExpanded(false);
    onUpdate({ notes: EMPTY_RICH_TEXT });
  };

  const handleAddTeamNote = () => {
    const id = generateRandomId();
    setExpandedTeamNoteIds((prev) => new Set(prev).add(id));
    onUpdate({
      teamNotes: [
        ...teamNotes,
        { id, label: "", note: EMPTY_RICH_TEXT },
      ],
    });
  };

  const setTeamNoteExpanded = (teamNoteId: string, expanded: boolean) => {
    setExpandedTeamNoteIds((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(teamNoteId);
      else next.delete(teamNoteId);
      return next;
    });
  };

  const addMenu = (
    <AddAttachmentMenu
      itemLabel={itemLabel}
      canEdit={allowEdit}
      canAddSong={canAddSong}
      canAddScripture={canAddScripture}
      canAddNote={canAddNote}
      canAddTeamNote={canAddTeamNote}
      onAddSong={() => setSongPickerOpen(true)}
      onAddScripture={() => setScriptureOpen(true)}
      onAddNote={handleAddNote}
      onAddTeamNote={handleAddTeamNote}
    />
  );

  let attachmentsTrailing: ReactNode = null;
  if (allowEdit && canAddAttachment) {
    attachmentsTrailing = canAddScripture ? (
      <ServicePlanScripturePopover
        open={scriptureOpen}
        onOpenChange={setScriptureOpen}
        disabled={!allowEdit}
        onSelect={(scriptureRef) => onUpdate({ scriptureRef })}
        anchor={<span className="inline-flex">{addMenu}</span>}
      />
    ) : (
      addMenu
    );
  }

  const liveControls = (
    <>
      {isLive ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          aria-label={
            isManualLive
              ? `Live (pinned): ${itemLabel}`
              : `Live on schedule: ${itemLabel}`
          }
        >
          <Radio className="size-3" aria-hidden="true" />
          Live
        </span>
      ) : null}
      {showPublicLiveControls ? (
        isManualLive ? (
          <Button
            type="button"
            variant="secondary"
            iconSize="sm"
            className="shrink-0 max-md:min-h-0"
            svg={Radio}
            color={SERVICE_PLAN_MAKE_LIVE_ICON_COLOR}
            disabled={!canEdit || publicLiveBusy}
            onClick={onResumePublicSchedule}
            aria-label={`Resume schedule (currently live: ${itemLabel})`}
          >
            {publicLiveBusy ? "Updating…" : "Follow schedule"}
          </Button>
        ) : !isLive ? (
          <Button
            type="button"
            variant="tertiary"
            iconSize="sm"
            className="shrink-0 max-md:min-h-0"
            svg={Radio}
            color={SERVICE_PLAN_MAKE_LIVE_ICON_COLOR}
            disabled={!canEdit || publicLiveBusy}
            onClick={onMakePublicLive}
            aria-label={`Make ${itemLabel} live`}
          />
        ) : null
      ) : null}
    </>
  );

  const attachmentChips = (songLabel || scriptureLabel || attachmentsTrailing) ? (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 px-1.5 pb-1.5 md:pb-1",
        allowEdit ? "pl-9" : "pl-1.5",
      )}
    >
      {songLabel ? (
        <span
          className={cn(
            SERVICE_PLAN_ATTACHMENT_CHIP_CLASS,
            SERVICE_PLAN_SONG_CHIP_CLASS,
          )}
        >
          <Icon
            svg={Music}
            size="xs"
            className={SERVICE_PLAN_SONG_ICON_CLASS}
          />
          <span className="max-w-44 truncate">{songLabel}</span>
          {allowEdit ? (
            <Button
              type="button"
              variant="tertiary"
              iconSize="xs"
              padding="p-0"
              className="h-4 w-4 max-md:min-h-0"
              svg={X}
              aria-label="Remove song"
              onClick={() => onUpdate({ songRef: undefined })}
            />
          ) : null}
        </span>
      ) : null}
      {scriptureLabel ? (
        <span
          className={cn(
            SERVICE_PLAN_ATTACHMENT_CHIP_CLASS,
            SERVICE_PLAN_SCRIPTURE_CHIP_CLASS,
          )}
        >
          <Icon
            svg={BookOpen}
            size="xs"
            className={SERVICE_PLAN_SCRIPTURE_ICON_CLASS}
          />
          <span className="max-w-44 truncate">{scriptureLabel}</span>
          {allowEdit ? (
            <Button
              type="button"
              variant="tertiary"
              iconSize="xs"
              padding="p-0"
              className="h-4 w-4 max-md:min-h-0"
              svg={X}
              aria-label="Remove scripture"
              onClick={() => onUpdate({ scriptureRef: undefined })}
            />
          ) : null}
        </span>
      ) : null}
      {attachmentsTrailing}
    </div>
  ) : null;

  const notesBlock = showNotesEditor ? (
    <div className="mx-1.5 mb-1.5 rounded-md border border-yellow-500/40 p-1.5 md:mb-1">
      <ExpandableNotePanel
        expanded={notesExpanded}
        minimized={
          <MinimizedNoteRow
            icon={StickyNote}
            iconClassName={SERVICE_PLAN_NOTE_ICON_CLASS}
            title="Notes"
            preview={richTextOneLinePreview(element.notes)}
            emptyPreview="Empty note"
            expandLabel="Expand notes"
            removeLabel="Remove note"
            canEdit={allowEdit}
            onExpand={() => setNotesExpanded(true)}
            onRemove={handleRemoveNote}
          />
        }
      >
        <RichTextEditor
          label="Notes"
          hideLabel
          placeholder="Notes for this item (optional)"
          value={element.notes || EMPTY_RICH_TEXT}
          disabled={!allowEdit}
          onChange={(notes) => onUpdate({ notes })}
          toolbarLeading={
            <div className="flex shrink-0 items-center gap-1 pt-0.5">
              <Button
                type="button"
                variant="tertiary"
                svg={ChevronDown}
                iconSize="xs"
                padding="p-0.5"
                className="h-6 w-6 max-md:min-h-0"
                aria-expanded
                aria-label="Minimize notes"
                onClick={() => setNotesExpanded(false)}
              />
              <p className="flex items-center gap-1.5 text-xs font-medium text-white">
                <StickyNote
                  className={cn("size-3.5", SERVICE_PLAN_NOTE_ICON_CLASS)}
                  aria-hidden
                />
                Notes
              </p>
            </div>
          }
          toolbarTrailing={
            allowEdit ? (
              <Button
                type="button"
                variant="tertiary"
                iconSize="sm"
                className="shrink-0 max-md:min-h-0"
                svg={Trash2}
                aria-label="Remove note"
                onClick={handleRemoveNote}
              />
            ) : null
          }
        />
      </ExpandableNotePanel>
    </div>
  ) : null;

  const teamNotesBlock = !hideNotes && teamNotes.length > 0 ? (
    <div className="space-y-1.5 px-1.5 pb-1.5 md:space-y-1 md:pb-1">
      {teamNotes.map((teamNote) => {
        const teamTitle = teamNote.label.trim() || "Team note";
        const teamExpanded = expandedTeamNoteIds.has(teamNote.id);
        return (
          <div
            key={teamNote.id}
            className="rounded-md border border-emerald-500/40 p-1.5"
          >
            <ExpandableNotePanel
              expanded={teamExpanded}
              minimized={
                <MinimizedNoteRow
                  icon={Users}
                  iconClassName={SERVICE_PLAN_TEAM_NOTE_ICON_CLASS}
                  title={teamTitle}
                  preview={richTextOneLinePreview(teamNote.note)}
                  emptyPreview="Empty note"
                  expandLabel={`Expand ${teamTitle}`}
                  removeLabel={`Remove ${teamTitle}`}
                  canEdit={allowEdit}
                  onExpand={() => setTeamNoteExpanded(teamNote.id, true)}
                  onRemove={() =>
                    onUpdate({
                      teamNotes: teamNotes.filter(
                        (note) => note.id !== teamNote.id,
                      ),
                    })
                  }
                />
              }
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={ChevronDown}
                    iconSize="xs"
                    padding="p-0.5"
                    className="h-6 w-6 shrink-0 max-md:min-h-0"
                    aria-expanded
                    aria-label={`Minimize ${teamTitle}`}
                    onClick={() => setTeamNoteExpanded(teamNote.id, false)}
                  />
                  <Users
                    className={cn(
                      "size-3.5 shrink-0",
                      SERVICE_PLAN_TEAM_NOTE_ICON_CLASS,
                    )}
                    aria-hidden
                  />
                  {allowEdit ? (
                    <Input
                      label="Team note label"
                      hideLabel
                      placeholder="e.g. Band, Media, Coordinators"
                      className="min-w-0 flex-1"
                      value={teamNote.label}
                      onChange={(label) =>
                        onUpdate({
                          teamNotes: teamNotes.map((note) =>
                            note.id === teamNote.id
                              ? { ...note, label: String(label) }
                              : note,
                          ),
                        })
                      }
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {teamTitle}
                    </span>
                  )}
                  {allowEdit ? (
                    <Button
                      type="button"
                      variant="tertiary"
                      iconSize="sm"
                      className="ml-auto shrink-0 max-md:min-h-0"
                      svg={Trash2}
                      aria-label={`Remove ${teamTitle}`}
                      onClick={() =>
                        onUpdate({
                          teamNotes: teamNotes.filter(
                            (note) => note.id !== teamNote.id,
                          ),
                        })
                      }
                    />
                  ) : null}
                </div>
                <RichTextEditor
                  label={`${teamTitle} note`}
                  hideLabel
                  placeholder="Only shown to this team"
                  value={teamNote.note}
                  disabled={!allowEdit}
                  onChange={(note) =>
                    onUpdate({
                      teamNotes: teamNotes.map((existing) =>
                        existing.id === teamNote.id
                          ? { ...existing, note }
                          : existing,
                      ),
                    })
                  }
                />
              </div>
            </ExpandableNotePanel>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
      className={surfaceClassName}
      data-element-tone={toneIndex % 2 === 0 ? "even" : "odd"}
    >
      {allowEdit ? (
        <div className="flex items-start gap-1 px-1.5 py-2 md:items-center md:py-1.5">
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="tertiary"
            iconSize="sm"
            className="mt-0.5 shrink-0 touch-none max-md:min-h-0 md:mt-0"
            svg={GripVertical}
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          />

          {/* Mobile: stack timing → title → assignee. Desktop: one compact row. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 md:flex-row md:items-center md:gap-1.5">
            <div className="flex w-full items-center gap-1.5 md:contents">
              <TimePicker
                label="Time"
                hideLabel
                labelLayout="inline"
                className="min-w-0 flex-1 md:w-24 md:flex-none"
                inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
                value={element.startTime || ""}
                onChange={(value) => value && onStartTimeChange(String(value))}
              />
              <Input
                label="Duration"
                hideLabel
                placeholder="5 min"
                className="min-w-0 flex-1 md:w-16 md:flex-none"
                inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
                value={durationText}
                onChange={(value) => setDurationText(String(value))}
                onBlur={(event) => {
                  const raw = event.currentTarget.value;
                  const seconds = parseServicePlanDuration(raw);
                  if (seconds === null) {
                    setDurationText(formatServicePlanDuration(element));
                    return;
                  }
                  setDurationText(raw);
                  onDurationChange(seconds);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </div>
            <Input
              label="Title"
              hideLabel
              placeholder="Item name"
              className="min-w-0 w-full md:flex-1"
              inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
              value={titleText}
              onChange={(value) =>
                onUpdate({ title: plainTextToRichText(String(value)) })
              }
            />
            <HistorySuggestField
              label="Assigned to"
              hideLabel
              placeholder="Assigned to"
              multiline={false}
              className="w-full md:w-[6.5rem] md:shrink-0 lg:w-36"
              inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
              value={element.assignedName || ""}
              onChange={(value) => onUpdate({ assignedName: value })}
              historyValues={assignedToHistoryValues}
            />
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5 md:flex-row md:items-center">
            {liveControls}
            <Button
              type="button"
              variant="tertiary"
              iconSize="sm"
              className="shrink-0 max-md:min-h-0"
              svg={Trash2}
              aria-label={`Remove ${itemLabel}`}
              onClick={onRemove}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 px-1.5 py-2.5 md:py-1.5">
          <span className="w-[3.75rem] shrink-0 whitespace-nowrap text-xs leading-4 tabular-nums text-gray-400">
            {formatPlanStartTimeDisplay(element.startTime) || "—"}
          </span>
          <span className="w-12 shrink-0 whitespace-nowrap text-xs leading-4 tabular-nums text-gray-500">
            {formattedDuration || "—"}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-xs font-medium leading-5 text-gray-50">
              {titleText.trim() || "Untitled"}
            </p>
            {element.assignedName?.trim() ? (
              <p className="truncate text-[11px] leading-4 text-gray-400 md:hidden">
                {element.assignedName.trim()}
              </p>
            ) : null}
          </div>
          <span className="hidden w-28 shrink-0 truncate text-xs leading-4 text-gray-400 md:block lg:w-36">
            {element.assignedName?.trim() || ""}
          </span>
          <div className="flex shrink-0 items-center gap-0.5 self-center">
            {liveControls}
          </div>
        </div>
      )}

      {attachmentChips}
      {notesBlock}
      {teamNotesBlock}

      {songPickerOpen ? (
        <ServicePlanLibraryPicker
          isOpen
          onClose={() => setSongPickerOpen(false)}
          onSelectSong={(songRef) => onUpdate({ songRef })}
        />
      ) : null}
    </div>
  );
};

export default ServicePlanElementRow;
