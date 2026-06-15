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
export type FailedAssignments = Record<string, string>;

export type TeamsDataKey = Exclude<keyof TeamsData, "services">;

export type LegacyTeamsPouchDoc = {
  _id: string;
  _rev?: string;
  docType: "teams-cache";
  churchId: string;
  data: TeamsData;
  selectedScheduleId?: string;
  scheduleDrafts?: TeamsScheduleDrafts;
  failedAssignments?: FailedAssignments;
  updatedAt: string;
  lastRemoteSyncAt?: string;
};

export type TeamsMetaPouchDoc = {
  _id: "teams:meta";
  _rev?: string;
  docType: "teams-meta";
  churchId: string;
  selectedScheduleId?: string;
  updatedAt: string;
  lastRemoteSyncAt?: string;
};

export type TeamsDataPouchDoc<K extends TeamsDataKey = TeamsDataKey> = {
  _id: `teams:data:${K}`;
  _rev?: string;
  docType: "teams-data";
  churchId: string;
  key: K;
  items: TeamsData[K];
  updatedAt: string;
};

export type TeamsDraftsPouchDoc = {
  _id: "teams:drafts";
  _rev?: string;
  docType: "teams-drafts";
  churchId: string;
  scheduleDrafts: TeamsScheduleDrafts;
  updatedAt: string;
};

export type TeamsFailuresPouchDoc = {
  _id: "teams:failed-assignments";
  _rev?: string;
  docType: "teams-failed-assignments";
  churchId: string;
  failedAssignments: FailedAssignments;
  updatedAt: string;
};

export type TeamsPouchDoc =
  | LegacyTeamsPouchDoc
  | TeamsMetaPouchDoc
  | TeamsDataPouchDoc
  | TeamsDraftsPouchDoc
  | TeamsFailuresPouchDoc;

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
