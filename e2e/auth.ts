import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";

type AuthStateFiles = { authFile: string; metadataFile: string };

const defaultAuthFiles: AuthStateFiles = {
  authFile: resolve("playwright/.auth/worshipsync-user.json"),
  metadataFile: resolve("playwright/.auth/worshipsync-user.meta.json"),
};
const metadataVersion = 1;

export type AuthenticatedIdentity = {
  email: string;
  tenantLabel: string;
  tenantIdFingerprint: string;
};

type SessionMetadata = {
  version: number;
  application: string;
  accountFingerprint: string;
  tenantIdFingerprint?: string | null;
  tenantLabel: string;
};

export type SessionCheck =
  | { status: "valid"; identity: AuthenticatedIdentity }
  | { status: "invalid"; reason: string }
  | { status: "infrastructure-error"; reason: string };

type SavedStorageState = {
  cookies?: Array<{
    name?: unknown;
    value?: unknown;
    domain?: unknown;
    expires?: unknown;
  }>;
  origins?: Array<{
    origin?: unknown;
    localStorage?: Array<{ name?: unknown; value?: unknown }>;
    indexedDB?: Array<{
      name?: unknown;
      stores?: Array<{ name?: unknown; records?: unknown[] }>;
    }>;
  }>;
};

type SavedStorageInspection =
  | { ok: false; reason: string }
  | {
      ok: true;
      cookieValue: string | null;
      deviceIdentity: string;
      hasUsableServerCookie: boolean;
    };

const serverSessionCookieName = "worshipsync_sid";
const deviceIdentityKey = "worshipsync_device_id";
const firebaseDatabaseName = "firebaseLocalStorageDb";
const firebaseStoreName = "firebaseLocalStorage";

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for WorshipSync E2E authentication.`);
  }
  return value;
};

const normalizedEmail = (email: string) => email.trim().toLowerCase();

const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const applicationScope = (rawBaseURL: string) => {
  const url = new URL(rawBaseURL);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
};

const scopedMetadata = (
  baseURL: string,
  email: string,
  tenantLabel: string,
  tenantIdFingerprint: string,
): SessionMetadata => ({
  version: metadataVersion,
  application: applicationScope(baseURL),
  accountFingerprint: fingerprint(normalizedEmail(email)),
  tenantIdFingerprint,
  tenantLabel,
});

const makeAppURL = (baseURL: string, route: "/" | "/login") => {
  const url = new URL(baseURL);
  url.hash = route;
  return url.toString();
};

const localDevelopmentHosts = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "local.worshipsync.net",
]);

const hasFile = async (path: string) =>
  access(path).then(() => true).catch(() => false);

const readSavedMetadata = async (path: string): Promise<SessionMetadata | null> => {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<SessionMetadata>;
    if (
      value.version !== metadataVersion ||
      typeof value.application !== "string" ||
      typeof value.accountFingerprint !== "string" ||
      typeof value.tenantLabel !== "string" ||
      (value.tenantIdFingerprint !== undefined &&
        value.tenantIdFingerprint !== null &&
        typeof value.tenantIdFingerprint !== "string")
    ) {
      return null;
    }
    return value as SessionMetadata;
  } catch {
    return null;
  }
};

const readSavedStorageState = async (path: string): Promise<SavedStorageState | null> => {
  try {
    const saved = JSON.parse(await readFile(path, "utf8")) as SavedStorageState;
    return saved && Array.isArray(saved.cookies) && Array.isArray(saved.origins)
      ? saved
      : null;
  } catch {
    return null;
  }
};

const matchesCookieHost = (domain: string, hostname: string) => {
  const normalizedDomain = domain.replace(/^\./, "").toLowerCase();
  const normalizedHost = hostname.toLowerCase();
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
};

const inspectSavedStorageState = (
  state: SavedStorageState,
  baseURL: string,
  options: { allowMissingOrExpiredServerCookie?: boolean } = {},
): SavedStorageInspection => {
  const hostname = new URL(baseURL).hostname;
  const namedCookies = state.cookies?.filter(
    (candidate) => candidate.name === serverSessionCookieName,
  ) ?? [];
  const cookie = namedCookies.find(
    (candidate) =>
      typeof candidate.value === "string" &&
      candidate.value.length > 0 &&
      typeof candidate.domain === "string" &&
      matchesCookieHost(candidate.domain, hostname),
  );
  if (namedCookies.length > 0 && !cookie) {
    return {
      ok: false,
      reason: "The saved Playwright state does not contain the WorshipSync server session cookie.",
    };
  }
  const hasUsableServerCookie = Boolean(cookie && !(
    typeof cookie.expires === "number" &&
    cookie.expires > 0 &&
    cookie.expires <= Date.now() / 1000
  ));
  if (!hasUsableServerCookie && !options.allowMissingOrExpiredServerCookie) {
    return {
      ok: false,
      reason: cookie
        ? "The saved WorshipSync server session cookie has expired."
        : "The saved Playwright state does not contain the WorshipSync server session cookie.",
    };
  }

  const appOrigin = new URL(baseURL).origin;
  const origin = state.origins?.find((candidate) => candidate.origin === appOrigin);
  if (!origin) {
    return {
      ok: false,
      reason: "The saved Playwright state does not contain the WorshipSync application origin.",
    };
  }

  const deviceIdentity = origin.localStorage?.find(
    (entry) =>
      entry.name === deviceIdentityKey &&
      typeof entry.value === "string" &&
      entry.value.trim().length > 0,
  );
  if (!deviceIdentity) {
    return {
      ok: false,
      reason: "The saved Playwright state does not contain the controller device identity.",
    };
  }

  const hasFirebaseIndexedDB = origin.indexedDB?.some(
    (database) =>
      database.name === firebaseDatabaseName &&
      database.stores?.some(
        (store) =>
          store.name === firebaseStoreName &&
          Boolean(store.records?.length),
      ),
  );
  if (!hasFirebaseIndexedDB) {
    return {
      ok: false,
      reason: "The saved Playwright state does not contain Firebase IndexedDB state.",
    };
  }

  return {
    ok: true,
    cookieValue: hasUsableServerCookie ? cookie?.value as string : null,
    deviceIdentity: deviceIdentity.value as string,
    hasUsableServerCookie,
  };
};

const hasRuntimeFirebaseIndexedDB = async (page: Page) =>
  page.evaluate(async ({ databaseName, storeName }) => {
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    if (!database || !database.objectStoreNames.contains(storeName)) return false;

    const count = await new Promise<number>((resolve) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
    database.close();
    return count > 0;
  }, { databaseName: firebaseDatabaseName, storeName: firebaseStoreName });

const waitForAppAuthenticationState = async (page: Page) => {
  try {
    await expect
      .poll(
        async () => {
          if (
            await page
              .getByRole("heading", { name: "Controllers", exact: true })
              .isVisible()
              .catch(() => false)
          ) {
            return "authenticated";
          }
          if (
            (await page.getByLabel("Email").isVisible().catch(() => false)) ||
            (await page
              .getByRole("heading", { name: "Check your email", exact: true })
              .isVisible()
              .catch(() => false))
          ) {
            return "sign-in";
          }
          return "loading";
        },
        {
          timeout: 45_000,
          message: "WorshipSync did not finish loading authentication state",
        },
      )
      .not.toBe("loading");
  } catch {
    return "unavailable" as const;
  }

  if (
    await page
      .getByRole("heading", { name: "Controllers", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    return "authenticated" as const;
  }
  return "sign-in" as const;
};

const readAuthenticatedIdentity = async (
  page: Page,
  expectedEmail: string,
): Promise<AuthenticatedIdentity | null> => {
  const accountButton = page.getByRole("button", { name: /^Account:/i }).first();
  if (!(await accountButton.isVisible().catch(() => false))) return null;

  await accountButton.click();
  const emailValue = page.getByText(expectedEmail, { exact: true }).first();
  if (!(await emailValue.isVisible().catch(() => false))) return null;

  const churchLabel = page.getByText("Church", { exact: true }).last();
  if (!(await churchLabel.isVisible().catch(() => false))) return null;
  const churchValue = churchLabel.locator("xpath=following-sibling::*[1]");
  const tenantLabel = (await churchValue.textContent().catch(() => ""))?.trim() ?? "";
  if (!tenantLabel || tenantLabel === "—" || tenantLabel === "-") return null;

  return { email: expectedEmail, tenantLabel, tenantIdFingerprint: "" };
};

const captureTenantFingerprint = (page: Page) => {
  let latestBootstrap: Promise<string | null> | null = null;
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (
      !response.ok() ||
      !(
        pathname.endsWith("/api/auth/me") ||
        pathname.endsWith("/api/auth/session") ||
        pathname.endsWith("/api/auth/verify-email-code")
      )
    ) {
      return;
    }
    latestBootstrap = response
      .json()
      .then((payload: unknown) => {
        if (!payload || typeof payload !== "object") return null;
        const outer = payload as Record<string, unknown>;
        const bootstrap =
          outer.bootstrap && typeof outer.bootstrap === "object"
            ? (outer.bootstrap as Record<string, unknown>)
            : outer;
        if (
          bootstrap.authenticated !== true ||
          bootstrap.sessionKind !== "human" ||
          typeof bootstrap.churchId !== "string" ||
          !bootstrap.churchId.trim()
        ) {
          return null;
        }
        return fingerprint(bootstrap.churchId.trim());
      })
      .catch(() => null);
  });
  return async () => (latestBootstrap ? await latestBootstrap : null);
};

const captureInitialServerSession = async (page: Page) => {
  let response;
  try {
    response = await page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname.endsWith("/api/auth/me"),
      { timeout: 45_000 },
    );
  } catch {
    return { status: "unavailable" as const };
  }

  if (!response.ok()) {
    return response.status() === 401 || response.status() === 403
      ? { status: "unauthenticated" as const }
      : { status: "unavailable" as const };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "unavailable" as const };
  }
  if (!payload || typeof payload !== "object") {
    return { status: "unavailable" as const };
  }
  const outer = payload as Record<string, unknown>;
  const bootstrap =
    outer.bootstrap && typeof outer.bootstrap === "object"
      ? (outer.bootstrap as Record<string, unknown>)
      : outer;
  if (
    bootstrap.authenticated !== true ||
    bootstrap.sessionKind !== "human"
  ) {
    return { status: "unauthenticated" as const };
  }
  if (typeof bootstrap.churchId !== "string" || !bootstrap.churchId.trim()) {
    return { status: "unavailable" as const };
  }
  return {
    status: "authenticated" as const,
    tenantIdFingerprint: fingerprint(bootstrap.churchId.trim()),
  };
};

type RecoveryResponse =
  | {
      status: "authenticated";
      tenantIdFingerprint: string;
      email: string;
      deviceId: string;
    }
  | { status: "requires-email-code" }
  | { status: "unavailable" };

const observeSilentSessionRecovery = async (
  page: Page,
  baseURL: string,
  expectedDeviceIdentity: string,
) => {
  const appOrigin = new URL(baseURL).origin;
  let attempts = 0;
  let blockedRequest = false;
  let recoveryResponse: Promise<RecoveryResponse> | null = null;

  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() !== "POST" ||
      new URL(response.url()).origin !== appOrigin ||
      !new URL(response.url()).pathname.endsWith("/api/auth/session")
    ) {
      return;
    }
    recoveryResponse = response
      .json()
      .then((payload: unknown): RecoveryResponse => {
        if (!payload || typeof payload !== "object") return { status: "unavailable" };
        const outer = payload as Record<string, unknown>;
        if (outer.requiresEmailCode === true) {
          return { status: "requires-email-code" };
        }
        const bootstrap =
          outer.bootstrap && typeof outer.bootstrap === "object"
            ? (outer.bootstrap as Record<string, unknown>)
            : outer;
        const user =
          bootstrap.user && typeof bootstrap.user === "object"
            ? (bootstrap.user as Record<string, unknown>)
            : {};
        const device =
          bootstrap.device && typeof bootstrap.device === "object"
            ? (bootstrap.device as Record<string, unknown>)
            : {};
        const email = String(user.primaryEmail || user.email || "").trim();
        const deviceId = String(device.deviceId || "").trim();
        if (
          !response.ok() ||
          bootstrap.authenticated !== true ||
          bootstrap.sessionKind !== "human" ||
          typeof bootstrap.churchId !== "string" ||
          !bootstrap.churchId.trim() ||
          !email ||
          !deviceId
        ) {
          return { status: "unavailable" };
        }
        return {
          status: "authenticated",
          tenantIdFingerprint: fingerprint(bootstrap.churchId.trim()),
          email,
          deviceId,
        };
      })
      .catch(() => ({ status: "unavailable" }));
  });

  await page.route("**/api/auth/**", async (route) => {
    const request = route.request();
    const requestURL = new URL(request.url());
    const pathname = requestURL.pathname;
    if (requestURL.origin !== appOrigin) {
      blockedRequest = true;
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() === "GET") {
      await route.continue();
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/api/auth/session")) {
      attempts += 1;
      let body: Record<string, unknown> = {};
      try {
        body = request.postDataJSON() as Record<string, unknown>;
      } catch {
        // A malformed or missing body is rejected below.
      }
      if (
        attempts !== 1 ||
        body.requestNewCode !== false ||
        typeof body.idToken !== "string" ||
        !body.idToken.trim() ||
        body.deviceId !== expectedDeviceIdentity
      ) {
        blockedRequest = true;
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }

    // These routes can send verification or password recovery email. The
    // ordinary controller setup must never reach them.
    blockedRequest = true;
    await route.abort("blockedbyclient");
  });

  await page.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/accounts:lookup")) {
      await route.continue();
      return;
    }
    // Firebase refreshes a persisted user through securetoken.googleapis.com;
    // every other Identity Toolkit action is outside silent session recovery.
    blockedRequest = true;
    await route.abort("blockedbyclient");
  });

  await page.route("**/securetoken.googleapis.com/**", async (route) => {
    const body = route.request().postData() || "";
    if (route.request().method() === "POST" && /(?:^|&)grant_type=refresh_token(?:&|$)/.test(body)) {
      await route.continue();
      return;
    }
    blockedRequest = true;
    await route.abort("blockedbyclient");
  });

  return {
    attempts: () => attempts,
    hasBlockedRequest: () => blockedRequest,
    response: async () => (recoveryResponse ? recoveryResponse : null),
  };
};

export async function validateSavedSession(
  browser: Browser,
  baseURL: string,
  email: string,
  files: AuthStateFiles = defaultAuthFiles,
): Promise<SessionCheck> {
  if (!(await hasFile(files.authFile))) {
    return { status: "invalid", reason: "The saved Playwright storage-state file is missing." };
  }
  if (!(await hasFile(files.metadataFile))) {
    return {
      status: "invalid",
      reason: "The saved Playwright session metadata file is missing.",
    };
  }

  const storageState = await readSavedStorageState(files.authFile);
  if (!storageState) {
    return {
      status: "invalid",
      reason: "The saved Playwright storage-state file is malformed or unreadable.",
    };
  }
  const storageStateInspection = inspectSavedStorageState(storageState, baseURL, {
    allowMissingOrExpiredServerCookie: true,
  });
  if (!storageStateInspection.ok) {
    return { status: "invalid", reason: storageStateInspection.reason };
  }

  const savedMetadata = await readSavedMetadata(files.metadataFile);
  const expectedMetadata = scopedMetadata(baseURL, email, "", "");
  if (!savedMetadata) {
    return {
      status: "invalid",
      reason: "The saved Playwright session metadata is malformed or unreadable.",
    };
  }
  if (savedMetadata.application !== expectedMetadata.application) {
    return {
      status: "invalid",
      reason: "The saved session belongs to a different WorshipSync application URL.",
    };
  }
  if (savedMetadata.accountFingerprint !== expectedMetadata.accountFingerprint) {
    return {
      status: "invalid",
      reason: "The saved session belongs to a different configured test account.",
    };
  }

  let context;
  try {
    context = await browser.newContext({
      baseURL,
      storageState: files.authFile,
      ignoreHTTPSErrors: localDevelopmentHosts.has(new URL(baseURL).hostname),
    });
  } catch {
    return {
      status: "invalid",
      reason: "Playwright could not restore the saved browser state.",
    };
  }

  try {
    const restoredCookie = (await context.cookies(baseURL)).find(
      (candidate) => candidate.name === serverSessionCookieName,
    );
    if (
      storageStateInspection.hasUsableServerCookie &&
      (!restoredCookie || restoredCookie.value !== storageStateInspection.cookieValue)
    ) {
      return {
        status: "invalid",
        reason: "Playwright did not restore the saved WorshipSync server session cookie.",
      };
    }

    const page = await context.newPage();
    const initialServerSessionPromise = captureInitialServerSession(page);
    const getTenantFingerprint = captureTenantFingerprint(page);
    const recovery = await observeSilentSessionRecovery(
      page,
      baseURL,
      storageStateInspection.deviceIdentity,
    );
    try {
      await page.goto(makeAppURL(baseURL, "/"), { waitUntil: "domcontentloaded" });
    } catch {
      return {
        status: "infrastructure-error",
        reason: "Could not reach E2E_BASE_URL while checking the saved session.",
      };
    }

    const restoredDeviceIdentity = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      deviceIdentityKey,
    ).catch(() => null);
    if (restoredDeviceIdentity !== storageStateInspection.deviceIdentity) {
      return {
        status: "invalid",
        reason: "Playwright did not restore the saved controller device identity.",
      };
    }

    const initialServerSession = await initialServerSessionPromise;
    if (initialServerSession.status === "unavailable") {
      return {
        status: "infrastructure-error",
        reason: "WorshipSync returned an unreadable auth bootstrap while checking the saved server session cookie.",
      };
    }
    const authState = await waitForAppAuthenticationState(page);
    if (authState === "unavailable") {
      return {
        status: "infrastructure-error",
        reason: "WorshipSync did not finish loading while checking the saved session.",
      };
    }
    const recoveryResult = await recovery.response();
    if (recovery.attempts() > 0 && recoveryResult?.status === "requires-email-code") {
      return {
        status: "invalid",
        reason: "Silent server-session recovery requires email verification; use the explicit authentication refresh command.",
      };
    }
    if (recovery.hasBlockedRequest()) {
      return {
        status: "invalid",
        reason: "WorshipSync attempted an authentication request outside silent server-session recovery.",
      };
    }
    if (authState !== "authenticated") {
      return {
        status: "invalid",
        reason:
          recovery.attempts() > 0
            ? "WorshipSync could not restore the server session silently from the saved Firebase authentication state."
            : "WorshipSync did not recognize the saved session.",
      };
    }
    if (
      initialServerSession.status === "unauthenticated" &&
      recovery.attempts() === 0
    ) {
      return {
        status: "invalid",
        reason: "WorshipSync rejected the saved server session cookie and did not attempt silent recovery.",
      };
    }
    if (
      recovery.attempts() > 0 &&
      (recovery.attempts() !== 1 || recoveryResult?.status !== "authenticated")
    ) {
      return {
        status: "invalid",
        reason: "WorshipSync could not validate the silent server-session recovery response.",
      };
    }
    if (!(await hasRuntimeFirebaseIndexedDB(page).catch(() => false))) {
      return {
        status: "invalid",
        reason: "Playwright did not restore the saved Firebase IndexedDB state.",
      };
    }

    const accountIdentity = await readAuthenticatedIdentity(page, email);
    if (!accountIdentity) {
      return {
        status: "invalid",
        reason: "WorshipSync did not recognize the configured test account.",
      };
    }
    const tenantIdFingerprint = await getTenantFingerprint();
    if (!tenantIdFingerprint) {
      return {
        status: "invalid",
        reason: "WorshipSync did not return an authenticated tenant identity.",
      };
    }
    if (
      initialServerSession.status === "authenticated" &&
      tenantIdFingerprint !== initialServerSession.tenantIdFingerprint
    ) {
      return {
        status: "invalid",
        reason: "The saved server session and application bootstrap opened different WorshipSync tenants.",
      };
    }
    if (recoveryResult?.status === "authenticated") {
      if (normalizedEmail(recoveryResult.email) !== normalizedEmail(email)) {
        return {
          status: "invalid",
          reason: "Silent server-session recovery authenticated a different configured test account.",
        };
      }
      if (recoveryResult.deviceId !== storageStateInspection.deviceIdentity) {
        return {
          status: "invalid",
          reason: "Silent server-session recovery returned a different controller device identity.",
        };
      }
      if (tenantIdFingerprint !== recoveryResult.tenantIdFingerprint) {
        return {
          status: "invalid",
          reason: "The recovered server session and application bootstrap opened different WorshipSync tenants.",
        };
      }
      if (
        savedMetadata.tenantIdFingerprint &&
        recoveryResult.tenantIdFingerprint !== savedMetadata.tenantIdFingerprint
      ) {
        return {
          status: "invalid",
          reason: "Silent server-session recovery opened a different WorshipSync tenant.",
        };
      }
    }
    const identity = { ...accountIdentity, tenantIdFingerprint };
    if (
      identity.tenantLabel !== savedMetadata.tenantLabel ||
      (savedMetadata.tenantIdFingerprint &&
        identity.tenantIdFingerprint !== savedMetadata.tenantIdFingerprint)
    ) {
      return {
        status: "invalid",
        reason: "The saved session opened a different WorshipSync tenant.",
      };
    }
    try {
      await saveAuthenticatedSession(page, baseURL, identity, files);
    } catch {
      return {
        status: "infrastructure-error",
        reason: "Could not update the protected Playwright auth state after validating the saved session.",
      };
    }
    return { status: "valid", identity };
  } finally {
    await context.close();
  }
}

export function requireReusableSavedSession(session: SessionCheck) {
  if (session.status === "valid") {
    console.info("Reusing existing authenticated WorshipSync session.");
    return session.identity;
  }

  const reason =
    session.status === "invalid"
      ? `Saved session cannot be reused: ${session.reason}`
      : `Saved session validation could not complete: ${session.reason}`;
  const message = `${reason} No password sign-in or verification email was attempted. To explicitly refresh authentication with one attempt, run npm run test:e2e:auth:refresh.`;
  console.error(message);
  throw new Error(message);
}

export async function performRealPasswordSignIn(page: Page, baseURL: string) {
  const email = requiredEnv("E2E_TEST_EMAIL");
  const password = requiredEnv("E2E_TEST_PASSWORD");
  const getTenantFingerprint = captureTenantFingerprint(page);
  await page.goto(makeAppURL(baseURL, "/login"), { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Email")).toBeVisible();
  const signInButton = page.getByRole("button", { name: "Sign in", exact: true });

  await expect
    .poll(
      async () => {
        if (await signInButton.isEnabled().catch(() => false)) return "online";
        const status = await page.getByRole("status").allTextContents().catch(() => []);
        if (status.some((text) => /could not reach the sign-in service/i.test(text))) {
          return "offline";
        }
        return "checking";
      },
      {
        timeout: 30_000,
        message: "WorshipSync authentication service did not become available",
      },
    )
    .not.toBe("checking");

  if (!(await signInButton.isEnabled().catch(() => false))) {
    throw new Error(
      "Authentication infrastructure unavailable: WorshipSync reports that its sign-in service cannot be reached. No credentials were submitted.",
    );
  }

  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password:" }).fill(password);
  const emailRequestedSince = new Date().toISOString();
  await signInButton.click();

  const codeHeading = page.getByRole("heading", {
    name: "Check your email",
    exact: true,
  });
  const homeHeading = page.getByRole("heading", {
    name: "Controllers",
    exact: true,
  });
  const authError = page.getByRole("alert").first();
  await expect
    .poll(
      async () => {
        if (await codeHeading.isVisible().catch(() => false)) return "code";
        if (await homeHeading.isVisible().catch(() => false)) return "signed-in";
        if (await authError.isVisible().catch(() => false)) return "error";
        const status = await page.getByRole("status").allTextContents().catch(() => []);
        if (status.some((text) => /could not reach the sign-in service/i.test(text))) {
          return "infrastructure";
        }
        return "pending";
      },
      {
        timeout: 60_000,
        message: "WorshipSync did not reach a sign-in result",
      },
    )
    .not.toBe("pending");

  const statusMessages = await page.getByRole("status").allTextContents().catch(() => []);
  if (statusMessages.some((text) => /could not reach the sign-in service/i.test(text))) {
    throw new Error(
      "Authentication infrastructure unavailable: WorshipSync reports that its sign-in service cannot be reached.",
    );
  }
  if (await authError.isVisible().catch(() => false)) {
    throw new Error(
      "WorshipSync rejected the configured test account (visible alert text is omitted from the report).",
    );
  }

  if (await codeHeading.isVisible().catch(() => false)) {
    console.info("WorshipSync requires email verification; retrieving one code from MailSlurp.");
    const code = await fetchFreshSignInCode(emailRequestedSince, email);
    await page.getByLabel("Digit 1 of 6").fill(code);
    await expect(homeHeading).toBeVisible({ timeout: 45_000 });
    const tenantIdFingerprint = await getTenantFingerprint();
    if (!tenantIdFingerprint) {
      throw new Error("WorshipSync signed in but did not return an authenticated tenant identity.");
    }
    return { email, usedEmailVerification: true, tenantIdFingerprint };
  }

  const tenantIdFingerprint = await getTenantFingerprint();
  if (!tenantIdFingerprint) {
    throw new Error("WorshipSync signed in but did not return an authenticated tenant identity.");
  }
  return { email, usedEmailVerification: false, tenantIdFingerprint };
}

async function fetchFreshSignInCode(since: string, expectedEmail: string) {
  const inboxId = requiredEnv("MAILSLURP_INBOX_ID");
  const apiKey = requiredEnv("MAILSLURP_API_KEY");
  const url = new URL("https://api.mailslurp.com/waitForLatestEmail");
  url.searchParams.set("inboxId", inboxId);
  url.searchParams.set("since", since);
  url.searchParams.set("sort", "ASC");
  url.searchParams.set("timeout", "90000");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(95_000),
    });
  } catch {
    throw new Error("MailSlurp could not be reached while waiting for the new sign-in email.");
  }
  if (!response.ok) {
    throw new Error(`MailSlurp did not return the new sign-in email (HTTP ${response.status}).`);
  }

  const email = (await response.json()) as {
    subject?: string;
    to?: string[];
    body?: string;
  };
  if (email.subject !== "Your WorshipSync sign-in code") {
    throw new Error("MailSlurp returned a new email, but it was not a WorshipSync sign-in code email.");
  }
  if (!email.to?.some((recipient) => normalizedEmail(recipient) === normalizedEmail(expectedEmail))) {
    throw new Error("The new WorshipSync sign-in email was not addressed to E2E_TEST_EMAIL.");
  }

  const body = String(email.body ?? "").replace(/<[^>]*>/g, " ");
  const codeMatches = [
    ...body.matchAll(/(?:sign-in code is\s*|[?&]code=|&amp;code=)(\d{6})/gi),
  ];
  const codes = [...new Set(codeMatches.map((match) => match[1]))];
  if (codes.length !== 1) {
    throw new Error("The new WorshipSync email did not contain one unambiguous six-digit sign-in code.");
  }
  return codes[0];
}

export async function saveAuthenticatedSession(
  page: Page,
  baseURL: string,
  identity: AuthenticatedIdentity,
  files: AuthStateFiles = defaultAuthFiles,
) {
  await mkdir(dirname(files.authFile), { recursive: true, mode: 0o700 });
  const storageState = await page.context().storageState({ indexedDB: true });
  const storageStateInspection = inspectSavedStorageState(storageState, baseURL);
  if (!storageStateInspection.ok) {
    throw new Error(`Cannot save an incomplete authenticated session: ${storageStateInspection.reason}`);
  }
  await writeFile(files.authFile, JSON.stringify(storageState, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(files.authFile, 0o600);
  await writeSessionMetadata(baseURL, identity, files.metadataFile);
}

async function writeSessionMetadata(
  baseURL: string,
  identity: AuthenticatedIdentity,
  path: string,
) {
  const metadata = scopedMetadata(
    baseURL,
    identity.email,
    identity.tenantLabel,
    identity.tenantIdFingerprint,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(metadata, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

export async function verifyAuthenticatedIdentity(
  page: Page,
  expectedEmail: string,
  tenantIdFingerprint: string,
): Promise<AuthenticatedIdentity> {
  await expect(page.getByRole("heading", { name: "Controllers", exact: true })).toBeVisible({
    timeout: 45_000,
  });
  const identity = await readAuthenticatedIdentity(page, expectedEmail);
  if (!identity) {
    throw new Error(
      "WorshipSync loaded, but the authenticated account or tenant did not match the E2E configuration.",
    );
  }
  return { ...identity, tenantIdFingerprint };
}

export async function getE2EAuthConfig() {
  const baseURL = requiredEnv("E2E_BASE_URL");
  const email = requiredEnv("E2E_TEST_EMAIL");
  return { baseURL, email };
}
