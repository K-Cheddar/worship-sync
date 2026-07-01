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
import { ChevronRight, Plus, TriangleAlert } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import { cn } from "@/utils/cnHelper";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/Popover";
import type { TeamRosterMember } from "../../../api/authTypes";
import type { TeamScheduleShadowKind } from "../../../api/authTypes";
import { emptyDuplicateFirstNames } from "../teamsConstants";
import { scheduleMemberName } from "../teamsUtils";
import MemberAssignmentSubmenu, {
  type MemberAssignmentActionIssues,
} from "./MemberAssignmentSubmenu";
import { splitTypedMemberName, shouldShowScheduleMemberPositionGroupDivider } from "./scheduleMemberPickerUtils";
import ScheduleMemberPositionGroupDivider from "./ScheduleMemberPositionGroupDivider";
import { useScheduleMemberPicker } from "./useScheduleMemberPicker";
import { WantsThisIcon } from "./WantsThisIndicator";

type MemberAssignmentAction = "replace" | TeamScheduleShadowKind;
type PickerMenuView = "members" | "assignmentActions" | "createMember";

/**
 * Non-blocking caution (e.g. the member marked this service unavailable on
 * intake). They can still be picked — this just flags it.
 */
const WarningBadge = ({ label }: { label: string }) => (
  <span
    title={label}
    aria-label={label}
    className="inline-flex shrink-0 items-center rounded-full bg-amber-500/20 p-1 text-amber-200"
  >
    <TriangleAlert className="h-3 w-3" aria-hidden />
  </span>
);

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
  duplicateFirstNames?: Set<string>;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (memberId: string) => MemberAssignmentActionIssues;
  getWarning?: (memberId: string) => string;
  onSelectMember: (memberId: string) => void;
  onAssignmentAction?: (memberId: string, action: MemberAssignmentAction) => void;
  onCreateMember?: (member: { firstName: string; lastName: string }) => Promise<void> | void;
  onClearAssignment?: () => void;
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
  duplicateFirstNames,
  getIssue,
  getAssignmentActionIssues,
  getWarning,
  onSelectMember,
  onAssignmentAction,
  onCreateMember,
  onClearAssignment,
  pendingSubmenu,
  inputRef: externalInputRef,
}: ScheduleAssignmentPickerProps) => {
  const listboxId = useId();
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const anchorProxyRef = useRef<HTMLSpanElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [menuView, setMenuView] = useState<PickerMenuView>("members");
  const [activeSubmenuMemberId, setActiveSubmenuMemberId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState({ firstName: "", lastName: "" });
  const [creatingMember, setCreatingMember] = useState(false);
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
      setActiveSubmenuMemberId(null);
      setHighlightedIndex(0);
      setCreateDraft({ firstName: "", lastName: "" });
      setCreatingMember(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [inputRef, open, anchorEl]);

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

  const selectableRows = positionMembers.filter((row) => row.eligible);
  const trimmedQuery = assignmentQuery.trim();

  const showClearAssignmentOption =
    Boolean(currentPrimaryMemberId) &&
    !trimmedQuery &&
    menuView === "members" &&
    Boolean(onClearAssignment);

  const showListContent =
    menuView === "assignmentActions" ||
    menuView === "createMember" ||
    Boolean(pendingSubmenu) ||
    selectableRows.length > 0 ||
    showCreateOption ||
    showClearAssignmentOption;

  const pickerOpen = open && Boolean(anchorRect);

  const handleSelectRow = (memberId: string, usesSubmenu: boolean) => {
    if (usesSubmenu) {
      openAssignmentActions(memberId);
      return;
    }
    onSelectMember(memberId);
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
      currentPrimaryMemberId &&
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
        sideOffset={4}
        className="z-50 w-48 overflow-hidden rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (menuView !== "createMember") event.preventDefault();
        }}
      >
        <div className="border-b border-gray-800 p-2">
          <label className="sr-only">{label}</label>
          <input
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={pickerOpen}
            aria-label={label}
            className="w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-white focus:border-gray-600 focus:outline-none"
            value={assignmentQuery}
            onChange={(event) => {
              onAssignmentQueryChange(event.target.value);
              setMenuView("members");
              setActiveSubmenuMemberId(null);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </div>
        <div className="scrollbar-variable max-h-56 overflow-x-hidden overflow-y-auto">
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
          ) : (
            <div className="p-1">
              {showListContent ? (
                <>
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
                  {selectableRows.map((row, index) => {
                    const memberLabel = formatMemberLabel(row.member);
                    const highlighted =
                      selectableRows.findIndex(
                        (item) => item.member.memberId === row.member.memberId,
                      ) === highlightedIndex;
                    const showPositionGroupDivider =
                      shouldShowScheduleMemberPositionGroupDivider(
                        selectableRows,
                        index,
                        positionId,
                      );

                    if (row.usesSubmenu) {
                      return (
                        <div key={row.member.memberId}>
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
                            <span className="min-w-0 flex-1 truncate font-medium">{memberLabel}</span>
                            {row.warning ? <WarningBadge label={row.warning} /> : null}
                            {row.desiresPosition ? <WantsThisIcon /> : null}
                            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div key={row.member.memberId}>
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
                          <span className="min-w-0 flex-1 truncate">{memberLabel}</span>
                          {row.warning ? <WarningBadge label={row.warning} /> : null}
                          {row.desiresPosition ? <WantsThisIcon /> : null}
                        </button>
                      </div>
                    );
                  })}
                  {showCreateOption ? (
                    <div
                      className={cn(
                        "px-2 pb-1 pt-2 text-xs text-gray-400",
                        selectableRows.length > 0 && "mt-1 border-t border-gray-800",
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
