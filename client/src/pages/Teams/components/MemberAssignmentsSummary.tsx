import { useState } from "react";
import type { MemberListAssignment } from "../memberListAssignments";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/Popover";

const VISIBLE_POSITION_LIMIT = 3;

type AssignmentGroup = {
  teamId: string;
  teamName: string;
  positionNames: string[];
};

const getAssignmentDisplay = (assignments: MemberListAssignment[]) => {
  const groups = new Map<string, AssignmentGroup>();
  assignments.forEach(({ teamId, teamName, positionName }) => {
    const group = groups.get(teamId) || { teamId, teamName, positionNames: [] };
    if (positionName) group.positionNames.push(positionName);
    groups.set(teamId, group);
  });

  let visiblePositionCount = 0;
  const visibleGroups: AssignmentGroup[] = [];
  const hiddenGroups: AssignmentGroup[] = [];
  [...groups.values()].forEach((group) => {
    if (group.positionNames.length === 0) {
      visibleGroups.push(group);
      return;
    }

    const visibleCount = Math.max(
      0,
      Math.min(
        group.positionNames.length,
        VISIBLE_POSITION_LIMIT - visiblePositionCount,
      ),
    );
    visiblePositionCount += visibleCount;
    if (visibleCount > 0) {
      visibleGroups.push({
        ...group,
        positionNames: group.positionNames.slice(0, visibleCount),
      });
    }
    if (visibleCount < group.positionNames.length) {
      hiddenGroups.push({
        ...group,
        positionNames: group.positionNames.slice(visibleCount),
      });
    }
  });

  return {
    visibleGroups,
    hiddenGroups,
    hiddenPositionCount: hiddenGroups.reduce(
      (count, group) => count + group.positionNames.length,
      0,
    ),
  };
};

const AssignmentLines = ({ groups }: { groups: AssignmentGroup[] }) => (
  <div className="min-w-0 space-y-0.5 text-xs leading-4" aria-label="Member assignments">
    {groups.map((group) => (
      <div key={group.teamId} className="flex min-w-0 flex-wrap items-baseline gap-x-1">
        <span className="break-words font-medium text-gray-300">{group.teamName}</span>
        {group.positionNames.length > 0 ? (
          <>
            <span aria-hidden="true" className="shrink-0 text-gray-600">·</span>
            <span className="min-w-0 break-words text-gray-400">
              {group.positionNames.map((positionName, index) => (
                <span key={`${group.teamId}-${positionName}`}>
                  {index > 0 ? <span aria-hidden="true">, </span> : null}
                  {positionName}
                </span>
              ))}
            </span>
          </>
        ) : null}
      </div>
    ))}
  </div>
);

const AssignmentSummaryLine = ({ groups }: { groups: AssignmentGroup[] }) => (
  <div
    className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-4"
    aria-label="Member assignments"
  >
    {groups.map((group, index) => (
      <span key={group.teamId}>
        {index > 0 ? <span className="text-gray-600">, </span> : null}
        <span className="font-medium text-gray-300">{group.teamName}</span>
        {group.positionNames.length > 0 ? (
          <>
            <span aria-hidden="true" className="text-gray-600"> · </span>
            <span className="text-gray-400">{group.positionNames.join(", ")}</span>
          </>
        ) : null}
      </span>
    ))}
  </div>
);

type MemberAssignmentsSummaryProps = {
  assignments: MemberListAssignment[];
  memberName: string;
};

type MemberAssignmentsDetailsProps = Pick<
  MemberAssignmentsSummaryProps,
  "assignments"
>;

export const MemberAssignmentsDetails = ({
  assignments,
}: MemberAssignmentsDetailsProps) => {
  const { visibleGroups } = getAssignmentDisplay(assignments);
  return (
    assignments.length > 0 ? (
      <AssignmentSummaryLine groups={visibleGroups} />
    ) : (
      <p className="truncate text-xs leading-4 text-gray-500">No team assigned</p>
    )
  );
};

export const MemberAssignmentsMore = ({
  assignments,
  memberName,
}: MemberAssignmentsSummaryProps) => {
  const [open, setOpen] = useState(false);
  const { hiddenGroups, hiddenPositionCount } = getAssignmentDisplay(assignments);
  if (hiddenPositionCount === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`Show ${hiddenPositionCount} more positions for ${memberName}`}
          title={`Show ${hiddenPositionCount} more positions`}
          className="inline-flex h-4 shrink-0 items-center rounded px-1 text-xs leading-4 text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-400"
        >
          +{hiddenPositionCount}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`Additional assignments for ${memberName}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto border-gray-700 bg-gray-900 p-3 text-gray-100"
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-300">More assignments</p>
          <AssignmentLines groups={hiddenGroups} />
        </div>
      </PopoverContent>
    </Popover>
  );
};
