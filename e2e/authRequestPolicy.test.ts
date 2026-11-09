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
import {
  allowedE2EAuthOrigins,
  firebaseAuthRequestMatchers,
  isTrustedFirebaseAuthOrigin,
} from "./authOrigins";
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
    mode: "authenticated" as
      | "authenticated"
      | "wrong-account"
      | "wrong-tenant"
      | "incomplete-session"
      | "email-verification",
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
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "worshipsync_sid=unverified-session; Path=/; HttpOnly; SameSite=Lax",
        });
        response.end(JSON.stringify({ success: true, requiresEmailCode: true }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": `worshipsync_sid=fixture-${state.mode}-session; Path=/; HttpOnly; SameSite=Lax`,
      });
      response.end(JSON.stringify({
        success: true,
        bootstrap: {
          authenticated: true,
          sessionKind: state.mode === "incomplete-session" ? "workstation" : "human",
          churchId: state.mode === "wrong-tenant" ? "other-church" : "demo",
          user: {
            email: state.mode === "wrong-account"
              ? "someone-else@example.invalid"
              : "e2e@example.invalid",
          },
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

const runThroughContextGuard = async (
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
) => {
  const page = await context.newPage();
  await page.goto(baseURL);
  const result = await requestRecovery(page);
  return { page, result };
};

const requestRecovery = (page: import("@playwright/test").Page) =>
  page.evaluate(async ({ idToken, deviceId }) => {
    try {
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
    } catch {
      return { blocked: true };
    }
  }, { idToken: "fixture-id-token", deviceId: deviceIdentity });

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

test("Firebase auth allows only HTTPS default-port origins and intercepts every exact-host port", () => {
  for (const provider of ["identitytoolkit", "securetoken"] as const) {
    const host = provider === "identitytoolkit"
      ? "identitytoolkit.googleapis.com"
      : "securetoken.googleapis.com";
    assert.equal(isTrustedFirebaseAuthOrigin(`https://${host}/v1/test`, provider), true);
    assert.equal(isTrustedFirebaseAuthOrigin(`https://${host}:443/v1/test`, provider), true);
    assert.equal(isTrustedFirebaseAuthOrigin(`http://${host}/v1/test`, provider), false);
    assert.equal(isTrustedFirebaseAuthOrigin(`https://${host}:444/v1/test`, provider), false);
    assert.equal(firebaseAuthRequestMatchers[provider].test(`https://${host}:444/v1/test`), true);
    assert.equal(firebaseAuthRequestMatchers[provider].test(`https://${host}.attacker.invalid/v1/test`), false);
  }
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

test("context guard shares one recovery attempt across pages and rejects unverified identities without cookies", async (t) => {
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

  const context = await makeContext();
  const guard = await installSavedSessionAuthRequestGuard(
    context,
    fixture.baseURL,
    { email: "e2e@example.invalid", churchId: "demo" },
  );
  try {
    const firstPage = await runThroughContextGuard(context, fixture.baseURL);
    assert.deepEqual(firstPage.result, {
      status: 200,
      outcome: "authenticated",
      authenticated: true,
    });
    assert.equal(await firstPage.page.locator("h1").textContent(), "Authenticated Home");
    const transferredCookie = (await context.cookies(fixture.baseURL)).find(
      (cookie) => cookie.name === "worshipsync_sid",
    );
    assert.ok(transferredCookie);
    assert.equal(transferredCookie.path, "/");
    assert.equal(transferredCookie.domain, new URL(fixture.baseURL).hostname);

    const secondPage = await context.newPage();
    await secondPage.goto(fixture.baseURL);
    assert.deepEqual(await requestRecovery(secondPage), { blocked: true });
    assert.equal(guard.blockedRequests(), 1);
  } finally {
    await guard.dispose();
    await context.close();
  }

  for (const mode of ["email-verification", "wrong-account", "wrong-tenant", "incomplete-session"] as const) {
    fixture.state.mode = mode;
    const rejectedContext = await makeContext();
    const rejectedGuard = await installSavedSessionAuthRequestGuard(
      rejectedContext,
      fixture.baseURL,
      { email: "e2e@example.invalid", churchId: "demo" },
    );
    try {
      const firstPage = await runThroughContextGuard(rejectedContext, fixture.baseURL);
      assert.equal(firstPage.result.authenticated, false, mode);
      assert.equal(firstPage.result.outcome, mode === "email-verification"
        ? "email_verification_required"
        : mode === "wrong-account"
          ? "wrong_account"
          : mode === "wrong-tenant"
            ? "wrong_tenant"
            : "invalid_authenticated_session");
      assert.equal((await rejectedContext.cookies(fixture.baseURL)).some(
        (cookie) => cookie.name === "worshipsync_sid",
      ), false, `${mode} must not install its response cookie`);

      const secondPage = await rejectedContext.newPage();
      await secondPage.goto(fixture.baseURL);
      assert.deepEqual(await requestRecovery(secondPage), { blocked: true }, mode);
      assert.equal(rejectedGuard.blockedRequests(), 1, mode);
    } finally {
      await rejectedGuard.dispose();
      await rejectedContext.close();
    }
  }

  assert.equal(fixture.state.sessionRequests, 5);
  assert.equal(fixture.state.emailRequests, 0);
  assert.equal(fixture.state.requestSummaries.length, 5);
  assert.ok(fixture.state.requestSummaries.every((summary) =>
    summary.requestNewCode === false && summary.hasIdToken && summary.deviceMatches,
  ));
});
