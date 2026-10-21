import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, request } from "node:https";
import { readFileSync } from "node:fs";
import express from "express";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerPersonalAccess } from "./volunteerPersonalAccess.js";
import { createVolunteerPortalHandlers, VOLUNTEER_SESSION_COOKIE } from "./volunteerPortalHandlers.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test("synthetic HTTPS redemption keeps authority isolated, bounds cookies, rejects previews/CSRF and never echoes secrets", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `http-access-${randomUUID()}`);
  const db = getFirestore(app); const prefix = `http_access_${randomUUID()}`;
  const collections = Object.fromEntries(["access", "credentials", "sessions"].map((kind) => [kind, `${prefix}_${kind}`]));
  const memberCollection = `${prefix}_members`; const identity = { churchId: "church", memberId: "volunteer" };
  let time = Date.parse("2026-10-21T12:00:00Z");
  const store = createVolunteerPersonalAccess({ db, collections, memberCollection,
    secret: "synthetic-http-only-personal-credential-key", now: () => time });
  const application = express(); application.use(express.json());
  const paths = []; application.use((req, _res, next) => { paths.push(req.originalUrl); next(); });
  const server = createServer({ key: readFileSync("client/local.worshipsync.net-key.pem"),
    cert: readFileSync("client/local.worshipsync.net.pem") }, application);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `https://127.0.0.1:${server.address().port}`;
  const error = (status, message) => Object.assign(new Error(message), { status });
  let authorized; let limits = 0;
  const handlers = createVolunteerPortalHandlers({ getAccessStore: () => store, appBaseUrl: base,
    httpError: error, getClientIp: () => "synthetic-ip", enforceRateLimit: async () => { limits++; },
    getSchedule: async (value) => { authorized = value; return { success: true, memberId: value.memberId }; },
    respond: async (value) => { await db.runTransaction(value.authorize); return { success: true }; },
  });
  application.post("/api/volunteer/redeem", handlers.redeemVolunteerPersonalAccess);
  application.get("/api/volunteer/session", handlers.getVolunteerPersonalSession);
  application.get("/api/volunteer/schedule", handlers.getVolunteerPersonalSchedule);
  application.post("/api/volunteer/respond", handlers.respondToVolunteerPersonalAssignment);
  const call = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = request(base + path, { rejectUnauthorized: false, method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: base, ...headers } }, (res) => {
      let text = ""; res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, body: JSON.parse(text) }));
    }); req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await db.collection(memberCollection).doc(identity.memberId).set(identity);
    const credential = await store.prepare(identity);
    const crawler = await call("/api/volunteer/redeem", { token: credential.token }, { "user-agent": "Slackbot-LinkExpanding 1.0" });
    assert.equal(crawler.status, 403); assert.equal((await db.collection(collections.sessions).get()).size, 0);
    assert.equal((await call("/api/volunteer/redeem", { token: credential.token }, { purpose: "prefetch" })).status, 403);
    assert.equal((await call("/api/volunteer/redeem", { token: credential.token }, { origin: "https://other.test" })).status, 403);
    const redeemed = await call("/api/volunteer/redeem", { token: credential.token, memberId: "admin", churchId: "foreign" });
    assert.equal(redeemed.status, 200); assert.deepEqual(redeemed.body, { success: true });
    assert.equal(redeemed.headers["cache-control"], "no-store");
    assert.equal(redeemed.headers["referrer-policy"], "no-referrer");
    const setCookie = redeemed.headers["set-cookie"][0];
    for (const attribute of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) assert.ok(setCookie.includes(attribute));
    assert.ok(!setCookie.includes("Domain=")); assert.ok(setCookie.startsWith(`${VOLUNTEER_SESSION_COOKIE}=`));
    assert.equal(Date.parse(setCookie.match(/Expires=([^;]+)/)[1]), credential.expiresAt);
    const cookie = setCookie.split(";")[0];
    const session = await call("/api/volunteer/session", undefined, { cookie, authorization: "Bearer synthetic-human-admin" });
    assert.equal(session.body.memberId, identity.memberId);
    assert.equal((await call("/api/volunteer/respond", {}, { cookie })).status, 403);
    const headers = { cookie, "x-volunteer-csrf": session.body.csrfToken, authorization: "Bearer synthetic-human-admin" };
    const loaded = await call("/api/volunteer/schedule?memberId=admin&churchId=foreign", undefined, headers);
    assert.equal(loaded.body.memberId, identity.memberId);
    assert.equal(authorized.accessType, "personal-volunteer-credential");
    assert.equal(authorized.generation, credential.generation);
    assert.equal((await call("/api/volunteer/respond", { memberId: "admin" }, headers)).status, 200);
    assert.equal((await call("/api/volunteer/respond", {}, { ...headers, origin: "https://other.test" })).status, 403);
    await store.prepare(identity, { replace: true, requestKey: "synthetic-http-replacement" });
    assert.equal((await call("/api/volunteer/session", undefined, { cookie })).status, 401);
    assert.equal((await call("/api/volunteer/redeem", { token: credential.token })).status, 404);
    const active = await store.prepare(identity);
    time += 91 * 24 * 60 * 60 * 1000;
    assert.equal((await call("/api/volunteer/redeem", { token: active.token })).status, 410);
    await store.revoke(identity, "admin");
    assert.equal((await call("/api/volunteer/redeem", { token: active.token })).status, 403);
    for (const token of ["bad", "v_" + "x".repeat(32)]) assert.equal((await call("/api/volunteer/redeem", { token })).status, 404);
    assert.ok(paths.every((path) => !path.includes(credential.token)));
    for (const response of [crawler, redeemed, session, loaded]) assert.ok(!response.text.includes(credential.token));
    assert.ok(limits >= 15);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await Promise.all([...Object.values(collections), memberCollection].map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate(); await deleteApp(app);
  }
});
