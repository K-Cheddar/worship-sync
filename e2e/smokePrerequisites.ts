import { E2E_CHURCH_ID } from "./testChurch";

export type SmokeAuthSnapshot = {
  bootstrapStatus: number | null;
  authenticated: boolean | null;
  sessionKind: string | null;
  churchId: string | null;
  role: string | null;
  controllerAccess: string | null;
  teamsPermission: string | null;
  servicesPermission: string | null;
  teamScopeCount: number | null;
  editableTeamScopeCount: number | null;
  canViewTeams: boolean | null;
  canViewServices: boolean | null;
  canEditAnyTeam: boolean | null;
  hasGlobalTeamsEdit: boolean | null;
  matchesConfiguredAccount: boolean | null;
};

export type SmokePrerequisite =
  | { kind: "saved-session"; auth: SmokeAuthSnapshot }
  | { kind: "controller-access"; auth: SmokeAuthSnapshot }
  | { kind: "teams-access"; auth: SmokeAuthSnapshot }
  | { kind: "team-edit"; auth: SmokeAuthSnapshot }
  | { kind: "global-teams-edit"; auth: SmokeAuthSnapshot }
  | { kind: "services-access"; auth: SmokeAuthSnapshot }
  | { kind: "seeded-service-plan"; count: number; currentState: string }
  | { kind: "seeded-template"; templates: unknown }
  | { kind: "active-member"; count: number };

export type SmokeServiceTemplate = {
  name: string;
  sections: Array<{ name: string; elements: unknown[] }>;
};

export function findSeededSmokeTemplate(value: unknown): SmokeServiceTemplate | null {
  if (!Array.isArray(value)) return null;
  const templates = value as unknown[];
  return templates.find((candidate): candidate is SmokeServiceTemplate => {
    if (!candidate || typeof candidate !== "object") return false;
    const template = candidate as Partial<SmokeServiceTemplate>;
    return typeof template.name === "string" &&
      template.name.trim().length > 0 &&
      Array.isArray(template.sections) &&
      template.sections.length > 0 &&
      template.sections.every((section) =>
        section && typeof section.name === "string" && Array.isArray(section.elements),
      ) &&
      templates.filter((item) =>
        item && typeof item === "object" &&
        (item as Partial<SmokeServiceTemplate>).name === template.name,
      ).length === 1;
  }) ?? null;
}

export function smokePrerequisiteFailure(prerequisite: SmokePrerequisite): string | null {
  switch (prerequisite.kind) {
    case "saved-session": {
      const { auth } = prerequisite;
      if (
        auth.bootstrapStatus !== 200 ||
        auth.authenticated !== true ||
        auth.sessionKind !== "human" ||
        auth.churchId !== E2E_CHURCH_ID ||
        auth.matchesConfiguredAccount !== true
      ) {
        return `Saved-session authentication failed: smoke requires the configured human account in church ${E2E_CHURCH_ID} (bootstrap HTTP ${auth.bootstrapStatus ?? "unavailable"}, authenticated ${auth.authenticated ?? "unknown"}, session ${auth.sessionKind ?? "unknown"}). No password or verification-code flow was attempted.`;
      }
      return null;
    }
    case "controller-access":
      return ["view", "music", "full"].includes(prerequisite.auth.controllerAccess ?? "")
        ? null
        : `Missing Controller access: the saved account needs View, Music, or Full controller access (current access: ${prerequisite.auth.controllerAccess ?? "none"}).`;
    case "teams-access":
      return prerequisite.auth.canViewTeams
        ? null
        : `Missing Teams access: the saved account needs Global Teams: View/Edit or a team-scoped grant (current Global Teams: ${prerequisite.auth.teamsPermission ?? "none"}; team scopes: ${prerequisite.auth.teamScopeCount ?? "unknown"}).`;
    case "team-edit":
      return prerequisite.auth.canEditAnyTeam
        ? null
        : `Missing team edit access: the saved account needs Global Teams: Edit or an edit grant for at least one active team (current Global Teams: ${prerequisite.auth.teamsPermission ?? "none"}; editable team scopes: ${prerequisite.auth.editableTeamScopeCount ?? "unknown"}).`;
    case "global-teams-edit":
      return prerequisite.auth.hasGlobalTeamsEdit
        ? null
        : `Missing Global Teams: Edit: the Members smoke workflow opens the full church member editor, which requires Global Teams: Edit (current permission: ${prerequisite.auth.teamsPermission ?? "none"}). Team-scoped editing does not grant access to first and last name fields.`;
    case "services-access":
      return prerequisite.auth.canViewServices
        ? null
        : `Missing Services access: the saved account needs Services: View or Edit to open Services, Equipment, and Templates (current permission: ${prerequisite.auth.servicesPermission ?? "none"}). Grant it through WorshipSync's existing account permissions interface; E2E does not grant permissions.`;
    case "seeded-service-plan":
      return prerequisite.count > 0
        ? null
        : `Missing seeded service plan: Services loaded with no openable saved plan. Provision at least one dated service with a saved plan in the demo church. Current Services state: ${prerequisite.currentState}`;
    case "seeded-template": {
      if (Array.isArray(prerequisite.templates) && prerequisite.templates.length > 0 && findSeededSmokeTemplate(prerequisite.templates)) {
        return null;
      }
      if (!Array.isArray(prerequisite.templates)) {
        return "Templates API response did not include a template list; this response cannot verify the seeded-template fixture.";
      }
      return prerequisite.templates.length > 0
        ? `Missing seeded template: the demo church needs a uniquely named service template with at least one section and valid section items (${prerequisite.templates.length} template record(s) were returned).`
        : "Missing seeded template: the demo church needs at least one existing service template with section structure.";
    }
    case "active-member":
      return prerequisite.count > 0
        ? null
        : "Missing active member: the demo church must contain at least one active member for the member-details smoke workflow.";
  }
}

export function requireSmokePrerequisite(prerequisite: SmokePrerequisite): void {
  const failure = smokePrerequisiteFailure(prerequisite);
  if (failure) throw new Error(failure);
}
