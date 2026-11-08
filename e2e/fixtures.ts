import { test as base, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import {
  allowedE2EAuthOrigins,
  isObservedSharedDataSignIn,
  isTrustedFirebaseAuthOrigin,
} from "./authOrigins";
import {
  authorizeSilentSessionRequest,
  readSavedE2EDeviceIdentity,
  type AuthRecoveryDiagnostic,
} from "./authRequestPolicy";
import { redactControllerDiagnosticText } from "./controllerRuntime";

type BrowserDiagnostic = {
  kind: "console_error" | "page_error" | "request_failed" | "http_error";
  source?: "app" | "external";
  message?: string;
  method?: string;
  url?: string;
  resourceType?: string;
  status?: number;
};

const redact = (value: string) => {
  let safe = value;
  for (const secret of [
    process.env.E2E_TEST_PASSWORD,
    process.env.MAILSLURP_API_KEY,
  ]) {
    if (secret) safe = safe.split(secret).join("[redacted]");
  }
  if (process.env.E2E_TEST_EMAIL) {
    safe = safe
      .split(process.env.E2E_TEST_EMAIL)
      .join("[redacted-email]");
  }
  safe = safe
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{6}\b/g, "[redacted-code]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{5,})?\b/g, "[redacted-token]")
    .replace(/((?:id[_-]?token|access[_-]?token|refresh[_-]?token|auth[_-]?token|firebase[_-]?token|token|cookie|password|credential|private[_-]?key|api[_-]?key|firebaseUid|churchId|userId)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^,\s;}]+)/gi, "$1[redacted]")
    .replace(/((?:one[- ]?time|verification|authentication|auth|login|sign[- ]?in|email|sms|2fa|mfa)?\s*(?:verification\s+)?(?:code|passcode|otp)\s*[=:]\s*)(?:"?\d{4,8}"?)/gi, "$1[redacted-code]")
    .replace(/churches\/[^/\s,"'}]+/gi, "churches/[redacted]")
    .replace(/https?:\/\/[^\s"']+/gi, (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    });
  return redactControllerDiagnosticText(safe).slice(0, 1_000);
};

const safeUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    const knownAuthPaths = [
      "/api/auth/me",
      "/api/auth/session",
      "/api/auth/shared-data-token",
    ];
    const pathname = url.pathname.startsWith("/api/auth/") && !knownAuthPaths.includes(url.pathname)
      ? "/api/auth/[other]"
      : url.pathname;
    return redact(`${url.origin}${pathname}`);
  } catch {
    return "[unavailable-url]";
  }
};

const sourceFor = (rawUrl: string): "app" | "external" => {
  try {
    const appOrigin = process.env.E2E_BASE_URL
      ? new URL(process.env.E2E_BASE_URL).origin
      : "";
    return new URL(rawUrl).origin === appOrigin ? "app" : "external";
  } catch {
    return "external";
  }
};

const clearAuthenticationInputs = async (page: Page) => {
  await page
    .locator(
      'input[type="email"], input[name="email" i], input[autocomplete="username"], input[type="password"], input[autocomplete="current-password"]',
    )
    .evaluateAll((inputs) => {
      for (const input of inputs) {
        (input as HTMLInputElement).value = "";
      }
    })
    .catch(() => undefined);
};

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const diagnostics: BrowserDiagnostic[] = [];
    const blockedUnsafeAuthRequests: { count: number } = { count: 0 };
    const blockedEmailGeneratingAuthRequests: { count: number } = { count: 0 };
    const blockedMailSlurpRequests: { count: number } = { count: 0 };
    const blockedUntrustedAuthRequests: { count: number } = { count: 0 };
    const blockedFirebaseAuthActions: { count: number } = { count: 0 };
    const authRecoveryDiagnostics: AuthRecoveryDiagnostic[] = [];

    if (["chromium", "smoke", "scheduling"].includes(testInfo.project.name)) {
      const baseURL = process.env.E2E_BASE_URL;
      const trustedAuthOrigins = baseURL
        ? allowedE2EAuthOrigins(baseURL)
        : new Set<string>();
      const savedDeviceIdentity = baseURL
        ? readSavedE2EDeviceIdentity(await page.context().storageState(), baseURL)
        : null;
      let safeSessionRenewals = 0;
      const sharedDataTokens: Promise<string>[] = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          response.ok() &&
          response.request().method() === "GET" &&
          trustedAuthOrigins.has(url.origin) &&
          url.pathname === "/api/auth/shared-data-token"
        ) {
          sharedDataTokens.push(
            response.json()
              .then((payload) => typeof payload.token === "string" ? payload.token : "")
              .catch(() => ""),
          );
        }
      });
      await page.route(/\/api\/auth(?:\/|$)/, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (!trustedAuthOrigins.has(url.origin)) {
          blockedUntrustedAuthRequests.count += 1;
          authRecoveryDiagnostics.push({
            method: request.method(),
            path: url.pathname === "/api/auth/session" ? url.pathname : "/api/auth/[other]",
            status: null,
            outcome: "blocked_untrusted_origin",
          });
          await route.abort("blockedbyclient");
          return;
        }
        if (request.method() === "GET") {
          await route.fallback();
          return;
        }

        let body: unknown;
        try {
          body = request.postDataJSON();
        } catch {
          // An unreadable authentication request is unsafe.
        }
        const decision = authorizeSilentSessionRequest({
          method: request.method(),
          url: request.url(),
          body,
          trustedOrigins: trustedAuthOrigins,
          expectedDeviceIdentity: savedDeviceIdentity,
        });
        if (decision.allowed && safeSessionRenewals === 0) {
          safeSessionRenewals++;
          authRecoveryDiagnostics.push({
            method: request.method(),
            path: "/api/auth/session",
            status: null,
            outcome: "safely_allowed",
          });
          await route.fallback();
          return;
        }

        if (url.pathname === "/api/auth/session") {
          const bodyRecord = body && typeof body === "object"
            ? body as Record<string, unknown>
            : {};
          if (bodyRecord.requestNewCode !== false) {
            blockedEmailGeneratingAuthRequests.count += 1;
          }
          blockedUnsafeAuthRequests.count += 1;
          authRecoveryDiagnostics.push({
            method: request.method(),
            path: "/api/auth/session",
            status: null,
            outcome: "blocked_unsafe_request",
          });
        } else {
          blockedUnsafeAuthRequests.count += 1;
          blockedEmailGeneratingAuthRequests.count += 1;
        }
        await route.abort("blockedbyclient");
      });

      await page.route("**/identitytoolkit.googleapis.com/**", async (route) => {
        const request = route.request();
        const requestURL = new URL(request.url());
        const pathname = requestURL.pathname;
        if (
          isTrustedFirebaseAuthOrigin(request.url(), "identitytoolkit") &&
          request.method() === "POST" &&
          pathname === "/v1/accounts:lookup"
        ) {
          await route.fallback();
          return;
        }
        let body: unknown;
        try { body = request.postDataJSON(); } catch { /* fail closed */ }
        if (
          isTrustedFirebaseAuthOrigin(request.url(), "identitytoolkit") &&
          request.method() === "POST" &&
          isObservedSharedDataSignIn(
            pathname,
            body,
            (await Promise.all(sharedDataTokens)).filter(Boolean),
          )
        ) {
          await route.fallback();
          return;
        }
        blockedFirebaseAuthActions.count += 1;
        await route.abort("blockedbyclient");
      });

      await page.route("**/securetoken.googleapis.com/**", async (route) => {
        const requestURL = new URL(route.request().url());
        const requestBody = route.request().postData() || "";
        if (
          isTrustedFirebaseAuthOrigin(route.request().url(), "securetoken") &&
          route.request().method() === "POST" &&
          requestURL.pathname === "/v1/token" &&
          /(?:^|&)grant_type=refresh_token(?:&|$)/.test(requestBody)
        ) {
          await route.fallback();
          return;
        }
        blockedFirebaseAuthActions.count += 1;
        await route.abort("blockedbyclient");
      });

      await page.route(/mailslurp\.com/i, async (route) => {
        blockedMailSlurpRequests.count += 1;
        await route.abort("blockedbyclient");
      });
    }

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/auth/")) return;
      authRecoveryDiagnostics.push({
        method: request.method(),
        path: ["/api/auth/me", "/api/auth/session", "/api/auth/shared-data-token"].includes(url.pathname)
          ? url.pathname
          : "/api/auth/[other]",
        status: null,
        outcome: request.method() === "POST" && url.pathname === "/api/auth/session"
          ? "attempted"
          : "requested",
      });
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/api/auth/")) return;
      authRecoveryDiagnostics.push({
        method: response.request().method(),
        path: ["/api/auth/me", "/api/auth/session", "/api/auth/shared-data-token"].includes(url.pathname)
          ? url.pathname
          : "/api/auth/[other]",
        status: response.status(),
        outcome: response.headers()["x-e2e-auth-recovery-outcome"] || "response",
      });
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/auth/")) return;
      authRecoveryDiagnostics.push({
        method: request.method(),
        path: url.pathname === "/api/auth/session" ? url.pathname : "/api/auth/[other]",
        status: null,
        outcome: request.failure()?.errorText?.includes("BLOCKED_BY_CLIENT")
          ? "blocked_unsafe_request"
          : "network_error",
      });
    });

    page.on("console", (message) => {
      if (message.type() === "error") {
        diagnostics.push({
          kind: "console_error",
          message: redact(message.text()),
        });
      }
    });
    page.on("pageerror", (error) => {
      diagnostics.push({
        kind: "page_error",
        message: redact(error.message),
      });
    });
    page.on("requestfailed", (request) => {
      diagnostics.push({
        kind: "request_failed",
        source: sourceFor(request.url()),
        method: request.method(),
        url: safeUrl(request.url()),
        resourceType: request.resourceType(),
        message: redact(request.failure()?.errorText ?? "Request failed"),
      });
    });
    page.on("response", (response) => {
      const request = response.request();
      if (
        response.status() < 400 ||
        !["document", "fetch", "xhr"].includes(request.resourceType())
      ) {
        return;
      }
      diagnostics.push({
        kind: "http_error",
        source: sourceFor(response.url()),
        method: request.method(),
        url: safeUrl(response.url()),
        resourceType: request.resourceType(),
        status: response.status(),
      });
    });

    let testFailure: unknown;
    try {
      await use(page);
    } catch (error) {
      testFailure = error;
      await clearAuthenticationInputs(page);
    } finally {
      await clearAuthenticationInputs(page);
      const report = JSON.stringify(
        {
          blockedEmailGeneratingAuthRequests: blockedEmailGeneratingAuthRequests.count,
          blockedUnsafeAuthRequests: blockedUnsafeAuthRequests.count,
          blockedMailSlurpRequests: blockedMailSlurpRequests.count,
          blockedUntrustedAuthRequests: blockedUntrustedAuthRequests.count,
          blockedFirebaseAuthActions: blockedFirebaseAuthActions.count,
          authRecoveryDiagnostics,
          diagnostics,
        },
        null,
        2,
      );
      await writeFile(testInfo.outputPath("browser-diagnostics.json"), report);
      await testInfo.attach("browser-diagnostics.json", {
        body: Buffer.from(report),
        contentType: "application/json",
      });
    }

    if (
      !testFailure &&
      (blockedUnsafeAuthRequests.count > 0 ||
        blockedEmailGeneratingAuthRequests.count > 0 ||
        blockedMailSlurpRequests.count > 0 ||
        blockedUntrustedAuthRequests.count > 0 ||
        blockedFirebaseAuthActions.count > 0)
    ) {
      throw new Error(
        `The browser test safety guard blocked ${blockedUnsafeAuthRequests.count} unsafe auth POST(s) (${blockedEmailGeneratingAuthRequests.count} could generate email), ${blockedMailSlurpRequests.count} MailSlurp request(s), ${blockedUntrustedAuthRequests.count} untrusted auth request(s), and ${blockedFirebaseAuthActions.count} unapproved Firebase auth action(s). See sanitized browser-diagnostics.json.`,
      );
    }
    if (testFailure) throw testFailure;
  },
});

export { expect } from "@playwright/test";
