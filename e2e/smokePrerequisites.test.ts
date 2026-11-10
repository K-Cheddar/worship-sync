import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "@playwright/test";
import {
  formatControllerStartupDiagnostics,
  getControllerInitializationOutcome,
} from "./controllerRuntime";
import { beginSmokeTemplateNavigation } from "./smokeNavigation";
import {
  findSeededSmokeTemplate,
  smokePrerequisiteFailure,
  type SmokeAuthSnapshot,
} from "./smokePrerequisites";

const auth = (overrides: Partial<SmokeAuthSnapshot> = {}): SmokeAuthSnapshot => ({
  bootstrapStatus: 200,
  authenticated: true,
  sessionKind: "human",
  churchId: "demo",
  role: "member",
  controllerAccess: "full",
  teamsPermission: "edit",
  servicesPermission: "view",
  teamScopeCount: 1,
  editableTeamScopeCount: 1,
  canViewTeams: true,
  canViewServices: true,
  canEditAnyTeam: true,
  hasGlobalTeamsEdit: true,
  matchesConfiguredAccount: true,
  ...overrides,
});

const readyControllerSnapshot = () => ({
  isolation: {
    networkGuardInstalled: true,
    longPollingConfigured: true,
    writeCapabilitiesDisabled: true,
  },
  firebase: {
    databaseAvailable: true,
    sharedDataAuthenticated: true,
    connected: true,
    demoTenant: true,
    databaseUrlSupported: true,
    networkGuardInstalled: true,
    longPollingConfigured: true,
    writeCapabilitiesDisabled: true,
  },
  contentDatabaseAvailable: true,
  controllerData: {
    dbProgress: 100,
    bibleDbProgress: 100,
    connectionStatus: { status: "connected", retryCount: 0 },
  },
  startup: {
    controllerProfiles: { loaded: true, syncedToCurrentChurch: true },
    displayOutputs: { loaded: true, syncedToCurrentChurch: true },
    itemLibrary: { remoteReplicationComplete: true, initialized: true, errorPresent: false },
    outline: { listsInitialized: true, activeListInitialized: true },
  },
}) as unknown as NonNullable<Parameters<typeof getControllerInitializationOutcome>[0]>;

test("reports saved-session and Controller permission prerequisites without unsafe recovery", () => {
  const sessionFailure = smokePrerequisiteFailure({
    kind: "saved-session",
    auth: auth({ bootstrapStatus: 401, authenticated: false, sessionKind: null }),
  });
  assert.match(sessionFailure ?? "", /Saved-session authentication failed/);
  assert.match(sessionFailure ?? "", /No password or verification-code flow was attempted/);
  for (const accountMatch of [false, null]) {
    const accountFailure = smokePrerequisiteFailure({
      kind: "saved-session",
      auth: auth({ matchesConfiguredAccount: accountMatch }),
    });
    assert.match(accountFailure ?? "", /Saved-session authentication failed/);
  }

  const controllerFailure = smokePrerequisiteFailure({
    kind: "controller-access",
    auth: auth({ controllerAccess: "none" }),
  });
  assert.match(controllerFailure ?? "", /Missing Controller access:.*View, Music, or Full/);
});

test("distinguishes scoped Teams editing from Global Teams: Edit", () => {
  const scoped = auth({
    teamsPermission: "none",
    teamScopeCount: 1,
    editableTeamScopeCount: 1,
    canViewTeams: true,
    canEditAnyTeam: true,
    hasGlobalTeamsEdit: false,
  });

  assert.equal(smokePrerequisiteFailure({ kind: "team-edit", auth: scoped }), null);
  assert.match(
    smokePrerequisiteFailure({ kind: "global-teams-edit", auth: scoped }) ?? "",
    /Missing Global Teams: Edit.*Team-scoped editing does not grant access to first and last name fields/,
  );
});

test("reports missing Services permission and permits either View or Edit", () => {
  assert.equal(
    smokePrerequisiteFailure({ kind: "services-access", auth: auth({ servicesPermission: "edit" }) }),
    null,
  );
  const missing = smokePrerequisiteFailure({
    kind: "services-access",
    auth: auth({ servicesPermission: "none", canViewServices: false }),
  });
  assert.match(missing ?? "", /Services: View or Edit/);
  assert.match(missing ?? "", /E2E does not grant permissions/);
});

test("keeps Teams and Services access as separate smoke prerequisites", () => {
  const scopedTeamsOnly = auth({
    teamsPermission: "none",
    servicesPermission: "none",
    teamScopeCount: 1,
    canViewTeams: true,
    canViewServices: false,
  });
  assert.equal(smokePrerequisiteFailure({ kind: "teams-access", auth: scopedTeamsOnly }), null);
  assert.match(
    smokePrerequisiteFailure({ kind: "services-access", auth: scopedTeamsOnly }) ?? "",
    /Missing Services access/,
  );

  const servicesOnly = auth({
    teamsPermission: "none",
    servicesPermission: "view",
    teamScopeCount: 0,
    canViewTeams: false,
    canViewServices: true,
  });
  assert.equal(smokePrerequisiteFailure({ kind: "services-access", auth: servicesOnly }), null);
  assert.match(
    smokePrerequisiteFailure({ kind: "teams-access", auth: servicesOnly }) ?? "",
    /Missing Teams access/,
  );
});

test("reports missing saved service plans, templates, and active members", () => {
  assert.match(
    smokePrerequisiteFailure({ kind: "seeded-service-plan", count: 0, currentState: "No saved plans" }) ?? "",
    /Missing seeded service plan/,
  );
  assert.match(
    smokePrerequisiteFailure({ kind: "seeded-template", templates: [] }) ?? "",
    /Missing seeded template/,
  );
  assert.match(
    smokePrerequisiteFailure({ kind: "active-member", count: 0 }) ?? "",
    /Missing active member/,
  );
  assert.equal(findSeededSmokeTemplate([{ name: "Music", sections: [{ name: "Songs", elements: [] }] }])?.name, "Music");
  assert.equal(findSeededSmokeTemplate([{ name: "Empty", sections: [] }]), null);
});

test("smoke controller readiness requires replication, navigation overlay clearance, and startup state", () => {
  const ready = readyControllerSnapshot();
  assert.equal(getControllerInitializationOutcome(ready, true), "ready");
  assert.equal(getControllerInitializationOutcome(ready, false), "pending");
  assert.equal(getControllerInitializationOutcome({
    ...ready,
    controllerData: { ...ready.controllerData, dbProgress: 42 },
  } as typeof ready, true), "pending");
  assert.equal(getControllerInitializationOutcome({
    ...ready,
    controllerData: {
      ...ready.controllerData,
      connectionStatus: { status: "retrying", retryCount: 1 },
    },
  } as typeof ready, true), "pending");

  const notReplicated = {
    ...ready,
    startup: {
      ...ready.startup,
      itemLibrary: { ...ready.startup.itemLibrary, remoteReplicationComplete: false },
    },
  } as typeof ready;
  assert.equal(getControllerInitializationOutcome(notReplicated, true), "pending");

  const failed = {
    ...ready,
    controllerData: {
      ...ready.controllerData,
      connectionStatus: { status: "failed", retryCount: 3 },
    },
  } as typeof ready;
  assert.equal(getControllerInitializationOutcome(failed, false), "failed");
});

test("controller startup failure diagnostics include sanitized progress, connection, replication, and browser errors", () => {
  const snapshot = {
    ...readyControllerSnapshot(),
    controllerData: {
      dbProgress: 42,
      bibleDbProgress: 100,
      connectionStatus: {
        status: "retrying",
        retryCount: 2,
        message: "Sync retry for [redacted-email]",
      },
    },
    startup: {
      ...readyControllerSnapshot().startup,
      itemLibrary: { remoteReplicationComplete: false, initialized: false, errorPresent: false },
    },
    networkDiagnostics: [{ kind: "page_error", message: "Network is offline" }],
  } as typeof readyControllerSnapshot extends () => infer Snapshot ? Snapshot : never;
  const diagnostics = formatControllerStartupDiagnostics(
    "Controller did not initialize",
    snapshot,
    { available: true, documentCount: 12 },
    "Timeout after Bearer secret-token",
  );

  assert.match(diagnostics, /"dbProgress":42/);
  assert.match(diagnostics, /"status":"retrying"/);
  assert.match(diagnostics, /"remoteReplicationComplete":false/);
  assert.match(diagnostics, /"message":"Network is offline"/);
  assert.match(diagnostics, /Bearer \[redacted-token\]/);
  assert.doesNotMatch(diagnostics, /secret-token/);
});

test("registers only the demo Templates GET response before clicking Templates", async () => {
  const events: string[] = [];
  let resolveResponse!: (response: Response) => void;
  let responseMatcher: ((response: Response) => boolean) | undefined;
  const templateResponsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const templateResponse = {
    url: () => "https://local.worshipsync.net:5000/api/churches/demo/service-plan-templates",
    request: () => ({ method: () => "GET" }),
  } as unknown as Response;
  const fakePage = {
    waitForResponse: (matcher: (response: Response) => boolean) => {
      events.push("listener");
      responseMatcher = matcher;
      return templateResponsePromise;
    },
  };
  const { templateResponse: observedResponse, navigation } = beginSmokeTemplateNavigation(
    fakePage as unknown as Parameters<typeof beginSmokeTemplateNavigation>[0],
    async () => {
      events.push("click");
      assert.equal(responseMatcher?.(templateResponse), true);
      resolveResponse(templateResponse);
    },
    "https://local.worshipsync.net:3000/",
  );

  await navigation;
  assert.deepEqual(events, ["listener", "click"]);
  assert.equal(await observedResponse, templateResponse);
  assert.equal(responseMatcher?.({
    url: () => "https://local.worshipsync.net:5000/api/churches/other/service-plan-templates",
    request: () => ({ method: () => "GET" }),
  } as unknown as Response), false);
  assert.equal(responseMatcher?.({
    url: () => "https://local.worshipsync.net:5000/api/churches/demo/service-plan-templates",
    request: () => ({ method: () => "POST" }),
  } as unknown as Response), false);
});
