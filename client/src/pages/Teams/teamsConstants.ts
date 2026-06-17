import type { TeamsData, TeamsDataKey } from "./types";

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
