import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Users } from "lucide-react";
import Button from "../../../components/Button/Button";
import Icon from "../../../components/Icon/Icon";
import { cn } from "@/utils/cnHelper";
import { parsePlainDate } from "@/utils/plainDate";
import type { TeamPosition, TeamRosterMember } from "../../../api/authTypes";
import EntityListSearch from "../components/EntityListSearch";
import MemberChip from "./MemberChip";
import ScheduleMembersPositionFilter from "./ScheduleMembersPositionFilter";
import ScheduleSlotContextHeader from "./ScheduleSlotContextHeader";
import { useScheduleMemberPicker } from "./useScheduleMemberPicker";
import {
  formatBlockoutDateRangeLabel,
  getScheduleMemberPositionNames,
  memberMatchesScheduleQuery,
  scheduleMemberName,
  sortTeamRosterMembersByScheduleDisplay,
} from "../teamsUtils";
import ScheduleMemberPositionGroupDivider from "./ScheduleMemberPositionGroupDivider";
import { shouldShowScheduleMemberEligibilityGroupDivider, shouldShowScheduleMemberPositionGroupDivider } from "./scheduleMemberPickerUtils";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";

export type ScheduleMembersPanelMode = "browse" | "assign";

type ScheduleMembersPanelProps = {
  panelRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ScheduleMembersPanelMode;
  activeTeamMembers: TeamRosterMember[];
  schedulePositions: TeamPosition[];
  scheduleAssignmentCounts: Map<string, number>;
  duplicateFirstNames: Set<string>;
  highlightedMemberIdSet: Set<string>;
  onToggleHighlight: (memberId: string) => void;
  memberPositionFilterIds: string[];
  onMemberPositionFilterChange: (positionIds: string[]) => void;
  membersPanelQuery: string;
  onMembersPanelQueryChange: (query: string) => void;
  assignmentQuery: string;
  onAssignmentQueryChange: (query: string) => void;
  slotContext?: {
    positionLabel: string;
    occurrenceLabel: string;
    currentAssigneeLabel: string;
    positionId: string;
    currentPrimaryMemberId: string;
  };
  onClearSlot: () => void;
  onSelectMember: (memberId: string) => void;
  getIssue: (memberId: string) => string;
  getAssignmentActionIssues?: (memberId: string) => MemberAssignmentActionIssues;
  getWarning?: (memberId: string) => string;
  canEditMember?: (member: TeamRosterMember) => boolean;
  onEditMember?: (memberId: string) => void;
};

const ScheduleMembersPanel = ({
  panelRef,
  open,
  onOpenChange,
  mode,
  activeTeamMembers,
  schedulePositions,
  scheduleAssignmentCounts,
  duplicateFirstNames,
  highlightedMemberIdSet,
  onToggleHighlight,
  memberPositionFilterIds,
  onMemberPositionFilterChange,
  membersPanelQuery,
  onMembersPanelQueryChange,
  assignmentQuery,
  onAssignmentQueryChange,
  slotContext,
  onClearSlot,
  onSelectMember,
  getIssue,
  getAssignmentActionIssues,
  getWarning,
  canEditMember,
  onEditMember,
}: ScheduleMembersPanelProps) => {
  const isAssignMode = mode === "assign" && Boolean(slotContext);
  const searchValue = isAssignMode ? assignmentQuery : membersPanelQuery;
  const onSearchChange = isAssignMode ? onAssignmentQueryChange : onMembersPanelQueryChange;
  const [expandedMemberIds, setExpandedMemberIds] = useState<string[]>([]);
  const expandedMemberIdSet = new Set(expandedMemberIds);

  useEffect(() => {
    setExpandedMemberIds([]);
  }, [isAssignMode, slotContext?.positionId]);

  const toggleExpandedMember = useCallback((memberId: string) => {
    setExpandedMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  }, []);

  const renderMemberDetails = (member: TeamRosterMember) => {
    const positionNames = getScheduleMemberPositionNames(member, schedulePositions);
    const blockoutDates = member.blockoutDates || [];
    const dateOfBirth = member.dateOfBirth
      ? parsePlainDate(member.dateOfBirth)?.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
      : "";

    return (
      <dl className="space-y-2">
        <div>
          <dt className="font-semibold text-gray-400">Positions</dt>
          <dd className="mt-0.5 text-gray-200">
            {positionNames.length > 0 ? positionNames.join(", ") : "None assigned"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-400">Unavailable dates</dt>
          <dd className="mt-0.5 text-gray-200">
            {blockoutDates.length > 0 ? (
              <ul className="space-y-1">
                {blockoutDates.map((range, index) => (
                  <li key={`${range.startDate}-${range.endDate}-${index}`}>
                    <span>{formatBlockoutDateRangeLabel(range)}</span>
                    {range.notes ? (
                      <span className="block text-gray-400">{range.notes}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              "None listed"
            )}
          </dd>
        </div>
        {dateOfBirth ? (
          <div>
            <dt className="font-semibold text-gray-400">Date of birth</dt>
            <dd className="mt-0.5 text-gray-200">{dateOfBirth}</dd>
          </div>
        ) : null}
        {member.notes ? (
          <div>
            <dt className="font-semibold text-gray-400">Notes</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-gray-200">{member.notes}</dd>
          </div>
        ) : null}
        {canEditMember?.(member) ? (
          <div className="pt-1">
            <Button
              type="button"
              variant="tertiary"
              svg={Pencil}
              iconSize="sm"
              padding="px-2 py-1"
              className="text-xs"
              onClick={() => onEditMember?.(member.memberId)}
            >
              Edit member
            </Button>
          </div>
        ) : null}
      </dl>
    );
  };

  const assignPicker = useScheduleMemberPicker({
    members: activeTeamMembers,
    positionId: slotContext?.positionId || "",
    assignmentQuery,
    currentPrimaryMemberId: slotContext?.currentPrimaryMemberId || "",
    duplicateFirstNames,
    getIssue,
    getAssignmentActionIssues,
    getWarning,
    filterByQuery: isAssignMode,
  });

  const browseMembers = sortTeamRosterMembersByScheduleDisplay(
    activeTeamMembers.filter((member) => {
      const matchesPositionFilter =
        memberPositionFilterIds.length === 0 ||
        (member.positionIds || []).some((positionId) =>
          memberPositionFilterIds.includes(positionId),
        );
      if (!matchesPositionFilter) return false;
      return memberMatchesScheduleQuery(member, membersPanelQuery, duplicateFirstNames);
    }),
    duplicateFirstNames,
  );

  const renderBrowseList = () => {
    if (activeTeamMembers.length === 0) {
      return (
        <p className="text-sm text-gray-400">Choose a team with active members.</p>
      );
    }
    if (browseMembers.length === 0) {
      return <p className="text-sm text-gray-400">No matches.</p>;
    }
    return browseMembers.map((member) => {
      const positionNames = getScheduleMemberPositionNames(member, schedulePositions);
      return (
        <MemberChip
          key={member.memberId}
          label={scheduleMemberName(member, duplicateFirstNames)}
          subtitle={positionNames.length > 0 ? positionNames.join(", ") : undefined}
          assignmentCount={scheduleAssignmentCounts.get(member.memberId) || 0}
          highlighted={highlightedMemberIdSet.has(member.memberId)}
          expanded={expandedMemberIdSet.has(member.memberId)}
          showHighlightAction
          details={renderMemberDetails(member)}
          onToggleHighlight={() => onToggleHighlight(member.memberId)}
          onToggleExpand={() => toggleExpandedMember(member.memberId)}
        />
      );
    });
  };

  const renderAssignList = () => {
    if (!slotContext) return null;
    if (assignPicker.positionMembers.length === 0) {
      return <p className="text-sm text-gray-400">No members for this position.</p>;
    }

    return assignPicker.positionMembers.map((row, index) => {
      const positionNames = getScheduleMemberPositionNames(row.member, schedulePositions);
      const baseSubtitle =
        positionNames.length > 0 ? positionNames.join(", ") : undefined;
      const showPositionGroupDivider = shouldShowScheduleMemberPositionGroupDivider(
        assignPicker.positionMembers,
        index,
        slotContext.positionId,
      );
      const showEligibilityGroupDivider = shouldShowScheduleMemberEligibilityGroupDivider(
        assignPicker.positionMembers,
        index,
      );

      return (
        <div key={row.member.memberId}>
          {showPositionGroupDivider ? <ScheduleMemberPositionGroupDivider /> : null}
          {showEligibilityGroupDivider ? <ScheduleMemberPositionGroupDivider /> : null}
          <MemberChip
            label={scheduleMemberName(row.member, duplicateFirstNames)}
            subtitle={row.eligible ? baseSubtitle : row.issue}
            issue={row.eligible ? undefined : row.issue}
            warning={row.eligible ? row.warning || undefined : undefined}
            desiresPosition={row.desiresPosition}
            assignmentCount={scheduleAssignmentCounts.get(row.member.memberId) || 0}
            disabled={!row.eligible}
            expanded={expandedMemberIdSet.has(row.member.memberId)}
            details={renderMemberDetails(row.member)}
            onToggleExpand={() => toggleExpandedMember(row.member.memberId)}
            onSelect={() => {
              if (!row.eligible) return;
              onSelectMember(row.member.memberId);
            }}
          />
        </div>
      );
    });
  };

  return (
    <aside
      data-schedule-members-panel
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col self-stretch rounded-lg border bg-gray-950/60 transition-[width,border-color] duration-300 ease-in-out",
        open ? "w-full lg:w-80" : "w-10",
        isAssignMode ? "border-orange-400/40" : "border-gray-700",
      )}
      aria-label="Members"
    >
      <Button
        type="button"
        variant="tertiary"
        padding="px-1 py-1"
        className={cn(
          "absolute left-0 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-gray-950 shadow-sm",
          isAssignMode ? "border-orange-400/40" : "border-gray-700",
        )}
        svg={open ? ChevronRight : ChevronLeft}
        aria-expanded={open}
        aria-label={open ? "Hide members" : "Show members"}
        onClick={() => onOpenChange(!open)}
      />
      {open ? (
        <div
          ref={panelRef}
          className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg p-3"
        >
          {isAssignMode && slotContext ? (
            <ScheduleSlotContextHeader
              positionLabel={slotContext.positionLabel}
              occurrenceLabel={slotContext.occurrenceLabel}
              currentAssigneeLabel={slotContext.currentAssigneeLabel}
              onDone={onClearSlot}
            />
          ) : (
            <div className="shrink-0">
              <div className="flex items-center justify-center gap-2">
                <Icon
                  svg={Users}
                  size="sm"
                  className="shrink-0 text-orange-400"
                  alt=""
                />
                <p className="text-sm font-semibold text-white">Members</p>
              </div>
              <p className="mt-1 text-xs text-gray-300">
                Use the highlight icon to mark assignments on the grid. Open details with the info icon.
              </p>
            </div>
          )}

          {activeTeamMembers.length > 0 ? (
            <div className="mt-3 flex shrink-0 flex-col gap-2">
              <ScheduleMembersPositionFilter
                panelRef={panelRef}
                positions={schedulePositions}
                value={memberPositionFilterIds}
                onChange={onMemberPositionFilterChange}
              />
              <EntityListSearch
                label={isAssignMode ? "Search members to assign" : "Members"}
                value={searchValue}
                onChange={onSearchChange}
              />
            </div>
          ) : null}

          <div className="scrollbar-variable mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {isAssignMode ? renderAssignList() : renderBrowseList()}
          </div>
        </div>
      ) : (
        <div className="flex h-full w-10 flex-col items-center py-3">
          <Icon svg={Users} size="sm" className="text-orange-400" alt="Members" />
        </div>
      )}
    </aside>
  );
};

export default ScheduleMembersPanel;
