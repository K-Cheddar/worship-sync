import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, Plus, Search, TriangleAlert } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import { cn } from "@/utils/cnHelper";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/Popover";
import type { TeamRosterMember, TeamScheduleGuest } from "../../../api/authTypes";
import type { TeamScheduleShadowKind } from "../../../api/authTypes";
import { emptyDuplicateFirstNames } from "../teamsConstants";
import { scheduleMemberName, shadowKindLabel } from "../teamsUtils";
import MemberAssignmentSubmenu, {
  type MemberAssignmentActionIssues,
} from "./MemberAssignmentSubmenu";
import {
  splitTypedMemberName,
  shouldShowScheduleMemberPositionGroupDivider,
  type ScheduleMemberPickerMember,
  type ScheduleMemberRecommendationStats,
} from "./scheduleMemberPickerUtils";
import ScheduleMemberPositionGroupDivider from "./ScheduleMemberPositionGroupDivider";
import { useScheduleMemberPicker } from "./useScheduleMemberPicker";
import { WantsThisIcon } from "./WantsThisIndicator";

type MemberAssignmentAction = "replace" | TeamScheduleShadowKind;
type PickerMenuView =
  | "members"
  | "assignmentActions"
  | "createMember"
  | "createGuest"
  | "recentGuests"
  | "swapConfirmation";
type PickerPopoverSide = "top" | "right" | "bottom" | "left";

const readPopoverSide = (node: Element | null): PickerPopoverSide | null => {
  const side = node?.getAttribute("data-side");
  if (side === "top" || side === "right" || side === "bottom" || side === "left") {
    return side;
  }
  return null;
};

export type ScheduleAssignmentSwapRecommendation = {
  swapId: string;
  candidateMemberId: string;
  candidateLabel: string;
  currentMemberLabel: string;
  sourcePositionLabel: string;
  targetPositionLabel: string;
};

/**
 * Non-blocking caution (e.g. the member marked this service unavailable on
 * intake). They can still be picked — this just flags it.
 */
const WarningBadge = ({ label }: { label: string }) => (
  <span
    title={label}
    aria-hidden
    className="inline-flex shrink-0 items-center rounded-full bg-amber-500/20 p-1 text-amber-200"
  >
    <TriangleAlert className="h-3 w-3" aria-hidden />
  </span>
);

/** Stable empty default so an omitted currentShadows prop doesn't churn renders. */
const emptyShadows: { memberId: string; kind: TeamScheduleShadowKind; label: string }[] =
  [];

type ScheduleAssignmentPickerProps = {
  open: boolean;
  anchorEl: HTMLElement | null;
  label: string;
  positionId: string;
  positionName: string;
  members: TeamRosterMember[];
  assignmentQuery: string;
  onAssignmentQueryChange: (query: string) => void;
  currentPrimaryMemberId: string;
  currentAssigneeLabel: string;
  currentAssigneeIsGuest?: boolean;
  hasCurrentAssignee?: boolean;
  duplicateFirstNames?: Set<string>;
  recommendationStats?: Map<string, ScheduleMemberRecommendationStats>;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (memberId: string) => MemberAssignmentActionIssues;
  getWarning?: (memberId: string) => string;
  onSelectMember: (memberId: string) => void;
  onAssignmentAction?: (memberId: string, action: MemberAssignmentAction) => void;
  swapRecommendations?: ScheduleAssignmentSwapRecommendation[];
  onApplySwapRecommendation?: (
    recommendation: ScheduleAssignmentSwapRecommendation,
  ) => void;
  onCreateMember?: (member: { firstName: string; lastName: string }) => Promise<void> | void;
  recentGuests?: TeamScheduleGuest[];
  onAssignGuest?: (
    guest: Omit<TeamScheduleGuest, "guestId"> & { guestId?: string },
  ) => Promise<void> | void;
  onClearAssignment?: () => void;
  /** Shadows currently on the active cell, offered for one-tap removal. */
  currentShadows?: { memberId: string; kind: TeamScheduleShadowKind; label: string }[];
  onRemoveShadow?: (memberId: string, kind: TeamScheduleShadowKind) => void;
  pendingSubmenu?: {
    memberId: string;
    title: string;
    issues: MemberAssignmentActionIssues;
    onBack: () => void;
    onReplace: () => void;
    onAddShadow: () => void;
    onAddReverseShadow: () => void;
  } | null;
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

const ScheduleAssignmentPicker = memo(({
  open,
  anchorEl,
  label,
  positionId,
  positionName,
  members,
  assignmentQuery,
  onAssignmentQueryChange,
  currentPrimaryMemberId,
  currentAssigneeLabel,
  currentAssigneeIsGuest = false,
  hasCurrentAssignee,
  duplicateFirstNames,
  recommendationStats,
  getIssue,
  getAssignmentActionIssues,
  getWarning,
  onSelectMember,
  onAssignmentAction,
  swapRecommendations = [],
  onApplySwapRecommendation,
  onCreateMember,
  recentGuests = [],
  onAssignGuest,
  onClearAssignment,
  currentShadows = emptyShadows,
  onRemoveShadow,
  pendingSubmenu,
  inputRef: externalInputRef,
}: ScheduleAssignmentPickerProps) => {
  const listboxId = useId();
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const anchorProxyRef = useRef<HTMLSpanElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [menuView, setMenuView] = useState<PickerMenuView>("members");
  // Capture the first collision-aware placement, then freeze it so shorter
  // submenu views (recent guests, create forms) do not flip the popover.
  const [lockedSide, setLockedSide] = useState<PickerPopoverSide | null>(null);
  const [activeSubmenuMemberId, setActiveSubmenuMemberId] = useState<string | null>(null);
  const [activeSwapRecommendation, setActiveSwapRecommendation] =
    useState<ScheduleAssignmentSwapRecommendation | null>(null);
  const [createDraft, setCreateDraft] = useState({ firstName: "", lastName: "" });
  const [guestDraft, setGuestDraft] = useState({
    guestId: "",
    name: "",
    email: "",
    phone: "",
    note: "",
  });
  const [creatingMember, setCreatingMember] = useState(false);
  const [assigningGuest, setAssigningGuest] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const duplicateFirstNameKeys = duplicateFirstNames || emptyDuplicateFirstNames;

  const { positionMembers, showCreateOption } = useScheduleMemberPicker({
    members,
    positionId,
    assignmentQuery,
    currentPrimaryMemberId,
    duplicateFirstNames: duplicateFirstNameKeys,
    getIssue,
    getAssignmentActionIssues,
    getWarning,
    recommendationStats,
    canCreateMember: Boolean(onCreateMember),
  });

  const formatMemberLabel = (member: TeamRosterMember) =>
    scheduleMemberName(member, duplicateFirstNameKeys);

  const activeSubmenuMember = activeSubmenuMemberId
    ? members.find((member) => member.memberId === activeSubmenuMemberId)
    : undefined;

  const assignmentActionIssues =
    activeSubmenuMemberId && getAssignmentActionIssues
      ? getAssignmentActionIssues(activeSubmenuMemberId)
      : null;

  const updateAnchorRect = useCallback(() => {
    if (!anchorEl) {
      setAnchorRect(null);
      return;
    }
    setAnchorRect(anchorEl.getBoundingClientRect());
  }, [anchorEl]);

  useLayoutEffect(() => {
    updateAnchorRect();
  }, [updateAnchorRect, open]);

  useEffect(() => {
    if (!open || !anchorEl) return undefined;
    const handleReposition = () => updateAnchorRect();
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [anchorEl, open, updateAnchorRect]);

  useEffect(() => {
    if (!open) {
      setMenuView("members");
      setLockedSide(null);
      setActiveSubmenuMemberId(null);
      setActiveSwapRecommendation(null);
      setHighlightedIndex(0);
      setCreateDraft({ firstName: "", lastName: "" });
      setGuestDraft({ guestId: "", name: "", email: "", phone: "", note: "" });
      setCreatingMember(false);
      setAssigningGuest(false);
      return;
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRect || lockedSide) return undefined;
    let frame = 0;
    let attempts = 0;
    const captureSide = () => {
      const side = readPopoverSide(
        document.querySelector("[data-schedule-assignment-menu]"),
      );
      if (side) {
        setLockedSide(side);
        return;
      }
      attempts += 1;
      if (attempts >= 12) return;
      frame = window.requestAnimationFrame(captureSide);
    };
    frame = window.requestAnimationFrame(captureSide);
    return () => window.cancelAnimationFrame(frame);
  }, [open, anchorRect, lockedSide, menuView]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [assignmentQuery, positionMembers.length]);

  useEffect(() => {
    if (pendingSubmenu) {
      setMenuView("assignmentActions");
      setActiveSubmenuMemberId(pendingSubmenu.memberId);
    }
  }, [pendingSubmenu]);

  const resetMenuView = useCallback(() => {
    setMenuView("members");
    setActiveSubmenuMemberId(null);
    setActiveSwapRecommendation(null);
  }, []);

  const runAssignmentAction = (memberId: string, action: MemberAssignmentAction) => {
    onAssignmentAction?.(memberId, action);
    resetMenuView();
  };

  const openAssignmentActions = (memberId: string) => {
    setActiveSubmenuMemberId(memberId);
    setMenuView("assignmentActions");
  };

  const openCreateMember = () => {
    setCreateDraft(splitTypedMemberName(assignmentQuery));
    setMenuView("createMember");
  };

  const openCreateGuest = () => {
    setGuestDraft({
      guestId: "",
      name: assignmentQuery.trim(),
      email: "",
      phone: "",
      note: "",
    });
    setMenuView("createGuest");
  };

  const openRecentGuests = () => {
    setMenuView("recentGuests");
  };

  const openSwapConfirmation = (
    recommendation: ScheduleAssignmentSwapRecommendation,
  ) => {
    setActiveSwapRecommendation(recommendation);
    setMenuView("swapConfirmation");
  };

  const submitCreateMember = async () => {
    if (!onCreateMember || creatingMember) return;
    const firstName = createDraft.firstName.trim();
    if (!firstName) return;
    setCreatingMember(true);
    try {
      await onCreateMember({ firstName, lastName: createDraft.lastName.trim() });
      resetMenuView();
      setCreateDraft({ firstName: "", lastName: "" });
    } finally {
      setCreatingMember(false);
    }
  };

  const assignGuest = async (
    guest: Omit<TeamScheduleGuest, "guestId"> & { guestId?: string },
  ) => {
    if (!onAssignGuest || assigningGuest) return;
    setAssigningGuest(true);
    try {
      await onAssignGuest(guest);
      resetMenuView();
      setGuestDraft({ guestId: "", name: "", email: "", phone: "", note: "" });
    } catch {
      // The parent owns the operator-facing error toast. Keep this form open so
      // the guest details can be corrected or retried without retyping them.
    } finally {
      setAssigningGuest(false);
    }
  };

  const submitCreateGuest = async () => {
    const name = guestDraft.name.trim();
    if (!name) return;
    await assignGuest({
      ...(guestDraft.guestId ? { guestId: guestDraft.guestId } : {}),
      name,
      ...(guestDraft.email.trim() ? { email: guestDraft.email.trim() } : {}),
      ...(guestDraft.phone.trim() ? { phone: guestDraft.phone.trim() } : {}),
      ...(guestDraft.note.trim() ? { note: guestDraft.note.trim() } : {}),
    });
  };

  const selectableRows = positionMembers.filter((row) => row.eligible);
  const trimmedQuery = assignmentQuery.trim();
  const directAssignmentRows = selectableRows.filter((row) => {
    if (!currentPrimaryMemberId || !getAssignmentActionIssues) return true;
    return !getAssignmentActionIssues(row.member.memberId).replace;
  });
  // Recommendations are reserved for fully available people. Cautioned rows
  // remain selectable below them, where an operator can make an intentional choice.
  const recommendationRows = directAssignmentRows.filter((row) => !row.warning);
  const showRecommendations =
    menuView === "members" && !trimmedQuery && recommendationRows.length > 0;
  const recommendedRows = showRecommendations ? recommendationRows.slice(0, 3) : [];
  const recommendedMemberIds = new Set(
    recommendedRows.map((row) => row.member.memberId),
  );
  const visibleSelectableRows =
    recommendedRows.length > 0
      ? selectableRows.filter(
        (row) => !recommendedMemberIds.has(row.member.memberId),
      )
      : selectableRows;
  const showSwapRecommendations =
    menuView === "members" &&
    !trimmedQuery &&
    Boolean(currentPrimaryMemberId) &&
    swapRecommendations.length > 0 &&
    Boolean(onApplySwapRecommendation);

  const currentAssigneePresent =
    hasCurrentAssignee ?? Boolean(currentPrimaryMemberId);
  let guestSubmitLabel = currentAssigneePresent
    ? "Replace & assign"
    : "Add & assign";
  if (assigningGuest) guestSubmitLabel = "Assigning…";
  // Guest memberIds are guestIds — skip the person already in this slot so they
  // are not offered again under Recent guests.
  const visibleRecentGuests = recentGuests
    .filter((guest) => guest.guestId !== currentPrimaryMemberId)
    .slice(0, 5);
  const showRecentGuestsEntry =
    menuView === "members" &&
    !trimmedQuery &&
    Boolean(onAssignGuest) &&
    visibleRecentGuests.length > 0;

  const showClearAssignmentOption =
    currentAssigneePresent &&
    !trimmedQuery &&
    menuView === "members" &&
    Boolean(onClearAssignment);

  const showClearShadowOptions =
    currentShadows.length > 0 &&
    !trimmedQuery &&
    menuView === "members" &&
    Boolean(onRemoveShadow);

  const showCurrentAssigneeRow =
    currentAssigneePresent &&
    menuView === "members" &&
    !pendingSubmenu;

  const showListContent =
    menuView === "assignmentActions" ||
    menuView === "createMember" ||
    menuView === "createGuest" ||
    menuView === "recentGuests" ||
    menuView === "swapConfirmation" ||
    Boolean(pendingSubmenu) ||
    selectableRows.length > 0 ||
    showSwapRecommendations ||
    showCreateOption ||
    showClearAssignmentOption ||
    showClearShadowOptions ||
    showCurrentAssigneeRow ||
    Boolean(onAssignGuest);

  const pickerOpen = open && Boolean(anchorRect);

  const handleSelectRow = (memberId: string, usesSubmenu: boolean) => {
    if (usesSubmenu) {
      openAssignmentActions(memberId);
      return;
    }
    onSelectMember(memberId);
  };

  const renderSelectableRow = (
    row: ScheduleMemberPickerMember,
    index: number,
    rows: ScheduleMemberPickerMember[],
    keyPrefix = "",
  ) => {
    const memberLabel = formatMemberLabel(row.member);
    const highlighted =
      selectableRows.findIndex(
        (item) => item.member.memberId === row.member.memberId,
      ) === highlightedIndex;
    const showPositionGroupDivider =
      shouldShowScheduleMemberPositionGroupDivider(rows, index, positionId);
    const key = `${keyPrefix}${row.member.memberId}`;

    if (row.usesSubmenu) {
      return (
        <div key={key}>
          {showPositionGroupDivider ? (
            <ScheduleMemberPositionGroupDivider />
          ) : null}
          <button
            role="option"
            aria-selected={highlighted}
            type="button"
            className={cn(
              "flex min-w-0 w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-gray-100 hover:bg-gray-800",
              highlighted && "bg-gray-800",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              openAssignmentActions(row.member.memberId);
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{memberLabel}</span>
              {row.warning ? (
                <span className="mt-0.5 block truncate text-xs text-amber-200">
                  {row.warning}
                </span>
              ) : null}
            </span>
            {row.warning ? <WarningBadge label={row.warning} /> : null}
            {row.desiresPosition ? <WantsThisIcon /> : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          </button>
        </div>
      );
    }

    return (
      <div key={key}>
        {showPositionGroupDivider ? (
          <ScheduleMemberPositionGroupDivider />
        ) : null}
        <button
          role="option"
          aria-selected={highlighted}
          type="button"
          className={cn(
            "flex min-w-0 w-full items-center gap-2 rounded px-2 py-1 text-left text-sm font-medium text-gray-100 hover:bg-gray-800",
            highlighted && "bg-gray-800",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelectMember(row.member.memberId);
          }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{memberLabel}</span>
            {row.warning ? (
              <span className="mt-0.5 block truncate text-xs font-normal text-amber-200">
                {row.warning}
              </span>
            ) : null}
          </span>
          {row.warning ? <WarningBadge label={row.warning} /> : null}
          {row.desiresPosition ? <WantsThisIcon /> : null}
        </button>
      </div>
    );
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.min(current + 1, Math.max(selectableRows.length - 1, 0)),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (
      event.key === "Enter" &&
      menuView === "members" &&
      !trimmedQuery &&
      currentAssigneePresent &&
      onClearAssignment
    ) {
      event.preventDefault();
      onClearAssignment();
      return;
    }
    if (event.key === "Enter" && menuView === "members" && selectableRows.length > 0) {
      event.preventDefault();
      const row = selectableRows[highlightedIndex];
      if (row) handleSelectRow(row.member.memberId, row.usesSubmenu);
    }
  };

  if (!open || !anchorRect) return null;

  return (
    <Popover open={pickerOpen} modal={false}>
      <PopoverAnchor asChild>
        <span
          ref={anchorProxyRef}
          aria-hidden
          className="pointer-events-none fixed z-40"
          style={{
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        id={listboxId}
        data-schedule-assignment-menu
        role={menuView === "members" ? "listbox" : "menu"}
        align="start"
        side={lockedSide ?? "bottom"}
        sideOffset={4}
        avoidCollisions={!lockedSide}
        className="z-50 min-w-48 max-w-xs w-max overflow-hidden rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (
            menuView !== "createMember" &&
            !(event.target instanceof HTMLInputElement)
          ) {
            event.preventDefault();
          }
        }}
      >
        <div className="border-b border-gray-800 p-2">
          <label className="sr-only">{label}</label>
          <div className="relative flex min-w-0 items-stretch">
            <input
              ref={inputRef}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={pickerOpen}
              aria-label={label}
              className="w-full rounded-md border border-gray-800 bg-gray-950 py-1 pl-9 pr-2 text-sm text-white focus:border-gray-600 focus:outline-none"
              value={assignmentQuery}
              onChange={(event) => {
                onAssignmentQueryChange(event.target.value);
                setMenuView("members");
                setActiveSubmenuMemberId(null);
                setActiveSwapRecommendation(null);
              }}
              onKeyDown={handleInputKeyDown}
            />
            <div className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
              <Search className="h-4 w-4 text-neutral-400" aria-hidden />
            </div>
          </div>
        </div>
        <div className="scrollbar-portal max-h-[min(24rem,55dvh)] overflow-x-hidden overflow-y-auto">
          {pendingSubmenu && menuView === "assignmentActions" ? (
            <MemberAssignmentSubmenu
              title={pendingSubmenu.title}
              issues={pendingSubmenu.issues}
              onBack={pendingSubmenu.onBack}
              onReplace={pendingSubmenu.onReplace}
              onAddShadow={pendingSubmenu.onAddShadow}
              onAddReverseShadow={pendingSubmenu.onAddReverseShadow}
            />
          ) : menuView === "assignmentActions" &&
            activeSubmenuMemberId &&
            activeSubmenuMember &&
            assignmentActionIssues ? (
            <MemberAssignmentSubmenu
              title={`Assign ${formatMemberLabel(activeSubmenuMember)}`}
              issues={assignmentActionIssues}
              onBack={resetMenuView}
              onReplace={() => runAssignmentAction(activeSubmenuMemberId, "replace")}
              onAddShadow={() => runAssignmentAction(activeSubmenuMemberId, "shadow")}
              onAddReverseShadow={() =>
                runAssignmentAction(activeSubmenuMemberId, "reverse_shadow")
              }
            />
          ) : menuView === "createMember" ? (
            <form
              className="space-y-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreateMember();
              }}
            >
              <p className="px-1 text-xs font-semibold text-gray-300">Add new member</p>
              <Input
                autoFocus
                hideLabel
                label="First name"
                placeholder="First name"
                inputClassName="border-gray-700 bg-gray-950 focus:border-gray-500"
                value={createDraft.firstName}
                onChange={(value) =>
                  setCreateDraft((draft) => ({ ...draft, firstName: String(value) }))
                }
              />
              <Input
                hideLabel
                label="Last name"
                placeholder="Last name"
                inputClassName="border-gray-700 bg-gray-950 focus:border-gray-500"
                value={createDraft.lastName}
                onChange={(value) =>
                  setCreateDraft((draft) => ({ ...draft, lastName: String(value) }))
                }
              />
              {positionName ? (
                <p className="px-1 text-xs text-gray-500">Position: {positionName}</p>
              ) : null}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-2 py-1"
                  className="text-xs"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    resetMenuView();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  padding="px-3 py-1"
                  className="text-xs"
                  disabled={!createDraft.firstName.trim() || creatingMember}
                  isLoading={creatingMember}
                >
                  {creatingMember ? "Adding…" : "Add & assign"}
                </Button>
              </div>
            </form>
          ) : menuView === "createGuest" ? (
            <form
              className="space-y-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreateGuest();
              }}
            >
              <p className="px-1 text-xs font-semibold text-gray-300">Add guest</p>
              <p className="px-1 text-xs text-gray-500">
                This person will only appear on the schedule.
              </p>
              {currentAssigneePresent ? (
                <p className="px-1 text-xs text-amber-200">
                  This will replace {currentAssigneeLabel} in this slot.
                </p>
              ) : null}
              <Input
                autoFocus
                hideLabel
                label="Guest name"
                placeholder="Name"
                inputClassName="border-gray-700 bg-gray-950 focus:border-gray-500"
                value={guestDraft.name}
                onChange={(value) =>
                  setGuestDraft((draft) => ({ ...draft, name: String(value) }))
                }
              />
              <Input
                hideLabel
                label="Guest email"
                placeholder="Email (optional)"
                inputClassName="border-gray-700 bg-gray-950 focus:border-gray-500"
                value={guestDraft.email}
                onChange={(value) =>
                  setGuestDraft((draft) => ({ ...draft, email: String(value) }))
                }
              />
              <Input
                hideLabel
                label="Guest phone"
                placeholder="Phone (optional)"
                inputClassName="border-gray-700 bg-gray-950 focus:border-gray-500"
                value={guestDraft.phone}
                onChange={(value) =>
                  setGuestDraft((draft) => ({ ...draft, phone: String(value) }))
                }
              />
              <Input
                hideLabel
                label="Guest note"
                placeholder="Note (optional)"
                inputClassName="border-gray-700 bg-gray-950 focus:border-gray-500"
                value={guestDraft.note}
                onChange={(value) =>
                  setGuestDraft((draft) => ({ ...draft, note: String(value) }))
                }
              />
              {positionName ? (
                <p className="px-1 text-xs text-gray-500">Position: {positionName}</p>
              ) : null}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-2 py-1"
                  className="text-xs"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    resetMenuView();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  padding="px-3 py-1"
                  className="text-xs"
                  disabled={!guestDraft.name.trim() || assigningGuest}
                  isLoading={assigningGuest}
                >
                  {guestSubmitLabel}
                </Button>
              </div>
            </form>
          ) : menuView === "recentGuests" ? (
            <div className="p-1">
              <Button
                type="button"
                variant="tertiary"
                svg={ChevronLeft}
                iconSize="sm"
                padding="px-2 py-1"
                className="mb-1 text-xs"
                onMouseDown={(event) => {
                  event.preventDefault();
                  resetMenuView();
                }}
              >
                Back
              </Button>
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                Recent guests
              </p>
              {visibleRecentGuests.map((guest) => (
                <button
                  key={guest.guestId}
                  type="button"
                  role="menuitem"
                  disabled={assigningGuest}
                  className="flex min-w-0 w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-gray-100 hover:bg-gray-800 disabled:opacity-60"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (currentAssigneePresent) {
                      setGuestDraft({
                        guestId: guest.guestId,
                        name: guest.name,
                        email: guest.email || "",
                        phone: guest.phone || "",
                        note: guest.note || "",
                      });
                      setMenuView("createGuest");
                      return;
                    }
                    void assignGuest(guest);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {guest.name}
                  </span>
                  <span className="shrink-0 rounded-full border border-violet-400/40 bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
                    Guest
                  </span>
                </button>
              ))}
            </div>
          ) : menuView === "swapConfirmation" && activeSwapRecommendation ? (
            <div className="space-y-3 p-2">
              <Button
                type="button"
                variant="tertiary"
                svg={ChevronLeft}
                iconSize="sm"
                padding="px-2 py-1"
                className="text-xs"
                onMouseDown={(event) => {
                  event.preventDefault();
                  resetMenuView();
                }}
              >
                Back
              </Button>
              <div className="px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
                  Recommended swap
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  This will make 2 changes.
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-gray-300">
                  <li>
                    Move {activeSwapRecommendation.currentMemberLabel} from{" "}
                    {activeSwapRecommendation.targetPositionLabel} to{" "}
                    {activeSwapRecommendation.sourcePositionLabel}
                  </li>
                  <li>
                    Assign {activeSwapRecommendation.candidateLabel} to{" "}
                    {activeSwapRecommendation.targetPositionLabel}
                  </li>
                </ol>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-2 py-1"
                  className="text-xs"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    resetMenuView();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  padding="px-3 py-1"
                  className="text-xs"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onApplySwapRecommendation?.(activeSwapRecommendation);
                  }}
                >
                  Apply swap
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-1">
              {showListContent ? (
                <>
                  {showCurrentAssigneeRow ? (
                    <div
                      className="mb-1 border-b border-gray-600 px-2 py-1.5"
                      aria-label={`Current assignee, ${currentAssigneeLabel}`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-300/90">
                        Current assignee
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <p className="wrap-break-word text-sm font-semibold text-white">
                          {currentAssigneeLabel}
                        </p>
                        {currentAssigneeIsGuest ? (
                          <span className="rounded-full border border-violet-400/40 bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
                            Guest
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {showClearAssignmentOption ? (
                    <Button
                      type="button"
                      variant="tertiary"
                      padding="px-2 py-1"
                      className="w-full justify-start text-sm font-medium text-rose-200 hover:bg-gray-800"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onClearAssignment?.();
                      }}
                    >
                      Clear assignment
                    </Button>
                  ) : null}
                  {showClearShadowOptions
                    ? currentShadows.map((shadow) => (
                      <Button
                        key={`${shadow.kind}-${shadow.memberId}`}
                        type="button"
                        variant="tertiary"
                        padding="px-2 py-1"
                        className="w-full justify-start text-sm font-medium text-rose-200 hover:bg-gray-800"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onRemoveShadow?.(shadow.memberId, shadow.kind);
                        }}
                      >
                        Remove {shadowKindLabel(shadow.kind).toLowerCase()}: {shadow.label}
                      </Button>
                    ))
                    : null}
                  {recommendedRows.length > 0 ? (
                    <div
                      role="group"
                      aria-label="Recommended"
                      className={cn(
                        (showCurrentAssigneeRow || showClearAssignmentOption) && "mt-1",
                      )}
                    >
                      <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">
                        Recommended
                      </p>
                      {recommendedRows.map((row, index) =>
                        renderSelectableRow(
                          row,
                          index,
                          recommendedRows,
                          "recommended-",
                        ),
                      )}
                    </div>
                  ) : null}
                  {visibleSelectableRows.length > 0 ? (
                    <div
                      className={cn(
                        recommendedRows.length > 0 && "mt-1 border-t border-gray-800 pt-1",
                      )}
                    >
                      {recommendedRows.length > 0 ? (
                        <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          All available members
                        </p>
                      ) : null}
                      {visibleSelectableRows.map((row, index) =>
                        renderSelectableRow(row, index, visibleSelectableRows),
                      )}
                    </div>
                  ) : null}
                  {showSwapRecommendations ? (
                    <div
                      className={cn(
                        "mt-1 border-t border-gray-800 px-1 pb-1 pt-2",
                        recommendedRows.length === 0 &&
                        visibleSelectableRows.length === 0 &&
                        !showCurrentAssigneeRow &&
                        !showClearAssignmentOption &&
                        "mt-0 border-t-0 pt-1",
                      )}
                    >
                      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                        Possible swaps
                      </p>
                      {swapRecommendations.map((recommendation) => (
                        <button
                          key={recommendation.swapId}
                          type="button"
                          className="flex min-w-0 w-full flex-col rounded px-2 py-1.5 text-left hover:bg-gray-800"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            openSwapConfirmation(recommendation);
                          }}
                        >
                          <span className="flex w-full min-w-0 items-center gap-1 text-sm font-medium text-gray-100">
                            <span className="shrink-0">Move</span>
                            <span className="min-w-0 truncate">
                              {recommendation.currentMemberLabel}
                            </span>
                            <span className="shrink-0">to</span>
                            <span className="min-w-0 truncate">
                              {recommendation.sourcePositionLabel}
                            </span>
                          </span>
                          <span className="flex w-full min-w-0 items-center gap-1 text-xs text-gray-400">
                            <span className="shrink-0">Assign</span>
                            <span className="min-w-0 truncate">
                              {recommendation.candidateLabel}
                            </span>
                            <span className="shrink-0">here</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {showCreateOption ? (
                    <div
                      className={cn(
                        "px-2 pb-1 pt-2 text-xs text-gray-400",
                        (selectableRows.length > 0 || showSwapRecommendations) &&
                        "mt-1 border-t border-gray-800",
                      )}
                    >
                      <p className="px-0.5">No members match “{trimmedQuery}”.</p>
                      <Button
                        type="button"
                        variant="tertiary"
                        svg={Plus}
                        iconSize="sm"
                        color="#22d3ee"
                        padding="px-2 py-1"
                        className="mt-1 w-full justify-start text-sm font-medium text-cyan-300 hover:bg-gray-800"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          openCreateMember();
                        }}
                      >
                        Add “{trimmedQuery}” to the team
                      </Button>
                    </div>
                  ) : null}
                  {onAssignGuest ? (
                    <div
                      className={cn(
                        "px-1 pb-1 pt-1",
                        (selectableRows.length > 0 ||
                          showSwapRecommendations ||
                          showCreateOption) &&
                        "mt-1 border-t border-gray-800",
                      )}
                    >
                      {showRecentGuestsEntry ? (
                        <button
                          type="button"
                          className="flex min-w-0 w-full items-center gap-2 rounded px-2 py-1 text-left text-sm font-medium text-violet-200 hover:bg-gray-800"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            openRecentGuests();
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">Recent guests</span>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-violet-300/80"
                            aria-hidden
                          />
                        </button>
                      ) : null}
                      <Button
                        type="button"
                        variant="tertiary"
                        svg={Plus}
                        iconSize="sm"
                        color="#c4b5fd"
                        padding="px-2 py-1"
                        className="w-full justify-start text-sm font-medium text-violet-200 hover:bg-gray-800"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          openCreateGuest();
                        }}
                      >
                        Add guest
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="px-2 py-1 text-xs text-gray-500">
                  No eligible members.
                </p>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
ScheduleAssignmentPicker.displayName = "ScheduleAssignmentPicker";

export default ScheduleAssignmentPicker;
