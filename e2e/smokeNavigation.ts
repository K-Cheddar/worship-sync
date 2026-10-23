import { expect, type Page, type Response } from "@playwright/test";

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
  const sanitize = (value: string) =>
    value
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]")
      .replace(/https?:\/\/\S+/gi, "[redacted-url]")
      .replace(
        /((?:one[- ]time|verification|authentication|auth|login|sign[- ]?in|email|sms|2fa|mfa)\s+(?:verification\s+)?(?:code|passcode|otp)\s*(?:is|:|=|#)?\s*)\d{4,8}\b/gi,
        "$1[redacted-code]",
      );
  return [
    reason,
    `Application auth flags: ${JSON.stringify(auth)}`,
    `Pending Home UI: ${JSON.stringify(pendingStates.map(sanitize))}`,
    "Sanitized Home accessibility snapshot:",
    sanitize(snapshot),
  ].join("\n");
}

export async function openHome(page: Page): Promise<E2EAuthFlags> {
  const authResponses: Array<
    Promise<{ bootstrap: any; status: number } | null>
  > = [];
  const onAuthResponse = (response: Response) => {
    let pathname: string;
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      return;
    }
    if (
      !pathname.endsWith("/api/auth/me") &&
      !pathname.endsWith("/api/auth/session")
    ) {
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
            ? { bootstrap, status: response.status() }
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
        return new URL(response.url()).pathname.endsWith("/api/auth/me");
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

  if (homeState !== "home") {
    const reason = homeState === "verification"
      ? "The saved session reached an explicit email-verification screen. No verification email or code was requested; complete the existing sign-in flow before running authenticated E2E tests."
      : homeState === "sign-in"
        ? "The saved session did not reach authenticated Home; the application is asking for sign-in. No password or email-code flow was submitted."
        : "Home is still showing authentication/bootstrap loading UI. Identity and permission flags from the initial auth response are provisional until Home finishes loading.";
    throw new Error(await homeNavigationDiagnostics(page, auth, reason));
  }

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
