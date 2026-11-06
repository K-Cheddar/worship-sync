import { expect, type Page, type Response } from "@playwright/test";
import { allowedE2EAuthOrigins } from "./authOrigins";
import { redactControllerDiagnosticText } from "./controllerRuntime";
import { E2E_CHURCH_ID } from "./testChurch";

type AuthRequestDiagnostic = {
  method: string;
  path: string;
  status: number | null;
  outcome: string;
};

export type E2EAuthFlags = {
  bootstrapStatus: number | null;
  authenticated: boolean | null;
  sessionKind: string | null;
  churchId: string | null;
  role: string | null;
  controllerAccess: string | null;
  teamsPermission: string | null;
  servicesPermission: string | null;
  teamScopeCount: number | null;
  canViewTeams: boolean | null;
  canViewServices: boolean | null;
  matchesConfiguredAccount: boolean | null;
  recoveryOutcome: string | null;
  authenticatedHomeReached: boolean;
  authRequests: AuthRequestDiagnostic[];
};

const unavailableAuthFlags: E2EAuthFlags = {
  bootstrapStatus: null,
  authenticated: null,
  sessionKind: null,
  churchId: null,
  role: null,
  controllerAccess: null,
  teamsPermission: null,
  servicesPermission: null,
  teamScopeCount: null,
  canViewTeams: null,
  canViewServices: null,
  matchesConfiguredAccount: null,
  recoveryOutcome: null,
  authenticatedHomeReached: false,
  authRequests: [],
};

const summarizeAuthBootstrap = (bootstrap: any, status: number): E2EAuthFlags => {
  const permissions = bootstrap?.permissions ?? {};
  const teamScopes = permissions.teamScopes ?? {};
  const isAdmin = bootstrap?.role === "admin";
  const teamsPermission = permissions.teams ?? "none";
  const servicesPermission = permissions.services ?? "none";
  return {
    bootstrapStatus: status,
    authenticated: bootstrap?.authenticated === true,
    sessionKind: bootstrap?.sessionKind ?? null,
    churchId: bootstrap?.churchId ?? null,
    role: bootstrap?.role ?? null,
    controllerAccess: bootstrap?.controllerAccess ?? bootstrap?.appAccess ?? null,
    teamsPermission,
    servicesPermission,
    teamScopeCount: Object.keys(teamScopes).length,
    canViewTeams:
      isAdmin ||
      teamsPermission === "view" ||
      teamsPermission === "edit" ||
      Object.keys(teamScopes).length > 0,
    canViewServices:
      isAdmin ||
      servicesPermission === "view" ||
      servicesPermission === "edit",
    matchesConfiguredAccount: (() => {
      const user = bootstrap?.user ?? {};
      const authenticatedEmail = String(user.primaryEmail || user.email || "").trim();
      const expectedEmail = process.env.E2E_TEST_EMAIL?.trim();
      return authenticatedEmail && expectedEmail
        ? authenticatedEmail.toLowerCase() === expectedEmail.toLowerCase()
        : null;
    })(),
    recoveryOutcome: null,
    authenticatedHomeReached: false,
    authRequests: [],
  };
};

export const hasControllerOperatorAccess = (auth: E2EAuthFlags) =>
  ["view", "music", "full"].includes(auth.controllerAccess || "");

export async function homeNavigationDiagnostics(
  page: Page,
  auth: E2EAuthFlags,
  reason: string,
) {
  const snapshot = await page
    .getByRole("main")
    .ariaSnapshot()
    .catch(async () => page.locator("body").ariaSnapshot().catch(() => "(unavailable)"));
  const pendingStates = await page
    .locator("main [aria-busy='true'], main [role='status']")
    .allTextContents()
    .catch(() => [] as string[]);
  const runtime = await page.evaluate(async () => {
    const safeStatus = (window as any).__controllerE2EFirebaseStatus?.();
    if (safeStatus) delete safeStatus.churchId;
    return {
      firebase: safeStatus ?? null,
      startup: (window as any).__controllerE2EStartupSnapshot?.() ?? null,
      isolation: (window as any).__controllerE2EIsolation ?? null,
      isolationMetrics: await (window as any).__controllerE2EIsolationMetrics?.() ?? null,
      events: ((window as any).__controllerE2ESafeDiagnostics ?? []).slice(-20),
    };
  }).catch(() => ({ firebase: null, startup: null, isolation: null, isolationMetrics: null, events: [] as any[] }));
  const sanitize = redactControllerDiagnosticText;
  const safeEvents = runtime.events.map((event: any) => ({
    kind: event.kind,
    ...(typeof event.category === "string" ? { category: event.category } : {}),
    ...(typeof event.method === "string" ? { method: event.method } : {}),
    ...(typeof event.status === "number" ? { status: event.status } : {}),
    ...(typeof event.message === "string" ? { message: sanitize(event.message) } : {}),
  }));
  const tokenEvents = safeEvents.filter((event: any) => event.category === "shared_data_token");
  const firebaseErrors = safeEvents
    .filter((event: any) => ["console_error", "page_error", "request_failed"].includes(event.kind))
    .map((event: any) => String(event.message ?? "").toLowerCase());
  const hasPermissionDenied = firebaseErrors.some((message: string) =>
    message.includes("permission_denied") || message.includes("permission denied") || message.includes("permission to access"),
  );
  const startup = runtime.startup;
  const firebase = runtime.firebase;
  let startupDiagnosis: string;
  if (auth.authenticated !== true) {
    startupDiagnosis = "Shared-data token and Firebase startup were downstream and are not the primary authentication failure.";
  } else if (!startup || !runtime.isolation) {
    startupDiagnosis = "Controller startup instrumentation is unavailable; Firebase startup state cannot be inferred.";
  } else if (tokenEvents.some((event: any) => event.kind === "request_failed" || (typeof event.status === "number" && event.status >= 400))) {
    const failedToken = tokenEvents.find((event: any) => event.status >= 400);
    startupDiagnosis = `Shared-data token request failed${failedToken?.status ? ` (HTTP ${failedToken.status})` : ""}.`;
  } else if (!firebase?.sharedDataAuthenticated) {
    startupDiagnosis = tokenEvents.some((event: any) => typeof event.status === "number" && event.status < 400)
      ? "The shared-data token request succeeded, but Firebase authentication did not complete."
      : "The shared-data token request did not complete, so Firebase authentication could not start.";
  } else if (!firebase?.databaseAvailable || !firebase?.connected) {
    startupDiagnosis = "Firebase Realtime Database did not reach its connected state.";
  } else if (hasPermissionDenied) {
    startupDiagnosis = "Firebase denied one or more startup subscriptions (permission_denied).";
  } else if (!startup?.controllerProfiles?.loaded || !startup?.controllerProfiles?.syncedToCurrentChurch) {
    startupDiagnosis = "The controller profile registry did not load for the authenticated church.";
  } else if (!startup?.displayOutputs?.loaded || !startup?.displayOutputs?.syncedToCurrentChurch) {
    startupDiagnosis = "The display output registry did not load for the authenticated church.";
  } else if (!startup?.controllerProfiles?.presentationFound || !startup?.controllerProfiles?.presentationEnabled) {
    startupDiagnosis = startup?.controllerProfiles?.presentationFound
      ? "The Presentation Controller profile is disabled."
      : "The Presentation Controller profile is missing.";
  } else {
    startupDiagnosis = "Firebase configuration loaded; Home failed to render the Controllers section or its Presentation Controller link.";
  }
  const safeAuth = { ...auth, churchId: auth.churchId ? "[present]" : null };
  return [
    reason,
    `Authentication state: ${JSON.stringify({ authenticatedHomeReached: auth.authenticatedHomeReached, recoveryOutcome: auth.recoveryOutcome, requests: auth.authRequests })}`,
    `Startup diagnosis: ${startupDiagnosis}`,
    `Application auth flags: ${JSON.stringify(safeAuth)}`,
    `Safe controller startup state: ${JSON.stringify({ isolation: runtime.isolation, isolationMetrics: runtime.isolationMetrics, firebase, startup })}`,
    `Sanitized browser diagnostics: ${JSON.stringify(safeEvents)}`,
    `Pending Home UI: ${JSON.stringify(pendingStates.map(sanitize))}`,
    "Sanitized Home accessibility snapshot:",
    sanitize(snapshot),
  ].join("\n");
}

export async function openHome(page: Page): Promise<E2EAuthFlags> {
  const allowedOrigins = process.env.E2E_BASE_URL
    ? allowedE2EAuthOrigins(process.env.E2E_BASE_URL)
    : new Set<string>();
  const authRequests: AuthRequestDiagnostic[] = [];
  const authRequestByRequest = new Map<object, AuthRequestDiagnostic>();
  const safeAuthPath = (pathname: string) =>
    ["/api/auth/me", "/api/auth/session", "/api/auth/shared-data-token"].includes(pathname)
      ? pathname
      : "/api/auth/[other]";
  const onAuthRequest = (request: any) => {
    let url: URL;
    try { url = new URL(request.url()); } catch { return; }
    if (!allowedOrigins.has(url.origin) || !url.pathname.startsWith("/api/auth/")) return;
    const diagnostic: AuthRequestDiagnostic = {
      method: request.method(),
      path: safeAuthPath(url.pathname),
      status: null,
      outcome: request.method() === "POST" && url.pathname === "/api/auth/session"
        ? "attempted"
        : "requested",
    };
    authRequests.push(diagnostic);
    authRequestByRequest.set(request, diagnostic);
  };
  const onAuthRequestFailed = (request: any) => {
    const diagnostic = authRequestByRequest.get(request);
    if (!diagnostic) return;
    diagnostic.outcome = request.failure()?.errorText?.includes("BLOCKED_BY_CLIENT")
      ? "blocked_unsafe_request"
      : "network_error";
  };
  const onAuthNetworkResponse = (response: Response) => {
    const diagnostic = authRequestByRequest.get(response.request());
    if (!diagnostic) return;
    diagnostic.status = response.status();
    diagnostic.outcome = response.headers()["x-e2e-auth-recovery-outcome"] || "response";
  };
  page.on("request", onAuthRequest);
  page.on("requestfailed", onAuthRequestFailed);
  page.on("response", onAuthNetworkResponse);

  const authResponses: Array<
    Promise<{ bootstrap: any; status: number; recoveryOutcome: string | null } | null>
  > = [];
  const onAuthResponse = (response: Response) => {
    let pathname: string;
    try {
      const responseURL = new URL(response.url());
      if (!allowedOrigins.has(responseURL.origin)) return;
      pathname = responseURL.pathname;
    } catch {
      return;
    }
    if (pathname !== "/api/auth/me" && pathname !== "/api/auth/session") {
      return;
    }
    authResponses.push(
      (async () => {
        try {
          const payload = await response.json();
          const bootstrap =
            payload?.bootstrap && typeof payload.bootstrap === "object"
              ? payload.bootstrap
              : payload;
          return bootstrap && typeof bootstrap === "object"
            ? {
                bootstrap,
                status: response.status(),
                recoveryOutcome: response.headers()["x-e2e-auth-recovery-outcome"] || null,
              }
            : null;
        } catch {
          return null;
        }
      })(),
    );
  };
  page.on("response", onAuthResponse);
  const authResponsePromise = page
    .waitForResponse((response) => {
      try {
        return allowedOrigins.has(new URL(response.url()).origin) &&
          new URL(response.url()).pathname === "/api/auth/me";
      } catch {
        return false;
      }
    }, { timeout: 20_000 })
    .catch(() => null);

  let homeState: "home" | "sign-in" | "verification" | null = null;
  try {
    await page.goto("/#/home", { waitUntil: "domcontentloaded" });
    const homeContent = page.getByTestId("home-content");
    const signInPrompt = page.getByRole("link", {
      name: "Sign in",
      exact: true,
    });
    const verificationPrompt = page.getByRole("heading", {
      name: "Check your email",
      exact: true,
    });
    const emailPrompt = page.getByLabel("Email", { exact: true });
    const observe = (
      locator: ReturnType<Page["getByTestId"]>,
      state: "home" | "sign-in" | "verification",
    ) =>
      locator
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => state)
        .catch(() => null);
    homeState = await Promise.race([
      observe(homeContent, "home"),
      observe(verificationPrompt, "verification"),
      observe(signInPrompt, "sign-in"),
      observe(emailPrompt, "sign-in"),
    ]);
  } catch {
    // The main landmark also exists on auth/loading screens. Wait for Home or
    // a settled sign-in state before treating its links or permissions as ready.
  }

  const firstAuthResponse = await authResponsePromise;
  const observedAuthResponses = await Promise.all(authResponses);
  page.off("response", onAuthResponse);
  page.off("request", onAuthRequest);
  page.off("requestfailed", onAuthRequestFailed);
  page.off("response", onAuthNetworkResponse);
  const authenticatedBootstrap = observedAuthResponses
    .filter(
      (candidate) =>
        candidate?.bootstrap?.authenticated === true &&
        ["human", "workstation"].includes(candidate.bootstrap.sessionKind),
    )
    .at(-1);
  const latestBootstrap = observedAuthResponses
    .filter((candidate) => candidate?.bootstrap)
    .at(-1);
  const finalBootstrap = authenticatedBootstrap ?? latestBootstrap;
  const auth = finalBootstrap
    ? summarizeAuthBootstrap(finalBootstrap.bootstrap, finalBootstrap.status)
    : {
        ...unavailableAuthFlags,
        bootstrapStatus: firstAuthResponse?.status() ?? null,
      };
  const sessionEvents = authRequests.filter(
    (event) => event.path === "/api/auth/session" && event.method === "POST",
  );
  auth.authRequests = authRequests;
  auth.recoveryOutcome = sessionEvents.at(-1)?.outcome ?? (
    authRequests.some((event) => event.outcome === "blocked_unsafe_request")
      ? "blocked_unsafe_request"
      : null
  );
  if (sessionEvents.length && auth.recoveryOutcome === "response") {
    const sessionResponse = observedAuthResponses
      .filter((candidate) => candidate?.recoveryOutcome)
      .at(-1);
    auth.recoveryOutcome = sessionResponse?.recoveryOutcome ?? "server_response";
  }

  if (homeState !== "home") {
    const outcome = auth.recoveryOutcome;
    const reason = outcome === "email_verification_required"
      ? "The server requires email verification for saved-session recovery. No verification email or code was requested. Refresh the saved E2E session explicitly with npm run test:e2e:auth:refresh."
      : outcome === "wrong_account"
        ? "Silent recovery returned a different account than E2E_TEST_EMAIL; the response was rejected before Home could use it."
        : outcome === "wrong_tenant"
          ? `Silent recovery returned a tenant other than ${E2E_CHURCH_ID}; the response was rejected before Home could use it.`
          : outcome === "invalid_authenticated_session"
            ? "Silent recovery did not return a complete authenticated human session; the response was rejected before Home could use it. No verification code was requested. Refresh the saved E2E session explicitly with npm run test:e2e:auth:refresh if verification is now required."
            : outcome === "server_rejected"
              ? "The server rejected silent session recovery. The saved E2E session must be refreshed explicitly if the account now requires verification."
              : outcome === "network_error"
                ? "Silent session recovery could not reach the server."
                : outcome === "blocked_unsafe_request"
                  ? "Silent session recovery was blocked because its request did not meet the saved-session safety policy."
                  : outcome === "authenticated"
                    ? "Silent recovery was safely allowed for the saved account and demo tenant, but authenticated Home did not finish loading."
                    : homeState === "verification"
                      ? "The saved session reached an email-verification screen. No verification email or code was requested; refresh the saved E2E session explicitly with npm run test:e2e:auth:refresh."
                      : homeState === "sign-in"
                        ? "The saved session is missing or invalid; Home is asking for sign-in. No password or email-code flow was submitted."
                        : "The saved session did not reach authenticated Home.";
    throw new Error(await homeNavigationDiagnostics(page, auth, reason));
  }

  if (
    auth.authenticated !== true ||
    auth.sessionKind !== "human" ||
    auth.churchId !== E2E_CHURCH_ID ||
    auth.matchesConfiguredAccount === false
  ) {
    throw new Error(await homeNavigationDiagnostics(
      page,
      auth,
      "Home loaded, but the authenticated session did not match the configured E2E human account for the demo tenant.",
    ));
  }
  auth.authenticatedHomeReached = true;

  return auth;
}

export const teamsAndServicesHomeLink = (page: Page) =>
  page
    .getByRole("link")
    .and(page.locator('main a[href="#/teams-and-services"]'));

export async function openEditableTeam(
  page: Page,
  expectedMemberState?: "empty" | "populated",
) {
  const editableTeam = page.getByTestId("entity-row").filter({
    has: page.getByRole("button", { name: /^Edit / }),
  }).first();
  await expect(
    editableTeam,
    "The saved E2E account needs edit access to at least one active team.",
  ).toBeVisible();
  await editableTeam.getByRole("button", { name: /^Edit / }).click();

  await expect(page.getByRole("heading", { name: "Edit team", exact: true })).toBeVisible();
  const editor = page.getByRole("region", { name: "Edit team", exact: true });
  const membersSection = editor.getByRole("region", { name: /^Members\b/ });
  await expect(membersSection).toBeVisible();
  const assignedMembers = membersSection.getByRole("list", {
    name: "Members on this team",
    exact: true,
  });
  const emptyState = membersSection.getByText("No members on this team yet.", {
    exact: true,
  });
  const [assignedListCount, emptyStateCount] = await Promise.all([
    assignedMembers.count(),
    emptyState.count(),
  ]);
  expect(assignedListCount + emptyStateCount).toBe(1);

  let memberState: "empty" | "populated";
  if (assignedListCount === 1) {
    await expect(assignedMembers).toBeVisible();
    expect(await assignedMembers.getByRole("listitem").count()).toBeGreaterThan(0);
    memberState = "populated";
  } else {
    await expect(emptyState).toBeVisible();
    memberState = "empty";
  }
  if (expectedMemberState) {
    expect(memberState, `Expected an editable team with ${expectedMemberState} membership`).toBe(
      expectedMemberState,
    );
  }

  await expect(
    membersSection.getByRole("textbox", { name: /^Add members:?$/ }),
  ).toBeVisible();
  // The empty suggestions list remains in the DOM but has no visible box until
  // a query returns candidates. Its hidden state is valid for an empty search.
  await expect(
    membersSection.getByRole("list", {
      name: "Matching members to add",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(editor.getByText("Positions", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit positions", exact: true })).toBeVisible();
}

export async function checkSchedulingPeriodRoundTrip(page: Page) {
  const range = page.locator('[aria-live="polite"]').filter({ hasText: /\d{4}/ }).first();
  await expect(range).toBeVisible();
  // Navigation switches Upcoming's text label to the custom range input.
  // Compare dates so both visible representations describe the same period.
  const readRange = async () => {
    const input = page.getByRole("textbox", { name: "Custom date range", exact: true });
    const text = await input.count() ? await input.inputValue() : await range.innerText();
    return text.split(" \u00b7 ")[0].split(/\s+[\u2013\u2014]\s+/).map((part) => {
      const date = new Date(part);
      if (Number.isNaN(date.getTime())) throw new Error(`Invalid schedule range: ${text}`);
      return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }).join("/");
  };
  const initialRange = await readRange();

  const scheduleControls = page.getByRole("group", { name: "Team schedule controls" });
  await expect(
    scheduleControls,
    "Scheduling requires an active team with a service occurrence and positions in the selected period.",
  ).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();
  await expect(page.getByRole("group", { name: "Schedule layout" })).toBeVisible();

  await page.getByRole("button", { name: "Next period" }).click();
  await expect.poll(readRange).not.toBe(initialRange);
  // Only the explicit no-occurrences state is a valid alternative. A loading,
  // permission, or data error cannot satisfy either branch.
  const emptyPeriod = page.getByText("No service occurrences are configured for this period.", { exact: false });
  await expect(scheduleControls.or(emptyPeriod)).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();

  await page.getByRole("button", { name: "Previous period" }).click();
  await expect.poll(readRange).toBe(initialRange);
  await expect(scheduleControls).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();
}
