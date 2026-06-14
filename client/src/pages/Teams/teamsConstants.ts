import type { TeamsData, TeamsDataKey } from "./types";

export const LEGACY_TEAMS_POUCH_DOC_ID = "teams";
export const TEAMS_META_DOC_ID = "teams:meta";
export const TEAMS_DRAFTS_DOC_ID = "teams:drafts";
export const TEAMS_FAILURES_DOC_ID = "teams:failed-assignments";

export const teamsDataDocId = <K extends TeamsDataKey>(key: K): `teams:data:${K}` =>
  `teams:data:${key}`;

export const teamsDataKeys: TeamsDataKey[] = [
  "members",
  "positions",
  "teams",
  "teamRoles",
  "qualificationAreas",
  "qualificationLevels",
  "schedules",
  "intakeForms",
  "intakeSubmissions",
];

export const emptyDuplicateFirstNames = new Set<string>();

export const emptyData: TeamsData = {
  members: [],
  positions: [],
  teams: [],
  teamRoles: [],
  qualificationAreas: [],
  qualificationLevels: [],
  services: [],
  schedules: [],
  intakeForms: [],
  intakeSubmissions: [],
};
