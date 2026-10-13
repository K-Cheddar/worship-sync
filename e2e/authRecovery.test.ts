import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import {
  chromium,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import {
  requireReusableSavedSession,
  validateSavedSession,
  type SessionCheck,
} from "./auth";

const email = "fixture.operator@example.invalid";
const deviceIdentity = "fixture-controller-device";
const churchId = "fixture-church-id";
const tenantLabel = "Fixture Church";
const authFileName = "worshipsync-user.json";
const metadataFileName = "worshipsync-user.meta.json";
type TestStorageStateBase = Awaited<ReturnType<BrowserContext["storageState"]>>;
type TestStorageState = Omit<TestStorageStateBase, "origins"> & {
  origins: Array<TestStorageStateBase["origins"][number] & {
    indexedDB?: Array<{
      name: string;
      stores?: Array<{ name: string; records?: unknown[] }>;
    }>;
  }>;
};

type FixtureOptions = {
  recovery: "success" | "email-code";
  tryEmailRequestOnLoad?: boolean;
  sessionRequestNewCode?: boolean;
  recoveredEmail?: string;
  recoveredChurchId?: string;
};

const bootstrap = (
  emailValue = email,
  churchIdValue = churchId,
) => ({
  authenticated: true,
  sessionKind: "human",
  churchId: churchIdValue,
  churchName: tenantLabel,
  user: { uid: "fixture-user", email: emailValue, primaryEmail: emailValue },
  device: { deviceId: deviceIdentity },
});

const json = (response: import("node:http").ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const readRequestBody = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};

const startFixture = async (options: FixtureOptions) => {
  const state = {
    recoveryRequests: 0,
    emailSendAttempts: 0,
    recoveryBodySummaries: [] as Array<{
      requestNewCode: unknown;
      deviceId: unknown;
      hasIdToken: boolean;
    }>,
  };
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && pathname === "/seed") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>state seed</body></html>");
      return;
    }
    if (request.method === "GET" && pathname === "/api/auth/me") {
      if ((request.headers.cookie || "").includes("worshipsync_sid=fixture-valid-session")) {
        json(response, 200, { bootstrap: bootstrap() });
      } else {
        json(response, 401, { authenticated: false });
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/auth/session") {
      state.recoveryRequests += 1;
      const body = await readRequestBody(request);
      if (body.requestNewCode !== false) state.emailSendAttempts += 1;
      state.recoveryBodySummaries.push({
        requestNewCode: body.requestNewCode,
        deviceId: body.deviceId,
        hasIdToken: typeof body.idToken === "string" && Boolean(body.idToken),
      });
      if (options.recovery === "email-code") {
        json(response, 200, {
          success: true,
          requiresEmailCode: true,
          pendingAuthId: "fixture-pending-auth",
        });
        return;
      }
      response.setHeader(
        "set-cookie",
        "worshipsync_sid=fixture-valid-session; Path=/; HttpOnly; SameSite=Lax",
      );
      json(response, 200, {
        success: true,
        bootstrap: {
          ...bootstrap(options.recoveredEmail, options.recoveredChurchId),
          device: { deviceId: String(body.deviceId || "") },
        },
      });
      return;
    }
    if (pathname.startsWith("/api/auth/")) {
      state.emailSendAttempts += 1;
      json(response, 200, { success: true });
      return;
    }
    if (request.method === "GET" && pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html><body><div id="app">Loading</div><script>
          const email = ${JSON.stringify(email)};
          const deviceKey = "worshipsync_device_id";
          const authStore = () => new Promise((resolve) => {
            const request = indexedDB.open("firebaseLocalStorageDb");
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
                db.close(); resolve(false); return;
              }
              const count = db.transaction("firebaseLocalStorage", "readonly")
                .objectStore("firebaseLocalStorage").count();
              count.onsuccess = () => { const found = count.result > 0; db.close(); resolve(found); };
              count.onerror = () => { db.close(); resolve(false); };
            };
            request.onerror = () => resolve(false);
          });
          const showSignedIn = (session) => {
            const accountEmail = session.user?.primaryEmail || session.user?.email || email;
            document.getElementById("app").innerHTML =
              '<h1>Controllers</h1><button id="account">Account: ' + accountEmail + '</button>';
            document.getElementById("account").onclick = () => {
              const panel = document.createElement("section");
              const emailText = document.createElement("div");
              emailText.textContent = accountEmail;
              const row = document.createElement("div");
              const label = document.createElement("span");
              label.textContent = "Church";
              const value = document.createElement("span");
              value.textContent = session.churchName || ${JSON.stringify(tenantLabel)};
              row.append(label, value);
              panel.append(emailText, row);
              document.body.append(panel);
            };
          };
          const showEmailChallenge = () => {
            document.getElementById("app").innerHTML = '<h1>Check your email</h1>';
          };
          (async () => {
            ${options.tryEmailRequestOnLoad ? "await fetch('/api/auth/resend-email-code', { method: 'POST' }).catch(() => {});" : ""}
            let response = await fetch("/api/auth/me", { credentials: "include" });
            let result = await response.json().catch(() => ({}));
            let session = result.bootstrap || result;
            if (!response.ok || session.authenticated !== true) {
              if (await authStore()) {
                try {
                  response = await fetch("/api/auth/session", {
                    method: "POST",
                    credentials: "include",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      idToken: "fixture-firebase-id-token",
                      deviceId: localStorage.getItem(deviceKey),
                      requestNewCode: ${JSON.stringify(options.sessionRequestNewCode ?? false)},
                    }),
                  });
                } catch {
                  document.getElementById("app").innerHTML = '<label for="fixture-email">Email</label><input id="fixture-email" type="email">';
                  return;
                }
                result = await response.json().catch(() => ({}));
                session = result.bootstrap || result;
                if (result.requiresEmailCode === true) {
                  showEmailChallenge();
                  return;
                }
              }
            }
            if (session.authenticated === true) showSignedIn(session);
            else document.getElementById("app").innerHTML = '<label for="fixture-email">Email</label><input id="fixture-email" type="email">';
          })();
        </script></body></html>`);
      return;
    }
    json(response, 404, { error: "not found" });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseURL = `http://127.0.0.1:${address.port}/`;
  return {
    baseURL,
    state,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
  };
};

const makeTempFiles = async (t: import("node:test").TestContext) => {
  const directory = await mkdtemp(join(tmpdir(), "worshipsync-auth-recovery-"));
  const absoluteDirectory = resolve(directory);
  const absoluteTemp = resolve(tmpdir());
  assert.ok(absoluteDirectory.startsWith(`${absoluteTemp}${sep}`));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    files: {
      authFile: join(directory, authFileName),
      metadataFile: join(directory, metadataFileName),
    },
  };
};

const seedStorageState = async (
  browser: Browser,
  baseURL: string,
  cookie: { value: string; expires: number },
): Promise<TestStorageState> => {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto(new URL("seed", baseURL).toString());
    await page.evaluate(async ({ emailValue, deviceKey }) => {
      localStorage.setItem(deviceKey, "fixture-controller-device");
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("firebaseLocalStorageDb", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("firebaseLocalStorage", {
            keyPath: "fbase_key",
          });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("firebaseLocalStorage", "readwrite");
          transaction.objectStore("firebaseLocalStorage").put({
            fbase_key: "fixture-firebase-auth-user",
            value: { uid: "fixture-user", email: emailValue },
          });
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
      });
    }, { emailValue: email, deviceKey: "worshipsync_device_id" });

    const storageState = await context.storageState({ indexedDB: true });
    storageState.cookies.push({
      name: "worshipsync_sid",
      value: cookie.value,
      domain: "127.0.0.1",
      path: "/",
      expires: cookie.expires,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    return storageState;
  } finally {
    await context.close();
  }
};

const writeFixtureState = async (
  files: { authFile: string; metadataFile: string },
  baseURL: string,
  state: TestStorageState,
) => {
  await writeFile(files.authFile, JSON.stringify(state, null, 2));
  await writeFile(files.metadataFile, JSON.stringify({
    version: 1,
    application: new URL(baseURL).toString(),
    accountFingerprint: createHash("sha256").update(email).digest("hex"),
    tenantIdFingerprint: createHash("sha256").update(churchId).digest("hex"),
    tenantLabel,
  }, null, 2));
};

const verifyRecoveredResult = (result: SessionCheck) => {
  assert.equal(result.status, "valid", result.status === "valid" ? undefined : result.reason);
  if (result.status !== "valid") return result;
  assert.equal(result.identity.email, email);
  assert.equal(result.identity.tenantLabel, tenantLabel);
  assert.equal(result.identity.tenantIdFingerprint, createHash("sha256").update(churchId).digest("hex"));
  return result;
};

test("recovers an expired cookie and reuses the saved session in a second Chromium process", async (t) => {
  const fixture = await startFixture({ recovery: "success" });
  t.after(fixture.close);
  const temp = await makeTempFiles(t);

  const seedBrowser = await chromium.launch({ headless: true });
  try {
    const state = await seedStorageState(seedBrowser, fixture.baseURL, {
      value: "expired-fixture-cookie",
      expires: Math.floor(Date.now() / 1000) - 60,
    });
    await writeFixtureState(temp.files, fixture.baseURL, state);
  } finally {
    await seedBrowser.close();
  }

  const firstBrowser = await chromium.launch({ headless: true });
  try {
    verifyRecoveredResult(
      await validateSavedSession(firstBrowser, fixture.baseURL, email, temp.files),
    );
  } finally {
    await firstBrowser.close();
  }

  const savedAfterRecovery = JSON.parse(await readFile(temp.files.authFile, "utf8")) as TestStorageState;
  assert.ok(savedAfterRecovery.cookies.some(
    (cookie) => cookie.name === "worshipsync_sid" && cookie.value === "fixture-valid-session",
  ));
  const savedOrigin = savedAfterRecovery.origins.find(
    (origin) => origin.origin === new URL(fixture.baseURL).origin,
  );
  assert.equal(
    savedOrigin?.localStorage?.find((entry) => entry.name === "worshipsync_device_id")?.value,
    deviceIdentity,
  );
  assert.ok(savedOrigin?.indexedDB?.some(
    (database) => database.name === "firebaseLocalStorageDb" &&
      database.stores?.some((store) => store.name === "firebaseLocalStorage" && store.records?.length),
  ));

  const secondBrowser = await chromium.launch({ headless: true });
  try {
    verifyRecoveredResult(
      await validateSavedSession(secondBrowser, fixture.baseURL, email, temp.files),
    );
  } finally {
    await secondBrowser.close();
  }
  assert.equal(fixture.state.recoveryRequests, 1);
  assert.equal(fixture.state.emailSendAttempts, 0);
  assert.deepEqual(fixture.state.recoveryBodySummaries, [{
    requestNewCode: false,
    deviceId: deviceIdentity,
    hasIdToken: true,
  }]);
});

test("silently recovers a server-rejected cookie without requesting an email code", async (t) => {
  const fixture = await startFixture({ recovery: "success" });
  t.after(fixture.close);
  const temp = await makeTempFiles(t);
  const browser = await chromium.launch({ headless: true });
  try {
    const state = await seedStorageState(browser, fixture.baseURL, {
      value: "server-rejected-cookie",
      expires: Math.floor(Date.now() / 1000) + 3_600,
    });
    await writeFixtureState(temp.files, fixture.baseURL, state);
    verifyRecoveredResult(
      await validateSavedSession(browser, fixture.baseURL, email, temp.files),
    );
  } finally {
    await browser.close();
  }
  assert.equal(fixture.state.recoveryRequests, 1);
  assert.equal(fixture.state.emailSendAttempts, 0);
  assert.deepEqual(fixture.state.recoveryBodySummaries, [{
    requestNewCode: false,
    deviceId: deviceIdentity,
    hasIdToken: true,
  }]);
});

test("rejects silent recovery for a different configured account or tenant", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const scenario of [
    { recoveredEmail: "someone-else@example.invalid", expectedReason: /configured test account/ },
    { recoveredChurchId: "another-fixture-church", expectedReason: /different WorshipSync tenant/ },
  ]) {
    const { expectedReason, ...recoveryOverrides } = scenario;
    const fixture = await startFixture({ recovery: "success", ...recoveryOverrides });
    try {
      const temp = await makeTempFiles(t);
      const state = await seedStorageState(browser, fixture.baseURL, {
        value: "server-rejected-cookie",
        expires: Math.floor(Date.now() / 1000) + 3_600,
      });
      await writeFixtureState(temp.files, fixture.baseURL, state);
      const result = await validateSavedSession(browser, fixture.baseURL, email, temp.files);
      assert.equal(result.status, "invalid");
      if (result.status === "invalid") assert.match(result.reason, expectedReason);
      assert.equal(fixture.state.recoveryRequests, 1);
      assert.equal(fixture.state.emailSendAttempts, 0);
      assert.deepEqual(fixture.state.recoveryBodySummaries, [{
        requestNewCode: false,
        deviceId: deviceIdentity,
        hasIdToken: true,
      }]);
    } finally {
      await fixture.close();
    }
  }
});

test("fails clearly when recovery needs email verification and blocks email-sending auth requests", async (t) => {
  const fixture = await startFixture({
    recovery: "email-code",
    tryEmailRequestOnLoad: true,
  });
  t.after(fixture.close);
  const temp = await makeTempFiles(t);
  const browser = await chromium.launch({ headless: true });
  try {
    const state = await seedStorageState(browser, fixture.baseURL, {
      value: "expired-fixture-cookie",
      expires: Math.floor(Date.now() / 1000) - 60,
    });
    await writeFixtureState(temp.files, fixture.baseURL, state);
    const result = await validateSavedSession(browser, fixture.baseURL, email, temp.files);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.match(result.reason, /requires email verification/);
      assert.throws(
        () => requireReusableSavedSession(result),
        /npm run test:e2e:auth:refresh/,
      );
    }
  } finally {
    await browser.close();
  }
  assert.equal(fixture.state.recoveryRequests, 1);
  assert.equal(fixture.state.emailSendAttempts, 0);
  assert.deepEqual(fixture.state.recoveryBodySummaries, [{
    requestNewCode: false,
    deviceId: deviceIdentity,
    hasIdToken: true,
  }]);
});

test("blocks a session request that could send a new verification code", async (t) => {
  const fixture = await startFixture({
    recovery: "success",
    sessionRequestNewCode: true,
  });
  t.after(fixture.close);
  const temp = await makeTempFiles(t);
  const browser = await chromium.launch({ headless: true });
  try {
    const state = await seedStorageState(browser, fixture.baseURL, {
      value: "expired-fixture-cookie",
      expires: Math.floor(Date.now() / 1000) - 60,
    });
    await writeFixtureState(temp.files, fixture.baseURL, state);
    const result = await validateSavedSession(browser, fixture.baseURL, email, temp.files);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.match(result.reason, /authentication request outside silent server-session recovery/);
      assert.throws(
        () => requireReusableSavedSession(result),
        /npm run test:e2e:auth:refresh/,
      );
    }
  } finally {
    await browser.close();
  }
  assert.equal(fixture.state.recoveryRequests, 0);
  assert.equal(fixture.state.emailSendAttempts, 0);
  assert.deepEqual(fixture.state.recoveryBodySummaries, []);
});
