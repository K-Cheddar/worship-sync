import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
  authorizeSilentSessionRequest,
  classifySmokeRecoveryResponse,
  installSavedSessionAuthRequestGuard,
  isMailSlurpRequest,
  readSavedE2EDeviceIdentity,
} from "./authRequestPolicy";
import { allowedE2EAuthOrigins } from "./authOrigins";
import { isAllowedSmokeChurchRead } from "./smokeRequestPolicy";

const baseURL = "https://local.worshipsync.net:3000/";
const trustedOrigins = allowedE2EAuthOrigins(baseURL);
const deviceIdentity = "saved-test-device";
const validRequest = {
  method: "POST",
  url: "https://local.worshipsync.net:5000/api/auth/session",
  body: {
    idToken: "nonempty-test-token",
    deviceId: deviceIdentity,
    userAgent: "test browser",
    platform: "test platform",
    requestNewCode: false,
  },
  trustedOrigins,
  expectedDeviceIdentity: deviceIdentity,
};

const startRecoveryFixture = async () => {
  const state = {
    mode: "authenticated" as "authenticated" | "email-verification",
    sessionRequests: 0,
    emailRequests: 0,
    requestSummaries: [] as Array<{ requestNewCode: unknown; hasIdToken: boolean; deviceMatches: boolean }>,
  };
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>fixture</body></html>");
      return;
    }
    if (request.method === "POST" && pathname === "/api/auth/session") {
      state.sessionRequests++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      state.requestSummaries.push({
        requestNewCode: body.requestNewCode,
        hasIdToken: typeof body.idToken === "string" && Boolean(body.idToken),
        deviceMatches: body.deviceId === deviceIdentity,
      });
      if (state.mode === "email-verification") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: true, requiresEmailCode: true }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "worshipsync_sid=fixture-valid-session; Path=/; HttpOnly; SameSite=Lax",
      });
      response.end(JSON.stringify({
        success: true,
        bootstrap: {
          authenticated: true,
          sessionKind: "human",
          churchId: "demo",
          user: { email: "e2e@example.invalid" },
          device: { deviceId: "trusted-server-device" },
        },
      }));
      return;
    }
    if (pathname.startsWith("/api/auth/")) state.emailRequests++;
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseURL = `http://127.0.0.1:${address.port}/`;
  return {
    baseURL,
    state,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
};

const runThroughPageAndContextGuards = async (
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
) => {
  const page = await context.newPage();
  const trusted = new Set([new URL(baseURL).origin]);
  await page.route(/\/api\/auth(?:\/|$)/, async (route) => {
    let body: unknown;
    try { body = route.request().postDataJSON(); } catch { /* fail closed */ }
    if (authorizeSilentSessionRequest({
      method: route.request().method(),
      url: route.request().url(),
      body,
      trustedOrigins: trusted,
      expectedDeviceIdentity: deviceIdentity,
    }).allowed) {
      await route.fallback();
      return;
    }
    await route.abort("blockedbyclient");
  });
  await page.goto(baseURL);
  const result = await page.evaluate(async ({ idToken, deviceId }) => {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken, deviceId, requestNewCode: false }),
    });
    const payload = await response.json();
    const authenticated = payload.bootstrap?.authenticated === true;
    document.body.innerHTML = authenticated
      ? "<h1>Authenticated Home</h1>"
      : "<h1>Sign in required</h1>";
    return {
      status: response.status,
      outcome: response.headers.get("x-e2e-auth-recovery-outcome"),
      authenticated,
    };
  }, { idToken: "fixture-id-token", deviceId: deviceIdentity });
  return { page, result };
};

test("permits only a trusted-origin no-email session request for the saved device", () => {
  assert.deepEqual(authorizeSilentSessionRequest(validRequest), { allowed: true });
  assert.equal(
    readSavedE2EDeviceIdentity({
      origins: [{
        origin: "https://local.worshipsync.net:3000",
        localStorage: [{ name: "worshipsync_device_id", value: deviceIdentity }],
      }],
    }, baseURL),
    deviceIdentity,
  );
});

test("fails closed for untrusted origins, missing device identity, or a different device", () => {
  for (const input of [
    { ...validRequest, url: "https://attacker.invalid/api/auth/session" },
    { ...validRequest, expectedDeviceIdentity: null },
    { ...validRequest, body: { ...validRequest.body, deviceId: "other-device" } },
    { ...validRequest, body: { ...validRequest.body, deviceId: "" } },
  ]) {
    assert.equal(authorizeSilentSessionRequest(input).allowed, false);
  }
  assert.equal(readSavedE2EDeviceIdentity({ origins: [] }, baseURL), null);
});

test("requires an explicit nonempty Firebase ID token and requestNewCode false", () => {
  for (const body of [
    { ...validRequest.body, idToken: "" },
    { ...validRequest.body, idToken: 42 },
    { ...validRequest.body, requestNewCode: true },
    { idToken: validRequest.body.idToken, deviceId: deviceIdentity },
    null,
  ]) {
    assert.equal(authorizeSilentSessionRequest({ ...validRequest, body }).allowed, false);
  }
});

test("rejects malformed, extra-field, and non-exact session requests", () => {
  for (const input of [
    { ...validRequest, method: "GET" },
    { ...validRequest, url: "https://local.worshipsync.net:5000/prefix/api/auth/session" },
    { ...validRequest, url: "https://local.worshipsync.net:5000/api/auth/session/" },
    { ...validRequest, body: { ...validRequest.body, code: "123456" } },
    { ...validRequest, body: "not-json" },
  ]) {
    assert.equal(authorizeSilentSessionRequest(input).allowed, false);
  }
});

test("classifies email verification and rejects wrong-account, wrong-tenant, and incomplete recovery", () => {
  const recovered = {
    authenticated: true,
    sessionKind: "human",
    churchId: "demo",
    user: { email: "e2e@example.invalid" },
    device: { deviceId: "server-trusted-device" },
  };
  assert.equal(
    classifySmokeRecoveryResponse(200, { requiresEmailCode: true }, "e2e@example.invalid", "demo"),
    "email_verification_required",
  );
  assert.equal(
    classifySmokeRecoveryResponse(200, recovered, "e2e@example.invalid", "demo"),
    "authenticated",
  );
  assert.equal(
    classifySmokeRecoveryResponse(200, { ...recovered, user: { email: "other@example.invalid" } }, "e2e@example.invalid", "demo"),
    "wrong_account",
  );
  assert.equal(
    classifySmokeRecoveryResponse(200, { ...recovered, churchId: "other-church" }, "e2e@example.invalid", "demo"),
    "wrong_tenant",
  );
  assert.equal(
    classifySmokeRecoveryResponse(200, { ...recovered, device: { deviceId: "" } }, "e2e@example.invalid", "demo"),
    "invalid_authenticated_session",
  );
  assert.equal(classifySmokeRecoveryResponse(401, {}, "e2e@example.invalid", "demo"), "server_rejected");
});

test("MailSlurp stays outside the allowed request set", () => {
  assert.equal(isMailSlurpRequest("https://api.mailslurp.com/waitForLatestEmail"), true);
  assert.equal(isMailSlurpRequest("https://mailslurp.com/"), true);
  assert.equal(isMailSlurpRequest("https://mailslurp.com.attacker.invalid/"), false);
});

test("smoke permits only read-only requests to the demo church API", () => {
  const apiURL = "https://local.worshipsync.net:5000/api/churches/demo/teams";
  assert.equal(isAllowedSmokeChurchRead("GET", apiURL, baseURL, "demo"), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isAllowedSmokeChurchRead(method, apiURL, baseURL, "demo"), false);
  }
  assert.equal(
    isAllowedSmokeChurchRead("GET", "https://local.worshipsync.net:5000/api/churches/other/teams", baseURL, "demo"),
    false,
  );
  assert.equal(
    isAllowedSmokeChurchRead("GET", "https://attacker.invalid/api/churches/demo/teams", baseURL, "demo"),
    false,
  );
});

test("page and context guards recover to Home without an OTP and stop on email verification", async (t) => {
  const fixture = await startRecoveryFixture();
  t.after(fixture.close);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const makeContext = async () => browser.newContext({
    baseURL: fixture.baseURL,
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(fixture.baseURL).origin,
        localStorage: [{ name: "worshipsync_device_id", value: deviceIdentity }],
      }],
    },
  });

  const successContext = await makeContext();
  const successGuard = await installSavedSessionAuthRequestGuard(
    successContext,
    fixture.baseURL,
    { email: "e2e@example.invalid", churchId: "demo" },
  );
  const success = await runThroughPageAndContextGuards(successContext, fixture.baseURL);
  assert.deepEqual(success.result, {
    status: 200,
    outcome: "authenticated",
    authenticated: true,
  });
  assert.equal(await success.page.locator("h1").textContent(), "Authenticated Home");
  assert.ok((await successContext.cookies(fixture.baseURL)).some(
    (cookie) => cookie.name === "worshipsync_sid",
  ));
  const repeatedRecoveryWasBlocked = await success.page.evaluate(async () => {
    try {
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken: "fixture-id-token",
          deviceId: "saved-test-device",
          requestNewCode: false,
        }),
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(repeatedRecoveryWasBlocked, true);
  assert.equal(successGuard.blockedRequests(), 1);
  await successContext.close();

  fixture.state.mode = "email-verification";
  const verificationContext = await makeContext();
  const verificationGuard = await installSavedSessionAuthRequestGuard(
    verificationContext,
    fixture.baseURL,
    { email: "e2e@example.invalid", churchId: "demo" },
  );
  const verification = await runThroughPageAndContextGuards(verificationContext, fixture.baseURL);
  assert.equal(verification.result.status, 409);
  assert.equal(verification.result.outcome, "email_verification_required");
  assert.equal(verification.result.authenticated, false);
  assert.equal(await verificationContext.cookies(fixture.baseURL).then((cookies) => cookies.some(
    (cookie) => cookie.name === "worshipsync_sid",
  )), false);
  assert.equal(verificationGuard.blockedRequests(), 0);
  await verificationContext.close();

  assert.equal(fixture.state.sessionRequests, 2);
  assert.equal(fixture.state.emailRequests, 0);
  assert.deepEqual(fixture.state.requestSummaries, [
    { requestNewCode: false, hasIdToken: true, deviceMatches: true },
    { requestNewCode: false, hasIdToken: true, deviceMatches: true },
  ]);
});
