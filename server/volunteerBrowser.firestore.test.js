process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:https";
import express from "express";
import { chromium } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { registerVolunteerRoutes } from "./volunteerRoutes.js";
import { createVolunteerPersonalAccess } from "./volunteerPersonalAccess.js";
import { createVolunteerRecovery } from "./volunteerRecovery.js";
import { setSmsConsentSenderForServerTests, smsConsentIdForChurchPhone } from "./smsConsent.js";

test("built public My Schedule works on mobile HTTPS with actual routes, Firestore and verified recovery", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
  timeout: 120_000,
}, async () => {
  assert.ok(existsSync(resolve("client/dist/index.html")), "Build the client before running the browser integration test.");
  const application = express();
  application.use(express.json());
  const requestPaths = [];
  application.use((req, _res, next) => { requestPaths.push(req.originalUrl); next(); });
  const server = createServer({ key: readFileSync("client/local.worshipsync.net-key.pem"), cert: readFileSync("client/local.worshipsync.net.pem") }, application);
  await new Promise((yes) => server.listen(0, "127.0.0.1", yes));
  const base = `https://127.0.0.1:${server.address().port}`;
  process.env.AUTH_APP_BASE_URL = base;
  process.env.AUTH_VOLUNTEER_PORTAL_ENABLED = "true";
  const secret = `synthetic-local-browser-portal-test-${randomUUID()}`;
  process.env.AUTH_VOLUNTEER_PORTAL_SECRET = secret;
  const { authHandlers, COLLECTIONS, setServerFirestoreForTests } = await import("../authService.js");
  registerVolunteerRoutes(application, authHandlers);
  application.use(express.static(resolve("client/dist")));
  application.get("/{*path}", (_req, res) => res.type("html").send(readFileSync(resolve("client/dist/index.html"))));
  const suffix = randomUUID();
  const churchId = `browser_church_${suffix}`;
  const memberId = `browser_member_${suffix}`;
  const expiredMemberId = `browser_expired_${suffix}`;
  const app = initializeApp({ projectId: "demo-worshipsync" }, `browser-${suffix}`);
  const db = getFirestore(app); setServerFirestoreForTests(db);
  const refs = [];
  const seed = async (collection, id, data) => {
    const ref = db.collection(collection).doc(id); refs.push(ref); await ref.set(data); return ref;
  };
  let browser;
  let lastCode = "";
  const access = createVolunteerPersonalAccess({ db, memberCollection: COLLECTIONS.teamRosterMembers, secret });
  const recovery = createVolunteerRecovery({ db, access, secret, memberCollection: COLLECTIONS.teamRosterMembers,
    consentCollection: COLLECTIONS.smsConsents, now: () => Date.now() - 61_000,
    sendCode: async ({ code }) => { lastCode = code; } });
  const phone = "+12125550123";
  try {
    await seed(COLLECTIONS.churches, churchId, { churchId, name: "Browser Test Church", serviceTimeZone: "America/New_York" });
    const memberRef = await seed(COLLECTIONS.teamRosterMembers, memberId, {
      churchId, memberId, firstName: "Alex", lastName: "Volunteer", updatedAt: "baseline", archivedAt: null,
      blockoutDates: [{ startDate: "2099-11-01", endDate: "2099-11-01" }], notes: "PRIVATE-BROWSER-NOTE",
    });
    await seed(COLLECTIONS.teamRosterMembers, expiredMemberId, {
      churchId, memberId: expiredMemberId, firstName: "Sam", lastName: "Volunteer", phoneNumber: phone, archivedAt: null,
    });
    await seed(COLLECTIONS.smsConsents, smsConsentIdForChurchPhone(churchId, phone), { churchId, status: "opted_in", phoneNumber: phone });
    const teamId = `browser_team_${suffix}`;
    await seed(COLLECTIONS.teams, teamId, { churchId, teamId, name: "Media", memberIds: [memberId, expiredMemberId] });
    const occurrenceId = "service@2099-11-01";
    const scheduleId = `browser_schedule_${suffix}`;
    const ownSchedule = { churchId, teamId, scheduleId, occurrences: [{ occurrenceId, serviceId: "service", serviceIds: ["service"],
      name: "Sunday Gathering", startsAt: "2099-11-01T14:00:00.000Z" }], assignments: { [occurrenceId]: { "camera::0": memberId, "camera::1": expiredMemberId } } };
    const scheduleRef = await seed(COLLECTIONS.teamSchedules, scheduleId, ownSchedule);
    await seed(COLLECTIONS.teamSchedules, `${scheduleId}_draft`, { ...ownSchedule, scheduleId: `${scheduleId}_draft`, published: false,
      occurrences: [{ occurrenceId: "secret", name: "PRIVATE-DRAFT", startsAt: "2099-11-02T14:00:00.000Z" }], assignments: { secret: { own: memberId } } });
    await seed(COLLECTIONS.teamPositions, "camera", { positionId: "camera", churchId, teamId, name: "Camera" });
    await seed(COLLECTIONS.servicePlans, `${scheduleId}_plan`, { planId: `${scheduleId}_plan`, churchId, serviceId: "service", date: "2099-11-01",
      name: "Service plan", published: true, publicLinkToken: "PRIVATE-BROAD-TOKEN", sections: [{ name: "Welcome", elements: [{ type: "free",
        title: { blocks: [{ spans: [{ text: "Welcome everyone" }] }] }, notes: "PRIVATE-PLAN-NOTE" }] }] });
    const formId = `browser_form_${suffix}`;
    const recipientId = `browser_recipient_${suffix}`;
    await seed(COLLECTIONS.teamIntakeForms, formId, { churchId, formId, name: "December availability", active: true,
      purpose: "team_availability", teamIds: [teamId], enabledFields: ["availability"], startDate: "2099-12-01", endDate: "2099-12-31",
      availabilityOccurrences: [{ occurrenceId: "service@2099-12-01", name: "December service", startsAt: "2099-12-01T14:00:00.000Z" }] });
    await seed(COLLECTIONS.teamIntakeRecipients, recipientId, { churchId, formId, recipientId, memberId, revokedAt: null });
    const valid = await access.prepare({ churchId, memberId });
    const expired = await access.prepare({ churchId, memberId: expiredMemberId });
    const challenge = await recovery.start({ requestKey: "enrollment".padEnd(48, "x"), clientIp: "fixture",
      enrollment: { identity: { churchId, memberId: expiredMemberId }, channel: "sms", actorUid: "fixture-admin" } });
    assert.equal((await recovery.verify({ challengeId: challenge.challengeId, code: lastCode, completionKey: "completion".padEnd(48, "x"),
      enrollmentActorUid: "fixture-admin", enrollmentIdentity: { churchId, memberId: expiredMemberId } })).success, true);
    const expiredDocs = await db.collection("volunteerPersonalCredentials").where("churchId", "==", churchId).where("memberId", "==", expiredMemberId).get();
    await expiredDocs.docs[0].ref.update({ expiresAt: Date.now() - 1 });
    setSmsConsentSenderForServerTests(async ({ code }) => { lastCode = code; return { provider: "fake" }; });
    // The local development certificate also needs to be trusted for the
    // worker process; context.ignoreHTTPSErrors alone covers page requests.
    browser = await chromium.launch({ headless: true, args: ["--ignore-certificate-errors"] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const unexpectedRequests = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith(base)) { unexpectedRequests.push(url); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const first = await page.goto(`${base}/s#${valid.token}`);
    assert.equal(first.headers()["referrer-policy"], "no-referrer");
    assert.match(first.headers()["cache-control"], /no-store/);
    await page.getByRole("button", { name: "Accept all unanswered" }).waitFor();
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(await page.getByText("PRIVATE-DRAFT").count(), 0);
    await page.getByRole("button", { name: /Time off/i }).click();
    await page.getByRole("textbox", { name: /Notes/i }).fill("Volunteer unsaved dates");
    await memberRef.update({ updatedAt: "admin-revision-b", blockoutDates: [{
      startDate: "2099-11-02", endDate: "2099-11-02", notes: "Administrator saved dates",
    }] });
    const acceptedResponse = page.waitForResponse((response) => response.url().endsWith("/api/volunteer/accept-unanswered"));
    await page.getByRole("button", { name: "Accept all unanswered" }).click();
    assert.equal((await (await acceptedResponse).json()).success, true);
    await page.getByText(/Your saved information changed elsewhere/).waitFor();
    assert.equal(await page.getByRole("textbox", { name: /Notes/i }).inputValue(), "Volunteer unsaved dates");
    assert.equal(await page.getByRole("button", { name: /Save time off/i }).isDisabled(), true);
    await page.getByText("Review saved dates").click();
    await page.getByText(/Administrator saved dates/).waitFor();
    if (process.env.VOLUNTEER_BROWSER_SCREENSHOT) {
      await page.screenshot({ path: process.env.VOLUNTEER_BROWSER_SCREENSHOT, fullPage: true });
    }
    assert.equal((await scheduleRef.get()).data().responses[occurrenceId]["camera::0"].response, "accepted");
    await page.getByRole("button", { name: "Discard changes" }).click();
    assert.equal(await page.getByRole("textbox", { name: /Notes/i }).inputValue(), "Administrator saved dates");
    await page.getByRole("button", { name: /Remove blockout/i }).click();
    await page.getByRole("button", { name: /Save time off/i }).click();
    await page.getByText("Time off saved.").waitFor();
    assert.deepEqual((await memberRef.get()).data().blockoutDates, []);
    assert.equal((await memberRef.get()).data().notes, "PRIVATE-BROWSER-NOTE");
    await page.getByRole("button", { name: "Accept all unanswered" }).waitFor({ state: "detached" });
    await page.getByText("Availability requests (1)").click();
    await page.getByRole("combobox", { name: /December service/i }).click();
    await page.getByRole("option", { name: "Unavailable", exact: true }).click();
    await page.getByRole("button", { name: "Save availability" }).click();
    await page.getByText("Availability saved.").waitFor();
    assert.equal((await memberRef.get()).data().serviceAvailability["service@2099-12-01"], "unavailable");
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).click();
    await page.getByRole("tab", { name: /Service plan/i }).click();
    await page.getByText("Welcome everyone", { exact: true }).waitFor();
    assert.equal(await page.getByText("PRIVATE-PLAN-NOTE").count(), 0);
    assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
    await page.reload();
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    const cookies = await context.cookies();
    const cookie = cookies.find((item) => item.name === "__Host-worshipsync-volunteer");
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, "Strict");
    assert.ok(requestPaths.every((path) => !path.includes(valid.token)));
    assert.ok(!requestPaths.some((path) => /bootstrap|\/api\/auth\/me|public.*service-flow/.test(path)));
    await access.revoke({ churchId, memberId }, "fixture-admin");
    await page.reload();
    await page.getByRole("button", { name: "Verify identity" }).waitFor();
    await page.goto(`${base}/s#${expired.token}`);
    const recoveryResponse = page.waitForResponse((response) => response.url().endsWith("/api/volunteer/recovery/start"));
    await page.getByRole("button", { name: "Verify identity" }).click();
    const recoveryStarted = await (await recoveryResponse).json();
    const savedChallenge = (await db.collection("volunteerRecoveryChallenges").doc(recoveryStarted.challengeId).get()).data();
    assert.equal(savedChallenge.active, true, `Recovery reservation: ${JSON.stringify({ active: savedChallenge.active, delivery: savedChallenge.delivery })}`);
    assert.equal(savedChallenge.delivery, "sent");
    await page.getByLabel(/Verification code/i).fill(lastCode);
    const verifiedResponse = page.waitForResponse((response) => response.url().endsWith("/api/volunteer/recovery/verify"));
    await page.getByRole("button", { name: "Verify and open My Schedule" }).click();
    assert.equal((await (await verifiedResponse).json()).success, true, "The real recovery handler must accept the delivered code.");
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    assert.equal(unexpectedRequests.length, 0, `Unexpected external requests: ${unexpectedRequests.join(", ")}`);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    setSmsConsentSenderForServerTests(null);
    await browser?.close();
    for (const name of ["volunteerPersonalAccess", "volunteerPersonalCredentials", "volunteerPersonalSessions", "volunteerContactProofs", "volunteerRecoveryChallenges"]) {
      const rows = await db.collection(name).where("churchId", "==", churchId).get(); refs.push(...rows.docs.map((doc) => doc.ref));
    }
    await Promise.all(refs.map((ref) => ref.delete()));
    setServerFirestoreForTests(null); await db.terminate(); await deleteApp(app);
    server.closeAllConnections(); await new Promise((yes) => server.close(yes));
  }
});
