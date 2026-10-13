import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";

const authFile = resolve("playwright/.auth/worshipsync-user.json");
const metadataFile = resolve("playwright/.auth/worshipsync-user.meta.json");
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

type SessionCheck =
  | { status: "valid"; identity: AuthenticatedIdentity }
  | { status: "invalid"; reason: string }
  | { status: "infrastructure-error"; reason: string };

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

const readSavedMetadata = async (): Promise<SessionMetadata | null> => {
  try {
    const value = JSON.parse(await readFile(metadataFile, "utf8")) as Partial<SessionMetadata>;
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

const hasFirebaseIndexedDB = async (baseURL: string) => {
  try {
    const saved = JSON.parse(await readFile(authFile, "utf8")) as {
      origins?: Array<{
        origin: string;
        indexedDB?: Array<{
          name: string;
          stores?: Array<{ name: string; records?: unknown[] }>;
        }>;
      }>;
    };
    const appOrigin = new URL(baseURL).origin;
    return (
      saved.origins?.some(
        (origin) =>
          origin.origin === appOrigin &&
          origin.indexedDB?.some(
            (database) =>
              database.name === "firebaseLocalStorageDb" &&
              database.stores?.some(
                (store) =>
                  store.name === "firebaseLocalStorage" &&
                  Boolean(store.records?.length),
              ),
          ),
      ) ?? false
    );
  } catch {
    return false;
  }
};

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

export async function validateSavedSession(
  browser: Browser,
  baseURL: string,
  email: string,
): Promise<SessionCheck> {
  if (!(await hasFile(authFile)) || !(await hasFile(metadataFile))) {
    return { status: "invalid", reason: "No saved authenticated session exists." };
  }
  if (!(await hasFirebaseIndexedDB(baseURL))) {
    return {
      status: "invalid",
      reason: "The saved session does not contain Firebase IndexedDB state.",
    };
  }

  const savedMetadata = await readSavedMetadata();
  const expectedMetadata = scopedMetadata(baseURL, email, "", "");
  if (
    !savedMetadata ||
    savedMetadata.application !== expectedMetadata.application ||
    savedMetadata.accountFingerprint !== expectedMetadata.accountFingerprint
  ) {
    return {
      status: "invalid",
      reason: "The saved session belongs to a different application, account, or tenant scope.",
    };
  }

  let context;
  try {
    context = await browser.newContext({
      baseURL,
      storageState: authFile,
      ignoreHTTPSErrors: localDevelopmentHosts.has(new URL(baseURL).hostname),
    });
  } catch {
    return {
      status: "invalid",
      reason: "The saved browser state could not be restored.",
    };
  }

  try {
    const page = await context.newPage();
    const getTenantFingerprint = captureTenantFingerprint(page);
    try {
      await page.goto(makeAppURL(baseURL, "/"), { waitUntil: "domcontentloaded" });
    } catch {
      return {
        status: "infrastructure-error",
        reason: "Could not reach E2E_BASE_URL while checking the saved session.",
      };
    }

    const authState = await waitForAppAuthenticationState(page);
    if (authState === "unavailable") {
      return {
        status: "infrastructure-error",
        reason: "WorshipSync did not finish loading while checking the saved session.",
      };
    }
    if (authState !== "authenticated") {
      return {
        status: "invalid",
        reason: "WorshipSync did not recognize the saved session.",
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
    if (!savedMetadata.tenantIdFingerprint) {
      await writeSessionMetadata(baseURL, identity);
    }
    return { status: "valid", identity };
  } finally {
    await context.close();
  }
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
) {
  await mkdir(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile, indexedDB: true });
  await writeSessionMetadata(baseURL, identity);
}

async function writeSessionMetadata(
  baseURL: string,
  identity: AuthenticatedIdentity,
) {
  const metadata = scopedMetadata(
    baseURL,
    identity.email,
    identity.tenantLabel,
    identity.tenantIdFingerprint,
  );
  await mkdir(dirname(metadataFile), { recursive: true });
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
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

export const forceFreshAuthentication =
  process.env.E2E_FORCE_FRESH_AUTH === "1";
