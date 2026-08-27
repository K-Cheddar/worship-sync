import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FunctionComponent,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Ellipsis,
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
import ServicePlanAssigneeList, { addMicrophoneSlot } from "./ServicePlanAssigneeList";
import DebouncedInput from "../../components/DebouncedInput/DebouncedInput";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/Popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
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
  ServicePlanAssignee,
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
  ServicePlanSongReference,
  ServicePlanTeamNote,
} from "../../types/servicePlan";
import {
  getServicePlanElementAssignees,
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
  getServicePlanRoleNotePositionIds,
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
/** Team/role notes — muted orange so they read as team context, not a cyan selection. */
export const SERVICE_PLAN_TEAM_NOTE_ICON_CLASS = "text-orange-300/80";

export type ServicePlanRoleNoteOption = {
  positionId: string;
  /** The concise role name shown under its team heading. */
  roleName?: string;
  label: string;
  /** Lucide position icon key from the church positions catalog. */
  icon?: string;
  teamId?: string;
  teamName?: string;
};

export type ServicePlanTeamNoteOption = {
  teamId: string;
  label: string;
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
  /** Keep the edit and view time columns aligned. */
  timeEdit: "md:w-[4.75rem] md:shrink-0 md:flex-none",
  /** Wide enough for "10 min" / "99 min" tabular duration. */
  durationView: "w-16 shrink-0",
  durationEdit: "md:w-16 md:shrink-0 md:flex-none",
  title: "min-w-0 flex-1",
  /** Keep content compact so title and assignment columns retain room. */
  contentView: "w-full shrink-0 md:w-48 md:flex-none",
  assignedView: "hidden w-28 shrink-0 md:block lg:w-36",
  assignedEdit: "md:w-36 md:shrink-0",
  /** Fixed so the header and rows keep Assigned aligned with live controls. */
  actionsView: "flex w-auto min-w-8 shrink-0 items-center justify-end gap-0.5 overflow-hidden",
  /** Keep only a compact minimum gutter when a row has no live controls. */
  actionsEdit: "flex w-auto min-w-8 shrink-0 items-center justify-end gap-0.5 overflow-hidden",
} as const;

/** Shared column header for the compact plan list. */
export const ServicePlanElementColumnHeader = ({
  isEditing = false,
  showActionsColumn = false,
  showAssignedColumn = true,
}: {
  isEditing?: boolean;
  /** Match row trailing gutter when live controls or edit actions are present. */
  showActionsColumn?: boolean;
  /** False on structure-only surfaces (templates), which carry no assignees. */
  showAssignedColumn?: boolean;
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
    <span className={cn(SERVICE_PLAN_COL.contentView, "max-md:hidden")}>Content</span>
    {showAssignedColumn ? (
      <span
        className={
          isEditing ? SERVICE_PLAN_COL.assignedEdit : SERVICE_PLAN_COL.assignedView
        }
      >
        Assigned
      </span>
    ) : null}
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

type ItemActionsMenuProps = {
  itemLabel: string;
  canEdit: boolean;
  structureOnly: boolean;
  microphones: ServicePlanMicrophone[];
  assignees: ServicePlanAssignee[];
  canAddNote: boolean;
  canAddTeamNote: boolean;
  canAddRoleNote: boolean;
  teamNoteOptions: ServicePlanTeamNoteOption[];
  roleNoteOptions: ServicePlanRoleNoteOption[];
  onAddNote: () => void;
  onAddTeamNote: (teamId: string) => void;
  onAddRoleNote: (positionId: string) => void;
  onAddMicrophone: (microphoneId: string) => void;
  onRemove: () => void;
};

const ROLE_TEAM_FILTER_STORAGE_KEY = "worshipsyncServicePlanRoleTeamFilter";

const roleOptionName = (role: ServicePlanRoleNoteOption): string =>
  role.roleName?.trim()
  || role.label.split(/\s+(?:\u00c2)?\u00b7\s+/).at(-1)?.trim()
  || "Unknown role";

const roleOptionDisplayLabel = (
  role: ServicePlanRoleNoteOption,
  options: ServicePlanRoleNoteOption[],
): string => {
  const roleName = roleOptionName(role);
  const duplicateCount = options.filter(
    (option) => roleOptionName(option).toLocaleLowerCase() === roleName.toLocaleLowerCase(),
  ).length;
  return duplicateCount > 1 && role.teamName
    ? `${role.teamName} · ${roleName}`
    : roleName;
};

const groupRoleOptionsByTeam = (options: ServicePlanRoleNoteOption[]) => {
  const groups = new Map<string, { teamName: string; options: ServicePlanRoleNoteOption[] }>();
  options.forEach((option) => {
    const key = option.teamId || option.teamName || "other";
    const group = groups.get(key) || {
      teamName: option.teamName || "Other roles",
      options: [],
    };
    group.options.push(option);
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .sort((left, right) => left.teamName.localeCompare(right.teamName))
    .map((group) => ({
      ...group,
      options: [...group.options].sort((left, right) =>
        roleOptionName(left).localeCompare(roleOptionName(right)),
      ),
    }));
};

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
        <div className="max-h-24 touch-pan-y overflow-y-auto overscroll-contain pr-0.5">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by team">
            <Button
              variant={!teamId ? "cta" : "tertiary"}
              aria-pressed={!teamId}
              className="max-md:min-h-0 rounded-full px-2 py-0.5 text-xs"
              onPointerDown={(event) => event.stopPropagation()}
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
                  onPointerDown={(event) => event.stopPropagation()}
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
      <div className="max-h-56 touch-pan-y overflow-y-auto overscroll-contain rounded border border-gray-700 p-1">
        {groupRoleOptionsByTeam(filteredRoles).map((group) => (
          <div key={group.teamName} className="py-0.5">
            <p className="px-2 py-1 text-[11px] font-medium text-gray-400">
              {group.teamName}
            </p>
            {group.options.map((role) => (
              <Button
                key={role.positionId}
                variant="tertiary"
                className="max-md:min-h-0 w-full px-2 py-1 text-left text-xs"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectRole(role.positionId);
                }}
              >
                <span className="block truncate">
                  {roleOptionDisplayLabel(role, options)}
                </span>
              </Button>
            ))}
          </div>
        ))}
        {filteredRoles.length === 0 ? (
          <p className="px-2 py-3 text-xs text-gray-400">No matching roles.</p>
        ) : null}
      </div>
    </div>
  );
};

const TeamNoteAudienceSubmenu = ({
  options,
  onSelectTeam,
}: {
  options: ServicePlanTeamNoteOption[];
  onSelectTeam: (teamId: string) => void;
}) => (
  <div className="max-h-56 w-56 touch-pan-y overflow-y-auto overscroll-contain p-1">
    {options.map((team) => (
      <Button
        key={team.teamId}
        variant="tertiary"
        className="max-md:min-h-0 w-full px-2 py-1 text-left text-xs"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelectTeam(team.teamId);
        }}
      >
        <span className="block truncate">{team.label}</span>
      </Button>
    ))}
  </div>
);

const roleAudienceLabel = (
  note: ServicePlanTeamNote,
  options: ServicePlanRoleNoteOption[],
): string => {
  const labels = getServicePlanRoleNotePositionIds(note)
    .map((positionId) => {
      const option = options.find((role) => role.positionId === positionId);
      return option ? roleOptionDisplayLabel(option, options) : undefined;
    })
    .filter((label): label is string => Boolean(label));
  return labels.join(", ") || note.label.trim() || "Role note";
};

/** Prefer role names on the trigger; fall back to a count when truncated. */
const RoleNoteAudienceTriggerLabel = ({
  names,
  count,
}: {
  names: string;
  count: number;
}) => {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      setTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [names]);

  const countLabel = `${count} role${count === 1 ? "" : "s"}`;

  return (
    <span className="relative min-w-0 flex-1 overflow-hidden">
      {/* Invisible probe keeps measuring the full name list without flicker. */}
      <span
        ref={measureRef}
        className="pointer-events-none absolute inset-0 truncate opacity-0"
        aria-hidden
      >
        {names}
      </span>
      <span className="block truncate">{truncated ? countLabel : names}</span>
    </span>
  );
};

const RoleNoteAudiencePicker = ({
  value,
  options,
  onValueChange,
}: {
  value: string[];
  options: ServicePlanRoleNoteOption[];
  onValueChange: (positionIds: string[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = options.filter((option) =>
    !normalizedQuery
    || `${roleOptionName(option)} ${option.teamName || ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const selectedRoles = options.filter((option) => value.includes(option.positionId));
  const selectedNames = selectedRoles
    .map((role) => roleOptionDisplayLabel(role, options))
    .join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          svg={ChevronDown}
          iconPosition="right"
          iconSize="xs"
          className="max-md:min-h-0 min-w-0 max-w-full text-xs"
          aria-label={
            selectedRoles.length
              ? `Role note audiences: ${selectedNames}`
              : "Role note audiences"
          }
          title={selectedRoles.length ? selectedNames : undefined}
        >
          {selectedRoles.length ? (
            <RoleNoteAudienceTriggerLabel
              names={selectedNames}
              count={selectedRoles.length}
            />
          ) : (
            <span className="truncate">Select roles</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] border-gray-700 bg-gray-900 p-2 text-gray-100">
        <Input
          value={query}
          onChange={(next) => setQuery(String(next))}
          placeholder="Search roles"
          aria-label="Search roles"
          className="w-full"
          inputClassName="h-8 min-h-0 bg-gray-950 text-sm"
        />
        <div className="mt-2 max-h-56 touch-pan-y overflow-y-auto overscroll-contain rounded border border-gray-700 p-1">
          {groupRoleOptionsByTeam(filteredOptions).map((group) => (
            <div key={group.teamName} className="py-0.5">
              <p className="px-2 py-1 text-[11px] font-medium text-gray-400">
                {group.teamName}
              </p>
              {group.options.map((option) => {
                const selected = value.includes(option.positionId);
                return (
                  <Button
                    key={option.positionId}
                    type="button"
                    variant="tertiary"
                    isSelected={selected}
                    aria-pressed={selected}
                    className={cn(
                      "max-md:min-h-0 w-full px-2 py-1 text-left text-xs",
                      selected && "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                    )}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onValueChange(
                      selected
                        ? value.filter((positionId) => positionId !== option.positionId)
                        : [...value, option.positionId],
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {roleOptionDisplayLabel(option, options)}
                      </span>
                      {selected ? (
                        <Check className="size-3.5 shrink-0 text-cyan-300" aria-hidden />
                      ) : null}
                    </span>
                  </Button>
                );
              })}
            </div>
          ))}
          {filteredOptions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-400">No matching roles.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const ItemActionsMenu = ({
  itemLabel,
  canEdit,
  structureOnly,
  microphones,
  assignees,
  canAddNote,
  canAddTeamNote,
  canAddRoleNote,
  teamNoteOptions,
  roleNoteOptions,
  onAddNote,
  onAddTeamNote,
  onAddRoleNote,
  onAddMicrophone,
  onRemove,
}: ItemActionsMenuProps) => {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="tertiary"
          svg={Ellipsis}
          iconSize="sm"
          disabled={!canEdit}
          aria-haspopup="menu"
          aria-label={structureOnly ? `Add to ${itemLabel}` : `More actions for ${itemLabel}`}
          className="max-md:min-h-0 shrink-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {canAddNote ? (
          <DropdownMenuItem onSelect={onAddNote}>
            <StickyNote
              className={cn("size-4", SERVICE_PLAN_NOTE_ICON_CLASS)}
              aria-hidden
            />
            Note
          </DropdownMenuItem>
        ) : null}
        {structureOnly && microphones.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRound className="size-4" aria-hidden />
              Microphone
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="p-1">
              {microphones
                .filter((microphone) =>
                  !assignees.some((assignee) =>
                    (assignee.microphoneIds || []).includes(microphone.id),
                  ),
                )
                .map((microphone) => (
                  <DropdownMenuItem
                    key={microphone.id}
                    onSelect={(event) => {
                      // Keep the catalog open so consecutive microphones can
                      // be assigned in their intended order.
                      event.preventDefault();
                      onAddMicrophone(microphone.id);
                    }}
                  >
                    <span className="truncate">
                      {microphone.name} · {microphone.type}
                    </span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {canAddTeamNote ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Users
                className={cn("size-4", SERVICE_PLAN_TEAM_NOTE_ICON_CLASS)}
                aria-hidden
              />
              Team-specific note
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="p-1">
              <TeamNoteAudienceSubmenu
                options={teamNoteOptions}
                onSelectTeam={(teamId) => {
                  onAddTeamNote(teamId);
                  setOpen(false);
                }}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
        <DropdownMenuSeparator className="my-1 bg-gray-700" />
        <DropdownMenuItem
          className="text-red-300 focus:bg-red-950/50 focus:text-red-100"
          onSelect={onRemove}
        >
          <Trash2 className="size-4 text-red-300" aria-hidden />
          Delete item
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AddContentMenu = ({
  itemLabel,
  canEdit,
  onAddSong,
  onAddScripture,
}: {
  itemLabel: string;
  canEdit: boolean;
  onAddSong: () => void;
  onAddScripture: () => void;
}) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="tertiary"
        svg={Plus}
        iconSize="sm"
        disabled={!canEdit}
        aria-haspopup="menu"
        aria-label={`Add content to ${itemLabel}`}
        className="max-md:min-h-0 border border-dashed border-gray-600/80 text-gray-300 hover:border-cyan-500/50 hover:text-cyan-50"
      >
        Add content
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-40">
      <DropdownMenuItem onSelect={onAddSong}>
        <Music className={cn("size-4", SERVICE_PLAN_SONG_ICON_CLASS)} aria-hidden />
        Song
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onAddScripture}>
        <BookOpen className={cn("size-4", SERVICE_PLAN_SCRIPTURE_ICON_CLASS)} aria-hidden />
        Scripture
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

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
  onRemoveAssignedToHistoryValue?: (value: string) => void;
  isAssignedToHistoryValueRemovable?: (value: string) => boolean;
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
  teamNoteOptions?: ServicePlanTeamNoteOption[];
  roleNoteOptions?: ServicePlanRoleNoteOption[];
  /** Church-wide mic catalog. Assignments remain scoped to this plan item. */
  microphones?: ServicePlanMicrophone[];
  /** Church-wide roles that see every assigned microphone. */
  microphoneAudiences?: ServicePlanMicrophoneAudience[];
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
  /**
   * When false, render a compact read-only row (view mode). When true and
   * canEdit, show editable fields — stacked on small screens, columns on md+.
   */
  isEditing?: boolean;
  /** Editor-local selection used to place the next added item. */
  isSelected?: boolean;
  onSelect?: () => void;
  /** Opens the shared lyrics viewer for a library song badge. */
  onViewSongLyrics?: (songRef: ServicePlanSongReference) => void;
  /**
   * Full or music controller access: unmatched ("Not in library") songs open
   * Create song instead of a lyrics viewer, then attach the new library song.
   */
  canCreateLibrarySong?: boolean;
  /** Uses the editor-level creation flow so repeated exact refs stay linked. */
  onCreatePendingSong?: (
    songRef: Extract<ServicePlanSongReference, { kind: "pending" }>,
  ) => void;
  /**
   * Overrides the element's stored song reference for display and actions, for
   * the case where a song an import couldn't find has since been added to the
   * library. Derived per plan by servicePlanSongResolution.ts; absent means the
   * stored reference still stands.
   */
  resolvedSongRef?: ServicePlanSongReference;
  resolvedSongRefs?: ServicePlanSongReference[];
  /**
   * Structure-only surfaces (the template editor) drop the columns a template
   * deliberately does not carry — song and scripture attachments, and
   * "Assigned to" — since cloneSectionsForTemplate strips all three in both
   * directions. Notes, timings, titles and microphones stay.
   */
  structureOnly?: boolean;
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
  onRemoveAssignedToHistoryValue,
  isAssignedToHistoryValueRemovable,
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
  teamNoteOptions = [],
  roleNoteOptions = [],
  microphones = [],
  microphoneAudiences,
  scheduledMicrophoneHolders,
  isEditing = false,
  isSelected = false,
  onSelect,
  onViewSongLyrics,
  canCreateLibrarySong = false,
  onCreatePendingSong,
  resolvedSongRef,
  resolvedSongRefs,
  structureOnly = false,
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
  /** When set, the library picker replaces that song index; otherwise it appends. */
  const [songPickerTargetIndex, setSongPickerTargetIndex] = useState<number | null>(
    null,
  );
  const [assignmentSheetOpen, setAssignmentSheetOpen] = useState(false);
  const [contentManagerOpen, setContentManagerOpen] = useState(false);
  /** Which unmatched song chip has the suggestion popover open. */
  const [songSuggestionsIndex, setSongSuggestionsIndex] = useState<number | null>(
    null,
  );
  const [scriptureOpen, setScriptureOpen] = useState(false);
  const [scriptureEditIndex, setScriptureEditIndex] = useState<number | null>(null);
  const formattedDuration = formatServicePlanDuration(element);
  const [durationText, setDurationText] = useState(formattedDuration);

  useEffect(() => {
    setDurationText(formattedDuration);
  }, [formattedDuration]);
  const allowEdit = canEdit && isEditing;
  const noteEditorClassName = cn(
    SERVICE_PLAN_INLINE_EDITOR_CLASS,
    !allowEdit && "opacity-100",
  );
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
  const assignees = getServicePlanElementAssignees(element);
  const teamNotes = scopedNotes.filter((note) => note.scope !== "role");
  const roleNotes = scopedNotes.filter((note) => note.scope === "role");
  const visibleTeamNotes = teamNotesFilter
    ? teamNotes.filter((note) => note.label.trim() === teamNotesFilter)
    : teamNotes;
  const teamScopedRoleNotes = roleNotes.filter((note) =>
    roleNoteMatchesServicePlanTeam(note, teamNotesFilter),
  );
  const visibleRoleNotes = roleNotesFilter
    ? teamScopedRoleNotes.filter((note) =>
      getServicePlanRoleNotePositionIds(note).includes(roleNotesFilter),
    )
    : teamScopedRoleNotes;
  const titleText = richTextToPlainText(element.title);
  const itemLabel = titleText.trim() || "item";
  // What the plan means today: the stored reference, unless a song it couldn't
  // find at import time has since been added to the library.
  const storedSongRefs = getServicePlanElementSongRefs(element);
  const songRefs = resolvedSongRefs ?? (
    resolvedSongRef && storedSongRefs.length === 1 ? [resolvedSongRef] : storedSongRefs
  );
  const scriptureRefs = getServicePlanElementScriptureRefs(element);
  const pickerTargetSong =
    songPickerTargetIndex !== null ? songRefs[songPickerTargetIndex] : undefined;
  const pendingSongTitle =
    pickerTargetSong?.kind === "pending" ? pickerTargetSong.title : "";
  const pendingSongLyrics =
    pickerTargetSong?.kind === "pending" ? pickerTargetSong.lyricsText : "";
  const scriptureLabel = scriptureRefs[0]?.label || null;
  // A "pending" ref names a song with no library doc behind it, so there is
  // nothing to project yet — the operator still has to find and link the song.
  // Outside edit mode, full/music operators create the missing library song
  // instead of opening a lyrics viewer that has nothing durable to show.
  const showNotesEditor = !hideNotes && (notesEditorOpen || hasNotes);
  const surfaceClassName = getServicePlanElementSurfaceClassName({
    toneIndex,
    isLive,
  });
  const canAddSong = !structureOnly;
  const canAddScripture = !structureOnly;
  const canAddNote = !hideNotes && !showNotesEditor;
  const canAddTeamNote = !hideNotes && teamNoteOptions.length > 0;
  const canAddRoleNote = !hideNotes && roleNoteOptions.length > 0;
  /** Every named assignee, for the compact Assigned column. */
  const assigneeSummary = assignees
    .map((assignee) => assignee.name?.trim())
    .filter(Boolean)
    .join(", ");
  const canAddContent = canAddSong || canAddScripture;
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

  const handleAddTeamNote = (teamId: string) => {
    const team = teamNoteOptions.find((option) => option.teamId === teamId);
    if (!team) return;
    const id = generateRandomId();
    setExpandedTeamNoteIds((prev) => new Set(prev).add(id));
    onUpdate({
      teamNotes: [
        ...scopedNotes,
        {
          id,
          label: team.label,
          teamId: team.teamId,
          teamName: team.label,
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
          positionIds: [role.positionId],
          label: roleOptionName(role),
          ...(role.teamId ? { teamIds: [role.teamId] } : {}),
          ...(role.teamName ? { teamNames: [role.teamName] } : {}),
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

  const openSongPicker = (
    startInCreate = false,
    targetIndex: number | null = null,
  ) => {
    setSongPickerStartInCreate(startInCreate);
    setSongPickerTargetIndex(targetIndex);
    setSongPickerOpen(true);
  };

  const closeSongPicker = () => {
    setSongPickerOpen(false);
    setSongPickerStartInCreate(false);
    setSongPickerTargetIndex(null);
  };

  const replaceSongAt = (
    songIndex: number,
    nextSongRef: ServicePlanSongReference,
  ) => {
    onUpdate({
      songRef: undefined,
      songRefs: songRefs.map((current, index) =>
        index === songIndex ? nextSongRef : current,
      ),
    });
  };

  const removeSongAt = (songIndex: number) => {
    onUpdate({
      songRef: undefined,
      songRefs: songRefs.filter((_, currentIndex) => currentIndex !== songIndex),
    });
  };

  const hasContentReferences = songRefs.length > 0 || Boolean(scriptureLabel);
  const contentReferenceCount = songRefs.length + scriptureRefs.length;

  const itemActionsMenu = allowEdit ? (
    <ItemActionsMenu
      itemLabel={itemLabel}
      canEdit={allowEdit}
      structureOnly={structureOnly}
      microphones={microphones}
      assignees={assignees}
      canAddNote={canAddNote}
      canAddTeamNote={canAddTeamNote}
      canAddRoleNote={canAddRoleNote}
      teamNoteOptions={teamNoteOptions}
      roleNoteOptions={roleNoteOptions}
      onAddNote={handleAddNote}
      onAddTeamNote={handleAddTeamNote}
      onAddRoleNote={handleCreateRoleNote}
      onAddMicrophone={(microphoneId) =>
        onUpdate({ assignees: addMicrophoneSlot(assignees, microphoneId) })
      }
      onRemove={onRemove}
    />
  ) : null;

  const addContentMenu = canAddContent ? (
    <AddContentMenu
      itemLabel={itemLabel}
      canEdit={allowEdit}
      onAddSong={() => openSongPicker(false)}
      onAddScripture={() => {
        setScriptureEditIndex(null);
        setScriptureOpen(true);
      }}
    />
  ) : null;

  const contentAddControl = allowEdit && addContentMenu ? (
    canAddScripture ? (
      <ServicePlanScripturePopover
        open={scriptureOpen}
        onOpenChange={setScriptureOpen}
        disabled={!allowEdit}
        onSelect={(scriptureRef) => onUpdate({
          // Clearing a legacy singular field is what moves this element onto
          // the arrays, so whatever it held has to be written across with it.
          // Dropping `songRef` on its own loses the song of an element that
          // only ever had the singular field.
          songRef: undefined,
          songRefs,
          scriptureRef: undefined,
          scriptureRefs: [...scriptureRefs, scriptureRef],
        })}
        anchor={<span className="inline-flex">{addContentMenu}</span>}
      />
    ) : (
      addContentMenu
    )
  ) : null;

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
          className="shrink-0 max-md:min-h-0 max-md:text-[11px]"
          svg={Radio}
          color={SERVICE_PLAN_MAKE_LIVE_ICON_COLOR}
          disabled={!canEdit || publicLiveBusy}
          onClick={onMakePublicLive}
          aria-label={`Make ${itemLabel} live`}
          title={`Make ${itemLabel} live`}
        >
          {isEditing ? null : "Make live"}
        </Button>
      ) : null}
    </>
  );

  const firstSongIndex = songRefs.findIndex((songRef) => Boolean(songRefLabel(songRef)));
  const attachmentChips = (placement: "below" | "manager" | "summary" = "below") =>
    hasContentReferences ? (
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 px-1.5 pb-1.5 md:pb-1",
          placement === "manager"
            ? "w-full flex-col items-stretch gap-0.5 overflow-hidden p-0"
            : placement === "summary"
              ? "min-w-0 flex-1 overflow-hidden p-0"
              : allowEdit ? "pl-9" : "pl-1.5",
        )}
      >
        {songRefs.map((currentSongRef, songIndex) => {
          const label = songRefLabel(currentSongRef);
          if (!label) return null;
          if (placement === "summary" && songIndex !== firstSongIndex) return null;
          const isSongUnlinked = currentSongRef.kind === "pending";
          const canLinkSong = isSongUnlinked && allowEdit;
          const canCreateMissingSong =
            isSongUnlinked && canCreateLibrarySong && !canLinkSong;
          const songChipInteractive =
            canLinkSong || canCreateMissingSong || Boolean(onViewSongLyrics);
          const pendingTitle =
            currentSongRef.kind === "pending" ? currentSongRef.title : "";

          const requestCreatePendingSong = () => {
            if (currentSongRef.kind !== "pending") return;
            if (onCreatePendingSong) {
              onCreatePendingSong(currentSongRef);
              return;
            }
            openSongPicker(true, songIndex);
          };

          const handleSongChipClick = () => {
            if (canLinkSong) {
              setSongSuggestionsIndex(songIndex);
              return;
            }
            if (canCreateMissingSong) {
              requestCreatePendingSong();
              return;
            }
            onViewSongLyrics?.(currentSongRef);
          };

          let songChipLabel = `View song details for ${label}`;
          if (canLinkSong) {
            songChipLabel = `Link ${label} to a song in the library`;
          } else if (canCreateMissingSong) {
            songChipLabel = `Create ${label} in the library`;
          } else if (isSongUnlinked) {
            songChipLabel = `View reference lyrics for ${label}`;
          }

          const songChipContent = (
            <>
              <Icon
                svg={Music}
                size="xs"
                className={cn(
                  "shrink-0",
                  isSongUnlinked
                    ? SERVICE_PLAN_UNLINKED_SONG_ICON_CLASS
                    : SERVICE_PLAN_SONG_ICON_CLASS,
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                )}
              >
                {label}
              </span>
              {isSongUnlinked ? (
                <span className="shrink-0 whitespace-nowrap text-amber-200/90">
                  · Not in library
                </span>
              ) : null}
            </>
          );

          const songChipButton = songChipInteractive ? (
            <button
              type="button"
              className={cn(
                "flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-0.5 overflow-hidden rounded text-left focus-visible:outline-none focus-visible:ring-1",
                isSongUnlinked
                  ? "hover:bg-amber-400/10 focus-visible:ring-amber-300"
                  : "hover:bg-cyan-500/10 focus-visible:ring-cyan-400",
              )}
              aria-haspopup={
                canLinkSong || canCreateMissingSong ? "dialog" : undefined
              }
              aria-expanded={
                canLinkSong ? songSuggestionsIndex === songIndex : undefined
              }
              aria-label={songChipLabel}
              // Opens rather than toggles: the chip is the popover's anchor, not its
              // trigger, so Radix already dismisses on a click outside the panel.
              onClick={handleSongChipClick}
            >
              {songChipContent}
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-0.5">{songChipContent}</span>
          );

          return (
            <span
              key={`${currentSongRef.kind}:${label}:${songIndex}`}
              className={cn(
                SERVICE_PLAN_ATTACHMENT_CHIP_CLASS,
                placement === "summary" && "h-6 min-w-0 flex-1 rounded-none border-0 bg-gray-950/70",
                isSongUnlinked
                  ? SERVICE_PLAN_UNLINKED_SONG_CHIP_CLASS
                  : SERVICE_PLAN_SONG_CHIP_CLASS,
              )}
            >
              {canLinkSong ? (
                <ServicePlanSongSuggestionPopover
                  open={songSuggestionsIndex === songIndex}
                  onOpenChange={(open) =>
                    setSongSuggestionsIndex(open ? songIndex : null)
                  }
                  title={pendingTitle}
                  onSelectSong={(nextSongRef) =>
                    replaceSongAt(songIndex, nextSongRef)
                  }
                  onOpenLibrary={() => openSongPicker(false, songIndex)}
                  onCreateSong={
                    canCreateLibrarySong
                      ? requestCreatePendingSong
                      : undefined
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
                  aria-label={
                    songIndex === 0 ? "Remove song" : `Remove song ${label}`
                  }
                  onClick={() => removeSongAt(songIndex)}
                />
              ) : null}
            </span>
          );
        })}
        {scriptureLabel && (placement !== "summary" || firstSongIndex < 0) ? (
          <span
            className={cn(
              SERVICE_PLAN_ATTACHMENT_CHIP_CLASS,
              SERVICE_PLAN_SCRIPTURE_CHIP_CLASS,
              placement === "summary" && "h-6 min-w-0 flex-1 rounded-none border-0 bg-gray-950/70",
            )}
          >
            {allowEdit ? (
              <ServicePlanScripturePopover
                open={scriptureEditIndex === 0}
                onOpenChange={(open) => setScriptureEditIndex(open ? 0 : null)}
                initialScriptureRef={scriptureRefs[0]}
                trigger
                onSelect={(scriptureRef) => {
                  onUpdate({
                    scriptureRef: undefined,
                    scriptureRefs: scriptureRefs.map((current, index) =>
                      index === 0 ? scriptureRef : current,
                    ),
                  });
                }}
                anchor={(
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-0.5 overflow-hidden rounded text-left hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-300"
                    aria-label={`Edit scripture ${scriptureLabel}`}
                  >
                    <Icon
                      svg={BookOpen}
                      size="xs"
                      className={cn("shrink-0", SERVICE_PLAN_SCRIPTURE_ICON_CLASS)}
                    />
                    <span className="min-w-0 flex-1 truncate">{scriptureLabel}</span>
                  </button>
                )}
              />
            ) : (
              <>
                <Icon
                  svg={BookOpen}
                  size="xs"
                  className={cn("shrink-0", SERVICE_PLAN_SCRIPTURE_ICON_CLASS)}
                />
                <span className="min-w-0 flex-1 truncate">{scriptureLabel}</span>
              </>
            )}
            {allowEdit ? (
              <Button
                type="button"
                variant="tertiary"
                iconSize="xs"
                padding="p-0"
                className="h-4 w-4 max-md:min-h-0"
                svg={X}
                aria-label="Remove scripture"
                onClick={() => onUpdate({
                  scriptureRef: undefined,
                  scriptureRefs: scriptureRefs.slice(1),
                })}
              />
            ) : null}
          </span>
        ) : null}
        {placement !== "summary" && scriptureRefs.slice(1).map((additionalScripture, index) => {
          const scriptureIndex = index + 1;
          return (
            <span
              key={`${additionalScripture.label}:${scriptureIndex}`}
              className={cn(SERVICE_PLAN_ATTACHMENT_CHIP_CLASS, SERVICE_PLAN_SCRIPTURE_CHIP_CLASS)}
            >
              {allowEdit ? (
                <ServicePlanScripturePopover
                  open={scriptureEditIndex === scriptureIndex}
                  onOpenChange={(open) =>
                    setScriptureEditIndex(open ? scriptureIndex : null)
                  }
                  initialScriptureRef={additionalScripture}
                  trigger
                  onSelect={(scriptureRef) => {
                    onUpdate({
                      scriptureRef: undefined,
                      scriptureRefs: scriptureRefs.map((current, currentIndex) =>
                        currentIndex === scriptureIndex ? scriptureRef : current,
                      ),
                    });
                  }}
                  anchor={(
                    <button
                      type="button"
                      className="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-0.5 overflow-hidden rounded text-left hover:bg-orange-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-300"
                      aria-label={`Edit scripture ${additionalScripture.label}`}
                    >
                      <Icon svg={BookOpen} size="xs" className={cn("shrink-0", SERVICE_PLAN_SCRIPTURE_ICON_CLASS)} />
                      <span className="min-w-0 flex-1 truncate">{additionalScripture.label}</span>
                    </button>
                  )}
                />
              ) : (
                <>
                  <Icon svg={BookOpen} size="xs" className={SERVICE_PLAN_SCRIPTURE_ICON_CLASS} />
                  <span className="min-w-0 flex-1 truncate">{additionalScripture.label}</span>
                </>
              )}
              {allowEdit ? (
                <Button
                  type="button"
                  variant="tertiary"
                  iconSize="xs"
                  padding="p-0"
                  className="h-4 w-4 max-md:min-h-0"
                  svg={X}
                  aria-label={`Remove scripture ${additionalScripture.label}`}
                  onClick={() => onUpdate({
                    scriptureRef: undefined,
                    scriptureRefs: scriptureRefs.filter((_, currentIndex) => currentIndex !== scriptureIndex),
                  })}
                />
              ) : null}
            </span>
          );
        })}
      </div>
    ) : null;

  const contentSummaryControl = hasContentReferences ? (
    <div className="flex min-w-0 max-w-full items-center overflow-hidden rounded border border-cyan-500/50 bg-gray-950/30">
      {attachmentChips("summary")}
      {allowEdit || contentReferenceCount > 1 ? (
        <Popover open={contentManagerOpen} onOpenChange={setContentManagerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="tertiary"
              svg={contentReferenceCount > 1 ? undefined : ChevronDown}
              iconSize="xs"
              className="h-6 min-w-8 shrink-0 justify-start gap-0.5 rounded-none border-0 px-2 text-xs text-gray-300 hover:text-cyan-50"
              aria-label={`Manage content for ${itemLabel}`}
            >
              {contentReferenceCount > 1 ? `+${contentReferenceCount - 1}` : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 border-gray-700 bg-gray-900 p-2 text-gray-100"
          >
            <p className="px-1 pb-2 text-xs font-medium text-gray-300">Content</p>
            {attachmentChips("manager")}
            {contentAddControl ? <div className="px-1 pt-2">{contentAddControl}</div> : null}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  ) : contentAddControl;

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
          editorClassName={noteEditorClassName}
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
                    <Select
                      label="Team note audience"
                      hideLabel
                      className="min-w-0"
                      selectClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
                      value={teamNote.teamId || ""}
                      options={teamNoteOptions.map((team) => ({
                        value: team.teamId,
                        label: team.label,
                      }))}
                      onChange={(teamId) => {
                        const team = teamNoteOptions.find((option) => option.teamId === teamId);
                        if (!team) return;
                        onUpdate({
                          teamNotes: scopedNotes.map((note) =>
                            note.id === teamNote.id
                              ? {
                                ...note,
                                scope: "team",
                                teamId: team.teamId,
                                teamName: team.label,
                                label: team.label,
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
              label={`${teamTitle} note`}
              hideLabel
              placeholder="Only shown to this team"
              value={teamNote.note}
              disabled={!allowEdit}
              editorClassName={noteEditorClassName}
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
        const roleTitle = roleAudienceLabel(roleNote, roleNoteOptions);
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
                    <RoleNoteAudiencePicker
                      value={getServicePlanRoleNotePositionIds(roleNote)}
                      options={roleNoteOptions}
                      onValueChange={(positionIds) => {
                        const selectedRoles = roleNoteOptions.filter((option) =>
                          positionIds.includes(option.positionId),
                        );
                        if (!selectedRoles.length) return;
                        const teamIds = Array.from(new Set(
                          selectedRoles
                            .map((role) => role.teamId)
                            .filter((teamId): teamId is string => Boolean(teamId)),
                        ));
                        const teamNames = Array.from(new Set(
                          selectedRoles
                            .map((role) => role.teamName)
                            .filter((teamName): teamName is string => Boolean(teamName)),
                        ));
                        onUpdate({
                          teamNotes: scopedNotes.map((note) =>
                            note.id === roleNote.id
                              ? {
                                ...note,
                                scope: "role",
                                positionId: undefined,
                                positionIds,
                                label: selectedRoles.map(roleOptionName).join(", "),
                                ...(teamIds.length ? { teamIds } : {}),
                                ...(teamNames.length ? { teamNames } : {}),
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
              editorClassName={noteEditorClassName}
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

  /**
   * Who is doing this item and what each of them carries. Microphones live on
   * the person rather than the item, so one row answers "who has the orange
   * handheld". A row with no name is a stand or spare mic.
   */
  const assigneesBlock = assignees.length > 0 || (allowEdit && !structureOnly) ? (
    <ServicePlanAssigneeList
      assignees={assignees}
      allowEdit={allowEdit}
      microphones={microphones}
      assignedToHistoryValues={assignedToHistoryValues}
      onRemoveAssignedToHistoryValue={onRemoveAssignedToHistoryValue}
      isAssignedToHistoryValueRemovable={isAssignedToHistoryValueRemovable}
      itemLabel={itemLabel}
      structureOnly={structureOnly}
      scheduledMicrophoneHolders={scheduledMicrophoneHolders}
      onChange={(nextAssignees, coalesceKey) =>
        onUpdate({ assignees: nextAssignees }, coalesceKey)
      }
    />
  ) : null;
  const readOnlyAssigneesBlock = assignees.length > 0 ? (
    <ServicePlanAssigneeList
      assignees={assignees}
      allowEdit={false}
      microphones={microphones}
      assignedToHistoryValues={assignedToHistoryValues}
      onRemoveAssignedToHistoryValue={onRemoveAssignedToHistoryValue}
      isAssignedToHistoryValueRemovable={isAssignedToHistoryValueRemovable}
      itemLabel={itemLabel}
      structureOnly={structureOnly}
      scheduledMicrophoneHolders={scheduledMicrophoneHolders}
      onEdit={() => setAssignmentSheetOpen(true)}
      onChange={() => undefined}
    />
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
      className={cn(
        surfaceClassName,
        isSelected && isEditing && "bg-cyan-950/35 ring-1 ring-inset ring-cyan-400/50",
      )}
      data-element-tone={toneIndex % 2 === 0 ? "even" : "odd"}
      onClick={onSelect}
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
            <DebouncedInput
              label="Title"
              hideLabel
              placeholder="Item name"
              className={cn("w-full", SERVICE_PLAN_COL.title)}
              inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
              value={titleText}
              onChange={(value) =>
                onUpdate({ title: plainTextToRichText(value) }, "title")
              }
            />
          </div>

          <div
            className={cn(
              SERVICE_PLAN_COL.contentView,
              "min-w-0 self-start py-0.5 max-md:order-4",
              !hasContentReferences && !contentAddControl && "max-md:hidden",
            )}
            aria-label="Songs and scripture"
          >
            {contentSummaryControl}
          </div>

          <div className={cn(SERVICE_PLAN_COL.actionsEdit, "max-md:ml-auto max-md:order-5")}>
            {liveControls}
            {itemActionsMenu}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            SERVICE_PLAN_COL.row,
            "items-start py-2.5 max-md:flex-wrap md:py-1.5",
          )}
        >
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
              "whitespace-nowrap text-xs leading-4 tabular-nums text-gray-400",
            )}
          >
            {formattedDuration || "—"}
          </span>
          <div className={cn(SERVICE_PLAN_COL.title, "space-y-0.5")}>
            <p className="truncate text-xs font-medium leading-5 text-gray-50">
              {titleText.trim() || "Untitled"}
            </p>
            {!structureOnly && !isEditing && assigneeSummary ? (
              <p className="truncate text-[11px] leading-4 text-gray-400 md:hidden">
                {assigneeSummary}
              </p>
            ) : null}
          </div>
          {!allowEdit ? (
            <div
              className={cn(
                SERVICE_PLAN_COL.contentView,
                "min-w-0 self-start py-0.5 max-md:order-4",
                !hasContentReferences && "max-md:hidden",
              )}
              aria-label="Songs and scripture"
            >
              {contentSummaryControl}
            </div>
          ) : null}
          {canEdit || isLive || showLiveControls ? (
            <div className={cn(SERVICE_PLAN_COL.actionsView, "self-center max-md:order-5")}>
              {liveControls}
            </div>
          ) : null}
        </div>
      )}

      {allowEdit ? (
        readOnlyAssigneesBlock || (
          <Button
            type="button"
            variant="tertiary"
            svg={UserRound}
            iconSize="sm"
            className="mx-1 mb-1 border border-dashed border-gray-600/80 px-1.5 py-1 text-left text-xs text-gray-300 hover:border-cyan-500/50 hover:text-cyan-50"
            aria-label={`Assignees for ${itemLabel}`}
            onClick={() => setAssignmentSheetOpen(true)}
          >
            {structureOnly ? "Add microphones" : "Assign people & mics"}
          </Button>
        )
      ) : (
        assigneesBlock
      )}
      {notesBlock}
      {teamNotesBlock}
      {roleNotesBlock}
      {allowEdit ? (
        <Sheet open={assignmentSheetOpen} onOpenChange={setAssignmentSheetOpen}>
          <SheetContent
            side="right"
            className="flex w-full max-w-md flex-col gap-0 border-gray-700 bg-gray-950 p-0"
          >
            <SheetHeader className="border-b border-gray-800">
              <SheetTitle>Edit assignees</SheetTitle>
              <SheetDescription className="truncate">
                {itemLabel}
              </SheetDescription>
            </SheetHeader>
            <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4 [&_.service-plan-assignee-list]:!pl-0 [&_.service-plan-assignee-list>div:first-child]:flex-col [&_.service-plan-assignee-list>div:first-child]:items-stretch [&_.service-plan-assignee-list>div:first-child]:gap-2 [&_.service-plan-assignee-list>div:first-child>div:first-child]:w-full [&_.service-plan-assignee-list>div:first-child>div:last-child]:w-full">
              {assigneesBlock}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      {songPickerOpen ? (
        <ServicePlanLibraryPicker
          isOpen
          // Linking an unmatched import starts from the title the plan already
          // names, so the operator searches from there instead of retyping it.
          initialQuery={pendingSongTitle}
          initialLyrics={pendingSongLyrics}
          startInCreate={songPickerStartInCreate}
          onClose={closeSongPicker}
          onSelectSong={(songRef) => {
            if (songPickerTargetIndex !== null) {
              replaceSongAt(songPickerTargetIndex, songRef);
              return;
            }
            onUpdate({
              songRef: undefined,
              songRefs: [...songRefs, songRef],
            });
          }}
        />
      ) : null}
    </div>
  );
};

export default ServicePlanElementRow;
