import { useEffect, useMemo, useState, type FunctionComponent, type ReactNode, type SVGProps } from "react";
import {
  BookOpen,
  ChevronDown,
  GripVertical,
  Music,
  Plus,
  Radio,
  StickyNote,
  Trash2,
  UserRound,
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
import ServicePlanRolePicker from "../../components/ServicePlanRolePicker";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import ServicePlanSongSuggestionPopover from "./ServicePlanSongSuggestionPopover";
import { roleNoteMatchesServicePlanTeam } from "./servicePlanRoleNoteTeam";
import {
  SERVICE_PLAN_ATTACHMENT_CHIP_CLASS,
  SERVICE_PLAN_SCRIPTURE_CHIP_CLASS,
  SERVICE_PLAN_SONG_CHIP_CLASS,
  SERVICE_PLAN_SONG_ICON_CLASS,
  SERVICE_PLAN_UNLINKED_SONG_CHIP_CLASS,
  SERVICE_PLAN_UNLINKED_SONG_ICON_CLASS,
} from "./servicePlanChipStyles";
import type {
  ServicePlanElement,
  ServicePlanSongReference,
} from "../../types/servicePlan";

export const elementDndId = (elementId: string) => `element:${elementId}`;

/** Stable DOM id for scrolling the plan list to a live element. */
export const servicePlanElementDomId = (elementId: string) =>
  `service-plan-element-${elementId}`;

/** Match TimePicker's 12-hour display for compact view-mode rows. */
export const formatPlanStartTimeDisplay = (startTime: string | undefined): string => {
  const parsed = parseTimeCountdown(startTime);
  if (!parsed?.hour || !parsed.minute || !parsed.meridiem) return startTime?.trim() || "";
  return `${pad2(parsed.hour)}:${parsed.minute} ${parsed.meridiem}`;
};

/** Soft field chrome so inline editors sit closer to the row surface. */
export const SERVICE_PLAN_INLINE_INPUT_CLASS =
  "h-7 min-h-0 border-0 bg-gray-950/70 px-1 py-0.5 shadow-none placeholder:text-gray-500";

/** Rich text note fields — same blend as inline plan inputs, multi-line height. */
export const SERVICE_PLAN_INLINE_EDITOR_CLASS =
  "min-h-7 rounded-md border-0 bg-gray-950/70 px-1 py-0.5 shadow-none focus-visible:ring-0";

export const SERVICE_PLAN_NOTE_ICON_CLASS = "text-yellow-300";
export const SERVICE_PLAN_TEAM_NOTE_ICON_CLASS = "text-sky-400";

export type ServicePlanRoleNoteOption = {
  positionId: string;
  label: string;
  teamId?: string;
  teamName?: string;
};
/** Light red for day-of-service Make live. */
export const SERVICE_PLAN_MAKE_LIVE_ICON_COLOR = "#fca5a5";

/**
 * Shared plan-list column chrome. Header and rows must use the same widths and
 * gaps or TIME / LEN / TITLE / ASSIGNED drift apart.
 */
export const SERVICE_PLAN_COL = {
  row: "flex items-center gap-1.5 px-1.5",
  drag: "w-7 shrink-0",
  /** Wide enough for "10:00 AM" / "07:00 PM" tabular time. */
  timeView: "w-[4.75rem] shrink-0",
  /** Desktop edit width; pair with flex-1 on small screens. */
  timeEdit: "md:w-24 md:shrink-0 md:flex-none",
  /** Wide enough for "10 min" / "99 min" tabular duration. */
  durationView: "w-16 shrink-0",
  durationEdit: "md:w-16 md:shrink-0 md:flex-none",
  title: "min-w-0 flex-1",
  assignedView: "hidden w-28 shrink-0 md:block lg:w-36",
  assignedEdit: "md:w-36 md:shrink-0",
  /** Content-sized in view so empty live slots do not steal title space. */
  actionsView: "flex min-w-0 shrink-0 items-center justify-end gap-0.5 overflow-hidden",
  /** Fixed so live/delete trailing controls do not shift Assigned. */
  actionsEdit: "flex w-28 shrink-0 items-center justify-end gap-0.5 overflow-hidden",
} as const;

/** Shared column header for the compact plan list. */
export const ServicePlanElementColumnHeader = ({
  isEditing = false,
  showActionsColumn = false,
}: {
  isEditing?: boolean;
  /** Match row trailing gutter when live controls or edit actions are present. */
  showActionsColumn?: boolean;
}) => (
  <div
    className={cn(
      SERVICE_PLAN_COL.row,
      "border-b border-gray-700/80 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400",
      isEditing && "max-md:hidden",
    )}
    aria-hidden
  >
    {isEditing ? <span className={SERVICE_PLAN_COL.drag} /> : null}
    <span className={isEditing ? SERVICE_PLAN_COL.timeEdit : SERVICE_PLAN_COL.timeView}>
      Time
    </span>
    <span
      className={
        isEditing ? SERVICE_PLAN_COL.durationEdit : SERVICE_PLAN_COL.durationView
      }
    >
      {isEditing ? "Length" : "Len"}
    </span>
    <span className={SERVICE_PLAN_COL.title}>Title</span>
    <span
      className={
        isEditing ? SERVICE_PLAN_COL.assignedEdit : SERVICE_PLAN_COL.assignedView
      }
    >
      Assigned
    </span>
    {isEditing || showActionsColumn ? (
      <span
        className={isEditing ? SERVICE_PLAN_COL.actionsEdit : SERVICE_PLAN_COL.actionsView}
      />
    ) : null}
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

const songRefLabel = (
  songRef: ServicePlanSongReference | undefined,
): string | null => {
  if (!songRef) return null;
  return songRef.kind === "library"
    ? songRef.songName
    : songRef.title || "Untitled song";
};

type NoteAccordionTriggerProps = {
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  iconClassName: string;
  title: string;
  preview: string;
  emptyPreview: string;
  expanded: boolean;
  expandLabel: string;
  collapseLabel: string;
  removeLabel: string;
  canEdit: boolean;
  onToggle: () => void;
  onRemove: () => void;
  /** Edit-mode control shown beside the toggle (e.g. team label input). */
  titleControl?: ReactNode;
};

/**
 * Accordion chrome for notes: taller hit target, pointer cursor, and the same
 * full-row toggle for expand and collapse (view mode). Edit controls stay outside
 * the toggle so inputs and delete do not collapse the panel.
 */
const NoteAccordionTrigger = ({
  icon,
  iconClassName,
  title,
  preview,
  emptyPreview,
  expanded,
  expandLabel,
  collapseLabel,
  removeLabel,
  canEdit,
  onToggle,
  onRemove,
  titleControl,
}: NoteAccordionTriggerProps) => (
  <div className="flex min-w-0 items-center gap-1">
    <button
      type="button"
      className={cn(
        "flex min-h-8 cursor-pointer items-center gap-1.5 rounded px-0.5 py-1.5 text-left hover:bg-gray-800/60",
        titleControl ? "shrink-0" : "min-w-0 flex-1",
      )}
      aria-expanded={expanded}
      aria-label={expanded ? collapseLabel : expandLabel}
      onClick={onToggle}
    >
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-gray-400 transition-transform duration-200 ease-out motion-reduce:transition-none",
          !expanded && "-rotate-90",
        )}
        aria-hidden
      />
      <Icon svg={icon} size="xs" className={cn("shrink-0", iconClassName)} />
      {!titleControl ? (
        <span className="shrink-0 text-xs font-medium text-white">{title}</span>
      ) : null}
      {!expanded ? (
        <span className="min-w-0 truncate text-xs text-gray-400">
          {preview || emptyPreview}
        </span>
      ) : null}
    </button>
    {titleControl ? <div className="min-w-0 flex-1">{titleControl}</div> : null}
    {canEdit ? (
      <Button
        type="button"
        variant="tertiary"
        iconSize="xs"
        padding="p-0.5"
        className="h-7 w-7 shrink-0 max-md:min-h-0"
        svg={Trash2}
        aria-label={removeLabel}
        onClick={onRemove}
      />
    ) : null}
  </div>
);

/** Animate expanded note body under a persistent accordion trigger. */
const ExpandableNotePanel = ({
  expanded,
  trigger,
  children,
}: {
  expanded: boolean;
  trigger: ReactNode;
  children: ReactNode;
}) => (
  <>
    {trigger}
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
  canAddRoleNote: boolean;
  roleNoteOptions: ServicePlanRoleNoteOption[];
  onAddSong: () => void;
  onAddScripture: () => void;
  onAddNote: () => void;
  onAddTeamNote: () => void;
  onAddRoleNote: (positionId: string) => void;
};

const ROLE_TEAM_FILTER_STORAGE_KEY = "worshipsyncServicePlanRoleTeamFilter";

const RoleNoteAudienceSubmenu = ({
  options,
  onSelectRole,
}: {
  options: ServicePlanRoleNoteOption[];
  onSelectRole: (positionId: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState(() => {
    try {
      return window.localStorage.getItem(ROLE_TEAM_FILTER_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const teams = useMemo(() => {
    const byId = new Map<string, string>();
    options.forEach((role) => {
      if (role.teamId && role.teamName) byId.set(role.teamId, role.teamName);
    });
    return Array.from(byId, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [options]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRoles = options.filter((role) => {
    if (teamId && role.teamId !== teamId) return false;
    return !normalizedQuery || `${role.label} ${role.teamName || ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const chooseTeam = (nextTeamId: string) => {
    setTeamId(nextTeamId);
    try {
      if (nextTeamId) window.localStorage.setItem(ROLE_TEAM_FILTER_STORAGE_KEY, nextTeamId);
      else window.localStorage.removeItem(ROLE_TEAM_FILTER_STORAGE_KEY);
    } catch {
      // Storage is optional; role selection remains available.
    }
  };

  return (
    <div className="w-72 space-y-2 p-1">
      <Input
        value={query}
        onChange={(value) => setQuery(String(value))}
        placeholder="Search roles"
        aria-label="Search roles"
        className="w-full"
        inputClassName="h-8 min-h-0 bg-gray-950 text-sm"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <div>
        <p className="mb-1 text-[11px] font-medium text-gray-400">Filter by team</p>
        <div className="max-h-24 overflow-y-auto pr-0.5">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by team">
            <Button
              variant={!teamId ? "cta" : "tertiary"}
              aria-pressed={!teamId}
              className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseTeam("");
              }}
            >
              All teams
            </Button>
            {teams.map((team) => {
              const selected = team.id === teamId;
              return (
                <Button
                  key={team.id}
                  variant={selected ? "cta" : "tertiary"}
                  aria-pressed={selected}
                  className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    chooseTeam(team.id);
                  }}
                >
                  {team.name}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto rounded border border-gray-700 p-1">
        {filteredRoles.map((role) => (
          <Button
            key={role.positionId}
            variant="tertiary"
            className="max-md:min-h-0 w-full px-2 py-1 text-left text-xs"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectRole(role.positionId);
            }}
          >
            <span className="block truncate">{role.label}</span>
          </Button>
        ))}
        {filteredRoles.length === 0 ? (
          <p className="px-2 py-3 text-xs text-gray-400">No matching roles.</p>
        ) : null}
      </div>
    </div>
  );
};

const AddAttachmentMenu = ({
  itemLabel,
  canEdit,
  canAddSong,
  canAddScripture,
  canAddNote,
  canAddTeamNote,
  canAddRoleNote,
  roleNoteOptions,
  onAddSong,
  onAddScripture,
  onAddNote,
  onAddTeamNote,
  onAddRoleNote,
}: AddAttachmentMenuProps) => {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
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
        {canAddRoleNote ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRound
                className={cn("size-4", SERVICE_PLAN_TEAM_NOTE_ICON_CLASS)}
                aria-hidden
              />
              Role-specific note
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="p-1">
              <RoleNoteAudienceSubmenu
                options={roleNoteOptions}
                onSelectRole={(positionId) => {
                  onAddRoleNote(positionId);
                  setOpen(false);
                }}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

type ServicePlanElementRowProps = {
  element: ServicePlanElement;
  canEdit: boolean;
  onRemove: () => void;
  /**
   * `coalesceKey` marks a *continuous* edit of one field (typing, dragging a
   * value) so undo steps back over the whole burst. Structural edits — adding
   * or removing a note, attaching a song — pass nothing and stay their own
   * undo step. Defaulting to nothing matters: a missing key only costs an
   * extra undo press, while a wrong one would swallow a removal into the
   * typing that preceded it.
   */
  onUpdate: (
    changes: Partial<ServicePlanElement>,
    coalesceKey?: string,
  ) => void;
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
  /** True on the calendar day of this occurrence (in the plan timezone). */
  isServiceDay?: boolean;
  /** True when this row is the current live item (schedule or manual pin). */
  isLive?: boolean;
  /** True when this row is live because of an explicit manual pin. */
  isManualLive?: boolean;
  /** True when this row starts an adjusted, automatically advancing timeline. */
  isAdjustedLive?: boolean;
  /** Display time from the adjusted timeline, for this item and following items. */
  adjustedStartTime?: string;
  /** Shown on the live item after a Make live timeline re-anchor. */
  liveStartedAtLabel?: string;
  /** Accessible-only timing context for an adjusted live item. */
  liveStartedAtDescription?: string;
  publicLiveBusy?: boolean;
  onMakePublicLive?: () => void;
  /** Hide shared and team notes (and note add options) without changing saved data. */
  hideNotes?: boolean;
  /** Empty = all teams; otherwise only team notes whose label matches. */
  teamNotesFilter?: string;
  /** Empty = all roles in the selected team; otherwise only this Teams role. */
  roleNotesFilter?: string;
  roleNoteOptions?: ServicePlanRoleNoteOption[];
  /**
   * When false, render a compact read-only row (view mode). When true and
   * canEdit, show editable fields — stacked on small screens, columns on md+.
   */
  isEditing?: boolean;
  /** Opens the shared lyrics viewer for a library song badge. */
  onViewSongLyrics?: (songRef: ServicePlanSongReference) => void;
  /**
   * Full or music controller access: unmatched ("Not in library") songs open
   * Create song instead of a lyrics viewer, then attach the new library song.
   */
  canCreateLibrarySong?: boolean;
  /**
   * Overrides the element's stored song reference for display and actions, for
   * the case where a song an import couldn't find has since been added to the
   * library. Derived per plan by servicePlanSongResolution.ts; absent means the
   * stored reference still stands.
   */
  resolvedSongRef?: ServicePlanSongReference;
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
  isServiceDay = false,
  isLive = false,
  isManualLive = false,
  isAdjustedLive = false,
  adjustedStartTime,
  liveStartedAtLabel,
  liveStartedAtDescription,
  publicLiveBusy = false,
  onMakePublicLive,
  hideNotes = false,
  teamNotesFilter = "",
  roleNotesFilter = "",
  roleNoteOptions = [],
  isEditing = false,
  onViewSongLyrics,
  canCreateLibrarySong = false,
  resolvedSongRef,
}: ServicePlanElementRowProps) => {
  const hasNotes = !isRichTextEmpty(element.notes);
  const [notesEditorOpen, setNotesEditorOpen] = useState(hasNotes);
  // Existing notes start minimized; newly added notes open expanded for editing.
  const [notesExpanded, setNotesExpanded] = useState(() => !hasNotes);
  const [expandedTeamNoteIds, setExpandedTeamNoteIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [songPickerStartInCreate, setSongPickerStartInCreate] = useState(false);
  const [songSuggestionsOpen, setSongSuggestionsOpen] = useState(false);
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

  const scopedNotes = element.teamNotes || [];
  const teamNotes = scopedNotes.filter((note) => note.scope !== "role");
  const roleNotes = scopedNotes.filter((note) => note.scope === "role");
  const visibleTeamNotes = teamNotesFilter
    ? teamNotes.filter((note) => note.label.trim() === teamNotesFilter)
    : teamNotes;
  const teamScopedRoleNotes = roleNotes.filter((note) =>
    roleNoteMatchesServicePlanTeam(note, teamNotesFilter),
  );
  const visibleRoleNotes = roleNotesFilter
    ? teamScopedRoleNotes.filter((note) => note.positionId === roleNotesFilter)
    : teamScopedRoleNotes;
  const titleText = richTextToPlainText(element.title);
  const itemLabel = titleText.trim() || "item";
  // What the plan means today: the stored reference, unless a song it couldn't
  // find at import time has since been added to the library.
  const songRef = resolvedSongRef ?? element.songRef;
  const songLabel = songRefLabel(songRef);
  // A "pending" ref names a song with no library doc behind it, so there is
  // nothing to project yet — the operator still has to find and link the song.
  const isSongUnlinked = songRef?.kind === "pending";
  const canLinkSong = isSongUnlinked && allowEdit;
  // Outside edit mode, full/music operators create the missing library song
  // instead of opening a lyrics viewer that has nothing durable to show.
  const canCreateMissingSong = isSongUnlinked && canCreateLibrarySong && !canLinkSong;
  const pendingSongTitle = songRef?.kind === "pending" ? songRef.title : "";
  const pendingSongLyrics = songRef?.kind === "pending" ? songRef.lyricsText : "";
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
  const canAddRoleNote = !hideNotes && roleNoteOptions.length > 0;
  const canAddAttachment =
    canAddSong || canAddScripture || canAddNote || canAddTeamNote || canAddRoleNote;
  const showLiveControls = isServiceDay;

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
        ...scopedNotes,
        {
          id,
          label: teamNotesFilter || "",
          note: EMPTY_RICH_TEXT,
        },
      ],
    });
  };

  const handleCreateRoleNote = (positionId: string) => {
    const role = roleNoteOptions.find((option) => option.positionId === positionId);
    if (!role) return;
    const id = generateRandomId();
    setExpandedTeamNoteIds((prev) => new Set(prev).add(id));
    onUpdate({
      teamNotes: [
        ...scopedNotes,
        {
          id,
          scope: "role",
          positionId: role.positionId,
          label: role.label,
          ...(role.teamId ? { teamId: role.teamId } : {}),
          ...(role.teamName ? { teamName: role.teamName } : {}),
          note: EMPTY_RICH_TEXT,
        },
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

  const openSongPicker = (startInCreate = false) => {
    setSongPickerStartInCreate(startInCreate);
    setSongPickerOpen(true);
  };

  const closeSongPicker = () => {
    setSongPickerOpen(false);
    setSongPickerStartInCreate(false);
  };

  const addMenu = (
    <AddAttachmentMenu
      itemLabel={itemLabel}
      canEdit={allowEdit}
      canAddSong={canAddSong}
      canAddScripture={canAddScripture}
      canAddNote={canAddNote}
      canAddTeamNote={canAddTeamNote}
      canAddRoleNote={canAddRoleNote}
      roleNoteOptions={roleNoteOptions}
      onAddSong={() => openSongPicker(false)}
      onAddScripture={() => setScriptureOpen(true)}
      onAddNote={handleAddNote}
      onAddTeamNote={handleAddTeamNote}
      onAddRoleNote={handleCreateRoleNote}
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
          className="inline-flex min-w-0 max-w-full shrink items-center gap-0.5 truncate rounded bg-emerald-500 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          aria-label={
            isManualLive
              ? `Live (pinned): ${itemLabel}`
              : isAdjustedLive
                ? `Live, started ${liveStartedAtDescription || "now"}: ${itemLabel}`
                : `Live on schedule: ${itemLabel}`
          }
        >
          <Radio className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {liveStartedAtLabel ? `Live · started ${liveStartedAtLabel}` : "Live"}
          </span>
        </span>
      ) : null}
      {showLiveControls && !isLive ? (
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
      ) : null}
    </>
  );

  const songChipInteractive =
    canLinkSong || canCreateMissingSong || Boolean(!isSongUnlinked && onViewSongLyrics);

  const handleSongChipClick = () => {
    if (canLinkSong) {
      setSongSuggestionsOpen(true);
      return;
    }
    if (canCreateMissingSong) {
      openSongPicker(true);
      return;
    }
    if (!isSongUnlinked && songRef) {
      onViewSongLyrics?.(songRef);
    }
  };

  let songChipLabel = `View lyrics for ${songLabel}`;
  if (canLinkSong) {
    songChipLabel = `Link ${songLabel} to a song in the library`;
  } else if (canCreateMissingSong) {
    songChipLabel = `Create ${songLabel} in the library`;
  }

  const songChipContent = (
    <>
      <Icon
        svg={Music}
        size="xs"
        className={
          isSongUnlinked
            ? SERVICE_PLAN_UNLINKED_SONG_ICON_CLASS
            : SERVICE_PLAN_SONG_ICON_CLASS
        }
      />
      <span className="max-w-44 truncate">{songLabel}</span>
      {isSongUnlinked ? (
        <span className="shrink-0 whitespace-nowrap text-amber-200/90">
          · Not in library
        </span>
      ) : null}
    </>
  );

  const songChipButton = songLabel && songRef ? (
    songChipInteractive ? (
      <button
        type="button"
        className={cn(
          "flex min-w-0 items-center gap-0.5 rounded text-left focus-visible:outline-none focus-visible:ring-1",
          isSongUnlinked
            ? "hover:bg-amber-400/10 focus-visible:ring-amber-300"
            : "hover:bg-cyan-500/10 focus-visible:ring-cyan-400",
        )}
        aria-haspopup={canLinkSong || canCreateMissingSong ? "dialog" : undefined}
        aria-expanded={canLinkSong ? songSuggestionsOpen : undefined}
        aria-label={songChipLabel}
        // Opens rather than toggles: the chip is the popover's anchor, not its
        // trigger, so Radix already dismisses on a click outside the panel.
        onClick={handleSongChipClick}
      >
        {songChipContent}
      </button>
    ) : (
      <span className="flex min-w-0 items-center gap-0.5">{songChipContent}</span>
    )
  ) : null;

  const attachmentChips = (songLabel || scriptureLabel || attachmentsTrailing) ? (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 px-1.5 pb-1.5 md:pb-1",
        allowEdit ? "pl-9" : "pl-1.5",
      )}
    >
      {songChipButton && songRef ? (
        <span
          className={cn(
            SERVICE_PLAN_ATTACHMENT_CHIP_CLASS,
            isSongUnlinked
              ? SERVICE_PLAN_UNLINKED_SONG_CHIP_CLASS
              : SERVICE_PLAN_SONG_CHIP_CLASS,
          )}
        >
          {canLinkSong ? (
            <ServicePlanSongSuggestionPopover
              open={songSuggestionsOpen}
              onOpenChange={setSongSuggestionsOpen}
              title={pendingSongTitle}
              onSelectSong={(songRef) => onUpdate({ songRef })}
              onOpenLibrary={() => openSongPicker(false)}
              onCreateSong={
                canCreateLibrarySong ? () => openSongPicker(true) : undefined
              }
              anchor={songChipButton}
            />
          ) : (
            songChipButton
          )}
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
    <div
      className={cn(
        "px-1.5 pb-1.5 md:pb-1",
        allowEdit && "pl-9",
      )}
    >
      <ExpandableNotePanel
        expanded={notesExpanded}
        trigger={
          <NoteAccordionTrigger
            icon={StickyNote}
            iconClassName={SERVICE_PLAN_NOTE_ICON_CLASS}
            title="Notes"
            preview={richTextOneLinePreview(element.notes)}
            emptyPreview="Empty note"
            expanded={notesExpanded}
            expandLabel="Expand notes"
            collapseLabel="Minimize notes"
            removeLabel="Remove note"
            canEdit={allowEdit}
            onToggle={() => setNotesExpanded((open) => !open)}
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
          editorClassName={SERVICE_PLAN_INLINE_EDITOR_CLASS}
          onChange={(notes) => onUpdate({ notes }, "notes")}
        />
      </ExpandableNotePanel>
    </div>
  ) : null;

  const teamNotesBlock = !hideNotes && visibleTeamNotes.length > 0 ? (
    <div
      className={cn(
        "space-y-1 px-1.5 pb-1.5 md:pb-1",
        allowEdit && "pl-9",
      )}
    >
      {visibleTeamNotes.map((teamNote) => {
        const teamTitle = teamNote.label.trim() || "Team note";
        const teamExpanded = expandedTeamNoteIds.has(teamNote.id);
        return (
          <ExpandableNotePanel
            key={teamNote.id}
            expanded={teamExpanded}
            trigger={
              <NoteAccordionTrigger
                icon={Users}
                iconClassName={SERVICE_PLAN_TEAM_NOTE_ICON_CLASS}
                title={teamTitle}
                preview={richTextOneLinePreview(teamNote.note)}
                emptyPreview="Empty note"
                expanded={teamExpanded}
                expandLabel={`Expand ${teamTitle}`}
                collapseLabel={`Minimize ${teamTitle}`}
                removeLabel={`Remove ${teamTitle}`}
                canEdit={allowEdit}
                onToggle={() =>
                  setTeamNoteExpanded(teamNote.id, !teamExpanded)
                }
                onRemove={() =>
                  onUpdate({
                    teamNotes: scopedNotes.filter(
                      (note) => note.id !== teamNote.id,
                    ),
                  })
                }
                titleControl={
                  allowEdit && teamExpanded ? (
                    <Input
                      label="Team note label"
                      hideLabel
                      placeholder="e.g. Band, Media, Coordinators"
                      className="min-w-0"
                      inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
                      value={teamNote.label}
                      onChange={(label) =>
                        onUpdate({
                          teamNotes: scopedNotes.map((note) =>
                            note.id === teamNote.id
                              ? { ...note, label: String(label) }
                              : note,
                          ),
                        }, `teamNote:${teamNote.id}:label`)
                      }
                    />
                  ) : undefined
                }
              />
            }
          >
            <RichTextEditor
              label={`${teamTitle} note`}
              hideLabel
              placeholder="Only shown to this team"
              value={teamNote.note}
              disabled={!allowEdit}
              editorClassName={SERVICE_PLAN_INLINE_EDITOR_CLASS}
              onChange={(note) =>
                onUpdate({
                  teamNotes: scopedNotes.map((existing) =>
                    existing.id === teamNote.id
                      ? { ...existing, note }
                      : existing,
                  ),
                }, `teamNote:${teamNote.id}:note`)
              }
            />
          </ExpandableNotePanel>
        );
      })}
    </div>
  ) : null;

  const roleNotesBlock = !hideNotes && visibleRoleNotes.length > 0 ? (
    <div
      className={cn(
        "space-y-1 px-1.5 pb-1.5 md:pb-1",
        allowEdit && "pl-9",
      )}
    >
      {visibleRoleNotes.map((roleNote) => {
        const roleTitle = roleNote.label.trim() || "Role note";
        const roleExpanded = expandedTeamNoteIds.has(roleNote.id);
        return (
          <ExpandableNotePanel
            key={roleNote.id}
            expanded={roleExpanded}
            trigger={
              <NoteAccordionTrigger
                icon={UserRound}
                iconClassName={SERVICE_PLAN_TEAM_NOTE_ICON_CLASS}
                title={roleTitle}
                preview={richTextOneLinePreview(roleNote.note)}
                emptyPreview="Empty note"
                expanded={roleExpanded}
                expandLabel={`Expand ${roleTitle}`}
                collapseLabel={`Minimize ${roleTitle}`}
                removeLabel={`Remove ${roleTitle}`}
                canEdit={allowEdit}
                onToggle={() => setTeamNoteExpanded(roleNote.id, !roleExpanded)}
                onRemove={() =>
                  onUpdate({
                    teamNotes: scopedNotes.filter((note) => note.id !== roleNote.id),
                  })
                }
                titleControl={
                  allowEdit && roleExpanded ? (
                    <ServicePlanRolePicker
                      value={roleNote.positionId || ""}
                      options={roleNoteOptions}
                      teamFilterStorageKey="worshipsyncServicePlanRoleTeamFilter"
                      ariaLabel="Role note audience"
                      placeholder="Select role"
                      allowEmpty={false}
                      className="max-w-[18rem]"
                      onValueChange={(positionId) => {
                        const role = roleNoteOptions.find(
                          (option) => option.positionId === positionId,
                        );
                        if (!role) return;
                        onUpdate({
                          teamNotes: scopedNotes.map((note) =>
                            note.id === roleNote.id
                              ? {
                                ...note,
                                scope: "role",
                                positionId: role.positionId,
                                label: role.label,
                                ...(role.teamId ? { teamId: role.teamId } : {}),
                                ...(role.teamName ? { teamName: role.teamName } : {}),
                              }
                              : note,
                          ),
                        });
                      }}
                    />
                  ) : undefined
                }
              />
            }
          >
            <RichTextEditor
              label={`${roleTitle} note`}
              hideLabel
              placeholder="Only shown to this role"
              value={roleNote.note}
              disabled={!allowEdit}
              editorClassName={SERVICE_PLAN_INLINE_EDITOR_CLASS}
              onChange={(note) =>
                onUpdate({
                  teamNotes: scopedNotes.map((existing) =>
                    existing.id === roleNote.id
                      ? { ...existing, note }
                      : existing,
                  ),
                }, `teamNote:${roleNote.id}:note`)
              }
            />
          </ExpandableNotePanel>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      id={servicePlanElementDomId(element.id)}
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
        <div
          className={cn(
            SERVICE_PLAN_COL.row,
            "items-start py-2 max-md:flex-wrap md:items-center md:py-1.5",
          )}
        >
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="tertiary"
            iconSize="sm"
            className={cn(
              SERVICE_PLAN_COL.drag,
              "mt-0.5 touch-none max-md:min-h-0 md:mt-0",
            )}
            svg={GripVertical}
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          />

          {/* Mobile: stack timing → title → assignee. Desktop: shared column widths. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 md:contents">
            <div className="flex w-full items-center gap-1.5 md:contents">
              <TimePicker
                label="Time"
                hideLabel
                labelLayout="inline"
                className={cn("min-w-0 flex-1", SERVICE_PLAN_COL.timeEdit)}
                inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
                value={element.startTime || ""}
                onChange={(value) => value && onStartTimeChange(String(value))}
              />
              <Input
                label="Duration"
                hideLabel
                placeholder="5 min"
                className={cn("min-w-0 flex-1", SERVICE_PLAN_COL.durationEdit)}
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
              className={cn("w-full", SERVICE_PLAN_COL.title)}
              inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
              value={titleText}
              onChange={(value) =>
                onUpdate({ title: plainTextToRichText(String(value)) }, "title")
              }
            />
            <HistorySuggestField
              label="Assigned to"
              hideLabel
              placeholder="Assigned to"
              multiline={false}
              className={cn("w-full", SERVICE_PLAN_COL.assignedEdit)}
              inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
              value={element.assignedName || ""}
              onChange={(value) => onUpdate({ assignedName: value }, "assignedName")}
              historyValues={assignedToHistoryValues}
            />
          </div>

          <div className={cn(SERVICE_PLAN_COL.actionsEdit, "max-md:ml-auto")}>
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
        <div className={cn(SERVICE_PLAN_COL.row, "items-start py-2.5 md:py-1.5")}>
          <span
            className={cn(
              SERVICE_PLAN_COL.timeView,
              "whitespace-nowrap text-xs leading-4 tabular-nums text-gray-400",
            )}
          >
            {formatPlanStartTimeDisplay(element.startTime) || "—"}
          </span>
          <span
            className={cn(
              SERVICE_PLAN_COL.durationView,
              "whitespace-nowrap text-xs leading-4 tabular-nums text-gray-500",
            )}
          >
            {formattedDuration || "—"}
          </span>
          <div className={cn(SERVICE_PLAN_COL.title, "space-y-0.5")}>
            <p className="truncate text-xs font-medium leading-5 text-gray-50">
              {titleText.trim() || "Untitled"}
            </p>
            {element.assignedName?.trim() ? (
              <p className="truncate text-[11px] leading-4 text-gray-400 md:hidden">
                {element.assignedName.trim()}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              SERVICE_PLAN_COL.assignedView,
              "truncate text-xs leading-4 text-gray-400",
            )}
          >
            {element.assignedName?.trim() || ""}
          </span>
          {isLive || showLiveControls ? (
            <div className={cn(SERVICE_PLAN_COL.actionsView, "self-center")}>
              {liveControls}
            </div>
          ) : null}
        </div>
      )}

      {attachmentChips}
      {notesBlock}
      {teamNotesBlock}
      {roleNotesBlock}
      {songPickerOpen ? (
        <ServicePlanLibraryPicker
          isOpen
          // Linking an unmatched import starts from the title the plan already
          // names, so the operator searches from there instead of retyping it.
          initialQuery={pendingSongTitle}
          initialLyrics={pendingSongLyrics}
          startInCreate={songPickerStartInCreate}
          onClose={closeSongPicker}
          onSelectSong={(songRef) => onUpdate({ songRef })}
        />
      ) : null}
    </div>
  );
};

export default ServicePlanElementRow;
