import type {
  TeamRecord,
  TeamIntakeForm,
  TeamIntakeSubmission,
  TeamPosition,
  TeamQualificationArea,
  TeamQualificationLevel,
  TeamRole,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleShadowKind,
  TeamService,
} from "../../api/authTypes";
import type { TeamSchedulePayload } from "../../api/auth";

export type TeamsData = {
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  teamRoles: TeamRole[];
  qualificationAreas: TeamQualificationArea[];
  qualificationLevels: TeamQualificationLevel[];
  services: TeamService[];
  schedules: TeamSchedule[];
  intakeForms: TeamIntakeForm[];
  intakeSubmissions: TeamIntakeSubmission[];
};

export type TeamsScheduleDrafts = Record<string, TeamSchedulePayload>;

export type TeamsDataKey = Exclude<keyof TeamsData, "services">;

export type TeamsTab =
  | "schedule"
  | "members"
  | "positions"
  | "teams"
  | "services"
  | "intake";

export type PendingCellAssignment = {
  serviceId: string;
  /** Target slot storage key (makeSlotKey(positionId, slot)). */
  cellKey: string;
  /** Base position id used for eligibility checks. */
  basePositionId: string;
  memberId: string;
  sourceServiceId?: string;
  /** Source slot storage key when moving an existing assignment. */
  sourcePositionSlotKey?: string;
};

export type { TeamScheduleShadowKind };
