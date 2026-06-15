import {
  createContext,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { TeamScheduleShadowKind } from "../../../api/authTypes";
import type { PendingCellAssignment } from "../types";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";
import type { ScheduleFocusedCell } from "./scheduleUtils";

type MemberAssignmentAction = "replace" | TeamScheduleShadowKind;

export type ScheduleAssignmentHandlers = {
  getAssignmentIssue: (
    memberId: string,
    occurrenceId: string,
    positionId: string,
    source?: { serviceId?: string; positionId?: string },
    assignmentKind?: "primary" | TeamScheduleShadowKind,
  ) => string;
  getAssignmentActionIssues: (
    memberId: string,
    occurrenceId: string,
    positionId: string,
    source?: { serviceId?: string; positionId?: string },
  ) => MemberAssignmentActionIssues;
  handleAssignmentAction: (args: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    action: MemberAssignmentAction;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
  }) => void;
  requestCellMemberAction: (args: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    currentPrimaryMemberId: string;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
  }) => void;
  commitAssignment: (args: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string | null;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
  }) => Promise<void>;
  commitShadowAssignment: (args: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    shadowKind: TeamScheduleShadowKind;
    action: "add" | "remove";
  }) => Promise<void>;
  createMemberForCell: (args: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    firstName: string;
    lastName: string;
  }) => Promise<void>;
  activateSlot: (cell: ScheduleFocusedCell, anchorEl: HTMLElement) => void;
  clearActiveSlot: () => void;
  setPendingCellAssignment: (pending: PendingCellAssignment | null) => void;
  confirmPendingReplace: () => void;
  confirmPendingShadow: (shadowKind: TeamScheduleShadowKind) => void;
};

export const ScheduleAssignmentContext =
  createContext<RefObject<ScheduleAssignmentHandlers | null> | null>(null);

export const ScheduleAssignmentProvider = ({
  handlers,
  children,
}: {
  handlers: ScheduleAssignmentHandlers;
  children: ReactNode;
}) => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  return (
    <ScheduleAssignmentContext.Provider value={handlersRef}>
      {children}
    </ScheduleAssignmentContext.Provider>
  );
};

