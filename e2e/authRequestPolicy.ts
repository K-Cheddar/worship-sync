import { request as playwrightRequest } from "@playwright/test";
import type { APIResponse, BrowserContext } from "@playwright/test";
import { allowedE2EAuthOrigins, shouldIgnoreE2EHTTPSErrors } from "./authOrigins";

const deviceIdentityKey = "worshipsync_device_id";
const silentSessionPath = "/api/auth/session";
const allowedSessionFields = new Set([
  "idToken",
  "deviceId",
  "userAgent",
  "platform",
  "deviceLabel",
  "requestNewCode",
]);

export function isMailSlurpRequest(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === "mailslurp.com" || hostname.endsWith(".mailslurp.com");
  } catch {
    return false;
  }
}

type SessionStorageState = {
  origins?: Array<{
    origin?: string;
    localStorage?: Array<{ name?: string; value?: string }>;
  }>;
};

export function readSavedE2EDeviceIdentity(
  state: unknown,
  baseURL: string,
): string | null {
  if (!state || typeof state !== "object") return null;
  const savedState = state as SessionStorageState;
  const appOrigin = new URL(baseURL).origin;
  const origin = savedState.origins?.find(
    (candidate) => candidate.origin === appOrigin,
  );
  const identity = origin?.localStorage?.find(
    (entry) => entry.name === deviceIdentityKey,
  )?.value;
  return typeof identity === "string" && identity.trim()
    ? identity
    : null;
}

export type SilentSessionRequestInput = {
  method: string;
  url: string;
  body: unknown;
  trustedOrigins: Set<string>;
  expectedDeviceIdentity: string | null;
};

export type SilentSessionRequestDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "untrusted_origin"
        | "wrong_method_or_endpoint"
        | "missing_saved_device_identity"
        | "malformed_body"
        | "unexpected_body_field"
        | "missing_id_token"
        | "wrong_device_identity"
        | "email_code_not_explicitly_disabled";
    };

export function authorizeSilentSessionRequest({
  method,
  url: rawUrl,
  body,
  trustedOrigins,
  expectedDeviceIdentity,
}: SilentSessionRequestInput): SilentSessionRequestDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "untrusted_origin" };
  }
  if (!trustedOrigins.has(url.origin)) {
    return { allowed: false, reason: "untrusted_origin" };
  }
  if (method !== "POST" || url.pathname !== silentSessionPath) {
    return { allowed: false, reason: "wrong_method_or_endpoint" };
  }
  if (!expectedDeviceIdentity?.trim()) {
    return { allowed: false, reason: "missing_saved_device_identity" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { allowed: false, reason: "malformed_body" };
  }

  const requestBody = body as Record<string, unknown>;
  if (Object.keys(requestBody).some((key) => !allowedSessionFields.has(key))) {
    return { allowed: false, reason: "unexpected_body_field" };
  }
  if (requestBody.requestNewCode !== false) {
    return {
      allowed: false,
      reason: "email_code_not_explicitly_disabled",
    };
  }
  if (typeof requestBody.idToken !== "string" || !requestBody.idToken.trim()) {
    return { allowed: false, reason: "missing_id_token" };
  }
  if (requestBody.deviceId !== expectedDeviceIdentity) {
    return { allowed: false, reason: "wrong_device_identity" };
  }
  return { allowed: true };
}

export type SmokeRecoveryOutcome =
  | "authenticated"
  | "email_verification_required"
  | "server_rejected"
  | "wrong_account"
  | "wrong_tenant"
  | "invalid_authenticated_session";

export function classifySmokeRecoveryResponse(
  status: number,
  payload: unknown,
  expectedEmail: string,
  expectedChurchId: string,
): SmokeRecoveryOutcome {
  if (!payload || typeof payload !== "object") return "server_rejected";
  const outer = payload as Record<string, unknown>;
  if (outer.requiresEmailCode === true) return "email_verification_required";
  if (status < 200 || status >= 300) return "server_rejected";

  const bootstrap = outer.bootstrap && typeof outer.bootstrap === "object"
    ? outer.bootstrap as Record<string, unknown>
    : outer;
  const user = bootstrap.user && typeof bootstrap.user === "object"
    ? bootstrap.user as Record<string, unknown>
    : {};
  const device = bootstrap.device && typeof bootstrap.device === "object"
    ? bootstrap.device as Record<string, unknown>
    : {};
  const email = String(user.primaryEmail || user.email || "").trim();
  if (!email) return "invalid_authenticated_session";
  if (email.toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    return "wrong_account";
  }
  if (bootstrap.churchId !== expectedChurchId) return "wrong_tenant";
  if (
    bootstrap.authenticated !== true ||
    bootstrap.sessionKind !== "human" ||
    typeof device.deviceId !== "string" ||
    !device.deviceId.trim()
  ) {
    return "invalid_authenticated_session";
  }
  return "authenticated";
}

export type AuthRecoveryDiagnostic = {
  method: string;
  path: string;
  status: number | null;
  outcome: string;
};

export async function installSavedSessionAuthRequestGuard(
  context: BrowserContext,
  baseURL: string,
  smokeIdentity?: { email: string; churchId: string },
) {
  const trustedOrigins = allowedE2EAuthOrigins(baseURL);
  const expectedDeviceIdentity = readSavedE2EDeviceIdentity(
    await context.storageState(),
    baseURL,
  );
  let blockedRequests = 0;
  let recoveryAttempts = 0;
  const recoveryDiagnostics: AuthRecoveryDiagnostic[] = [];
  const isolatedRecoveryRequest = smokeIdentity
    ? await playwrightRequest.newContext({
        ignoreHTTPSErrors: shouldIgnoreE2EHTTPSErrors(baseURL),
      })
    : undefined;

  await context.route(/\/api\/auth(?:\/|$)|mailslurp\.com/i, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isMailSlurp = isMailSlurpRequest(request.url());
    if (isMailSlurp || !trustedOrigins.has(url.origin)) {
      blockedRequests++;
      recoveryDiagnostics.push({
        method: request.method(),
        path: isMailSlurp
          ? "/[external]"
          : url.pathname === silentSessionPath
            ? silentSessionPath
            : "/api/auth/[other]",
        status: null,
        outcome: isMailSlurp ? "blocked_mailslurp" : "blocked_untrusted_origin",
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
      // Unreadable authentication requests fail closed.
    }
    const decision = authorizeSilentSessionRequest({
      method: request.method(),
      url: request.url(),
      body,
      trustedOrigins,
      expectedDeviceIdentity,
    });
    if (!decision.allowed || recoveryAttempts >= 1) {
      blockedRequests++;
      recoveryDiagnostics.push({
        method: request.method(),
        path: url.pathname === silentSessionPath
          ? silentSessionPath
          : "/api/auth/[other]",
        status: null,
        outcome: "blocked_unsafe_request",
      });
      await route.abort("blockedbyclient");
      return;
    }
    recoveryAttempts++;

    if (!smokeIdentity) {
      await route.fallback();
      return;
    }

    let response: APIResponse;
    let payload: unknown;
    let responseBody = "";
    try {
      if (!isolatedRecoveryRequest) throw new Error("Isolated recovery is unavailable.");
      const requestHeaders = await request.allHeaders();
      const headers = { ...requestHeaders };
      for (const header of [
        "host",
        "cookie",
        "content-length",
        "connection",
        "accept-encoding",
        "transfer-encoding",
      ]) delete headers[header];
      response = await isolatedRecoveryRequest.post(request.url(), {
        headers,
        data: request.postData() || "",
      });
      responseBody = await response.text();
      try { payload = JSON.parse(responseBody); } catch { payload = null; }
    } catch {
      recoveryDiagnostics.push({
        method: request.method(),
        path: silentSessionPath,
        status: null,
        outcome: "network_error",
      });
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        headers: { "x-e2e-auth-recovery-outcome": "network_error" },
        body: JSON.stringify({
          success: false,
          errorMessage: "Saved E2E session recovery could not reach the server.",
        }),
      });
      return;
    }

    let outcome = classifySmokeRecoveryResponse(
      response.status(),
      payload,
      smokeIdentity.email,
      smokeIdentity.churchId,
    );
    const responseUrl = new URL(request.url());
    const approvedSessionCookies = (await isolatedRecoveryRequest!.cookies(request.url()))
      .filter((cookie) =>
        cookie.name === "worshipsync_sid" &&
        cookie.domain.replace(/^\./, "").toLowerCase() === responseUrl.hostname.toLowerCase(),
      );
    if (outcome === "authenticated" && approvedSessionCookies.length === 0) {
      outcome = "invalid_authenticated_session";
    }
    recoveryDiagnostics.push({
      method: request.method(),
      path: silentSessionPath,
      status: response.status(),
      outcome,
    });
    if (outcome === "authenticated") {
      await context.addCookies(approvedSessionCookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: responseUrl.hostname,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })));
      const headers = await response.headers();
      delete headers["set-cookie"];
      delete headers["content-length"];
      delete headers["content-encoding"];
      await route.fulfill({
        headers: {
          ...headers,
          "x-e2e-auth-recovery-outcome": outcome,
        },
        status: response.status(),
        body: responseBody,
      });
      return;
    }

    await route.fulfill({
      status: outcome === "email_verification_required" ? 409 : 401,
      contentType: "application/json",
      headers: { "x-e2e-auth-recovery-outcome": outcome },
      body: JSON.stringify({
        success: false,
        errorMessage: "Saved E2E session recovery did not complete.",
      }),
    });
  });

  return {
    blockedRequests: () => blockedRequests,
    recoveryDiagnostics: () => [...recoveryDiagnostics],
    dispose: async () => isolatedRecoveryRequest?.dispose(),
  };
}
