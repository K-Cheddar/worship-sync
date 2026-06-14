import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
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
        slotContext.positionId,
      );

      return (
        <div key={row.member.memberId}>
          {showPositionGroupDivider ? <ScheduleMemberPositionGroupDivider /> : null}
          {showEligibilityGroupDivider ? <ScheduleMemberPositionGroupDivider /> : null}
          <MemberChip
            label={scheduleMemberName(row.member, duplicateFirstNames)}
            subtitle={row.eligible ? baseSubtitle : row.issue}
            issue={row.eligible ? undefined : row.issue}
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
        "relative flex shrink-0 flex-col self-stretch overflow-hidden rounded-lg border bg-gray-950/60 transition-[width,border-color] duration-300 ease-in-out lg:sticky lg:top-4 lg:min-h-0",
        open ? "w-full lg:w-80" : "w-10",
        isAssignMode ? "border-orange-400/40" : "border-gray-700",
      )}
      aria-label="Members"
    >
      {open ? (
        <div
          ref={panelRef}
          className="relative flex h-full min-h-0 w-full flex-col p-3"
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
              <div className="relative flex items-center justify-center">
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-1 py-1"
                  className="absolute left-0 shrink-0"
                  svg={ChevronRight}
                  aria-expanded
                  aria-label="Hide members"
                  onClick={() => onOpenChange(false)}
                />
                <div className="flex items-center gap-2">
                  <Icon
                    svg={Users}
                    size="sm"
                    className="shrink-0 text-orange-400"
                    alt=""
                  />
                  <p className="text-sm font-semibold text-white">Members</p>
                </div>
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

          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {isAssignMode ? renderAssignList() : renderBrowseList()}
          </div>
        </div>
      ) : (
        <div className="flex h-full w-10 flex-col items-center gap-2 py-3">
          <Icon svg={Users} size="sm" className="text-orange-400" alt="Members" />
          <Button
            type="button"
            variant="tertiary"
            padding="px-1 py-1"
            svg={ChevronLeft}
            aria-expanded={false}
            aria-label="Show members"
            onClick={() => onOpenChange(true)}
          />
        </div>
      )}
    </aside>
  );
};

export default ScheduleMembersPanel;
