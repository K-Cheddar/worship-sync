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
  timeout: 180_000,
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
  const secret = `synthetic-local-browser-portal-test-${randomUUID()}`;
  process.env.AUTH_VOLUNTEER_PORTAL_SECRET = secret;
  const { authHandlers, COLLECTIONS, setServerFirestoreForTests, seedActiveHumanBearerForServerTests } = await import("../authService.js");
  registerVolunteerRoutes(application, authHandlers);
  // Real operator entry/guards and Teams data for the administrator journey.
  application.get("/api/auth/me", authHandlers.getAuthMe);
  application.get("/api/churches/:churchId/teams/bootstrap", authHandlers.getTeamsBootstrap);
  application.get("/api/churches/:churchId/service-plans/:planKey", authHandlers.getServicePlan);
  // Unrelated integrations are deliberately unavailable in this isolated app.
  application.use("/api", (_req, res) => res.status(503).json({ errorMessage: "Integration unavailable in this synthetic fixture." }));
  application.use(express.static(resolve("client/dist")));
  application.get("/{*path}", (_req, res) => res.type("html").send(readFileSync(resolve("client/dist/index.html"))));
  const suffix = randomUUID();
  const churchId = `browser_church_${suffix}`;
  const memberId = `browser_member_${suffix}`;
  const emptyMemberId = `browser_empty_${suffix}`;
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
      churchId, memberId, userId: `browser-admin-${suffix}`, firstName: "Alex", lastName: "Volunteer", updatedAt: "baseline", archivedAt: null,
      blockoutDates: [{ startDate: "2099-11-01", endDate: "2099-11-01" }], notes: "PRIVATE-BROWSER-NOTE",
      serviceAvailability: { "historical@2099-10-01": "available" },
    });
    const emptyMemberRef = await seed(COLLECTIONS.teamRosterMembers, emptyMemberId, {
      churchId, memberId: emptyMemberId, firstName: "Unscheduled", lastName: "Volunteer", updatedAt: "baseline", blockoutDates: [],
    });
    await seed(COLLECTIONS.teamRosterMembers, expiredMemberId, {
      churchId, memberId: expiredMemberId, firstName: "Sam", lastName: "Volunteer", phoneNumber: phone, archivedAt: null,
    });
    await seed(COLLECTIONS.smsConsents, smsConsentIdForChurchPhone(churchId, phone), { churchId, status: "opted_in", phoneNumber: phone });
    const teamId = `browser_team_${suffix}`;
    await seed(COLLECTIONS.teams, teamId, { churchId, teamId, name: "Media", memberIds: [memberId, expiredMemberId, emptyMemberId] });
    const occurrenceId = "service@2099-11-01";
    const scheduleId = `browser_schedule_${suffix}`;
    const ownSchedule = { churchId, teamId, scheduleId, occurrences: [{ occurrenceId, serviceId: "service", serviceIds: ["service"],
      name: "Sunday Gathering", startsAt: "2099-11-01T14:00:00.000Z" }], assignments: { [occurrenceId]: { "camera::0": memberId, "camera::1": expiredMemberId } } };
    ownSchedule.occurrences.push({ occurrenceId: "past", serviceId: "past-service", serviceIds: ["past-service"], name: "Past gathering", startsAt: "2000-01-01T14:00:00.000Z" });
    ownSchedule.assignments.past = { "camera::0": memberId };
    ownSchedule.responses = { [occurrenceId]: { "camera::1": { memberId: expiredMemberId, response: "declined", custom: { preserve: ["original"] } } },
      past: { "camera::0": { memberId, response: "pending", custom: "past response" } } };
    const scheduleRef = await seed(COLLECTIONS.teamSchedules, scheduleId, ownSchedule);
    await seed(COLLECTIONS.teamSchedules, `${scheduleId}_draft`, { ...ownSchedule, scheduleId: `${scheduleId}_draft`, published: false,
      occurrences: [{ occurrenceId: "secret", name: "PRIVATE-DRAFT", startsAt: "2099-11-02T14:00:00.000Z" }], assignments: { secret: { own: memberId } } });
    await seed(COLLECTIONS.teamPositions, "camera", { positionId: "camera", churchId, teamId, name: "Camera" });
    await seed(COLLECTIONS.servicePlans, `${scheduleId}_plan`, { planId: `${scheduleId}_plan`, churchId, serviceId: "service", date: "2099-11-01",
      name: "Service plan", published: true, publicLinkToken: "PRIVATE-BROAD-TOKEN", sections: [{ name: "Welcome", elements: [{ type: "free",
        title: { blocks: [{ spans: [{ text: "Welcome everyone" }] }] }, notes: "PRIVATE-PLAN-NOTE" }] }] });
    const secondTeamId = `browser_second_team_${suffix}`;
    await seed(COLLECTIONS.teams, secondTeamId, { churchId, teamId: secondTeamId, name: "Worship", memberIds: [memberId] });
    await seed(COLLECTIONS.teamPositions, "vocals", { churchId, teamId: secondTeamId, positionId: "vocals", name: "Vocals" });
    const secondScheduleRef = await seed(COLLECTIONS.teamSchedules, `${scheduleId}_second`, {
      churchId, teamId: secondTeamId, scheduleId: `${scheduleId}_second`,
      occurrences: [{ occurrenceId: "evening@2099-12-03", serviceId: "evening", serviceIds: ["evening"], name: "Evening Gathering", startsAt: "2099-12-03T18:00:00.000Z" }],
      assignments: { "evening@2099-12-03": { "vocals::0": memberId } },
    });
    const formId = `browser_form_${suffix}`;
    const recipientId = `browser_recipient_${suffix}`;
    const submissionId = `browser_submission_${suffix}`;
    await seed(COLLECTIONS.teamIntakeForms, formId, { churchId, formId, name: "December availability", active: true,
      purpose: "team_availability", teamIds: [teamId], enabledFields: ["availability"], startDate: "2099-11-01", endDate: "2099-12-31",
      availabilityOccurrences: [
        { occurrenceId, serviceId: "service", name: "Sunday Gathering", serviceDate: "2099-11-01", startsAt: "2099-11-01T14:00:00.000Z" },
        { occurrenceId: "service@2099-12-01", serviceId: "service", name: "December service", serviceDate: "2099-12-01", startsAt: "2099-12-01T14:00:00.000Z" },
      ] });
    await seed(COLLECTIONS.teamIntakeRecipients, recipientId, { churchId, formId, recipientId, memberId,
      submissionId, respondedAt: "previous-response", revokedAt: null });
    await seed(COLLECTIONS.teamIntakeSubmissions, submissionId, { churchId, formId, submissionId, memberId,
      appliedMemberId: memberId, status: "applied", submittedAt: "previous-submission",
      answers: { notes: "Keep this answer" }, occurrenceAvailability: { "historical@2099-10-01": "available" } });
    await seed(COLLECTIONS.teamIntakeRecipients, `${recipientId}_empty`, { churchId, formId,
      recipientId: `${recipientId}_empty`, memberId: emptyMemberId, revokedAt: null });
    // Prepare through the real administrator route, without activation config.
    const adminRequest = { headers: {}, session: { destroy(callback) { callback?.(); } } };
    const admin = await seedActiveHumanBearerForServerTests({ req: adminRequest, churchId, userId: `browser-admin-${suffix}`,
      email: `${suffix}@example.test`, role: "admin", churchName: "Browser Test Church" });
    await db.collection(COLLECTIONS.churches).doc(churchId).update({ serviceTimeZone: "America/New_York" });
    const headers = { authorization: `Bearer ${admin.humanApiToken}` };
    // Launch the actual built operator app before the fresh accountless visit.
    browser = await chromium.launch({ headless: true, args: ["--ignore-certificate-errors"] });
    const adminContext = await browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: headers,
      permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1440, height: 1000 } });
    await adminContext.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(15_000);
    await adminPage.goto(`${base}/#/teams-and-services/members`);
    await adminPage.getByRole("button", { name: /Alex Volunteer/ }).click().catch(async (error) => {
      // This is before any credential is prepared; diagnostics contain no link.
      console.error("Synthetic operator entry:", await adminPage.locator("body").innerText());
      console.error("Synthetic operator paths:", requestPaths);
      throw error;
    });
    await adminPage.getByText("Personal My Schedule access", { exact: true }).click();
    await adminPage.getByRole("button", { name: "Prepare personal link", exact: true }).click();
    await adminPage.getByRole("button", { name: "Copy personal link", exact: true }).click();
    const copiedUrl = await adminPage.evaluate(() => navigator.clipboard.readText());
    const valid = { token: new URL(copiedUrl).hash.slice(1) };
    assert.equal(await adminPage.getByRole("link", { name: copiedUrl, exact: true })
      .evaluate((element) => Boolean(element.closest("[data-sentry-block]"))), true);
    const firstCredential = await access.current({ churchId, memberId });
    await adminPage.getByRole("button", { name: "Prepare personal link", exact: true }).click();
    await adminPage.getByRole("button", { name: "Copy personal link", exact: true }).click();
    assert.equal(await adminPage.evaluate(() => navigator.clipboard.readText()), copiedUrl);
    assert.equal((await access.current({ churchId, memberId })).expiresAt, firstCredential.expiresAt);
    const [desktopVolunteer] = await Promise.all([
      adminPage.waitForEvent("popup"), adminPage.getByRole("link", { name: copiedUrl, exact: true }).click(),
    ]);
    await desktopVolunteer.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    const desktopSession = await (await adminContext.request.get(`${base}/api/volunteer/session`)).json();
    assert.equal(desktopSession.memberId, memberId, "The existing human administrator must not replace the redeemed volunteer identity");
    const desktopData = await (await adminContext.request.get(`${base}/api/volunteer/schedule`, {
      headers: { "x-volunteer-csrf": desktopSession.csrfToken },
    })).json();
    assert.doesNotMatch(JSON.stringify(desktopData), /PRIVATE-|recipientToken|phoneNumber|email/);
    await desktopVolunteer.getByRole("button", { name: /Open Sunday Gathering/i }).click();
    await desktopVolunteer.getByRole("tab", { name: /Service plan/i }).click();
    await desktopVolunteer.getByText("Welcome everyone", { exact: true }).waitFor();
    await desktopVolunteer.getByText("Browser Test Church", { exact: true }).waitFor();
    assert.equal(await desktopVolunteer.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
    if (process.env.VOLUNTEER_BROWSER_DESKTOP_SCREENSHOT) {
      await desktopVolunteer.screenshot({ path: process.env.VOLUNTEER_BROWSER_DESKTOP_SCREENSHOT, fullPage: true });
    }
    await desktopVolunteer.close();
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
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const unexpectedRequests = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith(base) && !url.startsWith("blob:")) { unexpectedRequests.push(url); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    const volunteerPaths = [];
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const consoleMessages = []; page.on("console", (message) => consoleMessages.push(message.text()));
    // Read each real response before delivering it to the page, so navigation
    // cannot retire the DevTools response body before the privacy assertion.
    const interruptedPaths = new Set(["/api/volunteer/redeem"]);
    let interruptSchedule = true;
    await context.route(`${base}/api/volunteer/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (interruptedPaths.delete(path) || (path === "/api/volunteer/schedule" && interruptSchedule)) {
        return route.fulfill({ status: 503, headers: { "Cache-Control": "no-store" },
          contentType: "application/json", body: JSON.stringify({ errorMessage: "Synthetic temporary interruption" }) });
      }
      const response = await route.fetch();
      const text = await response.text();
      assert.ok(!text.includes(valid.token), "Bearer must not be echoed in a volunteer response");
      assert.match(response.headers()["cache-control"], /no-store/);
      await route.fulfill({ response, body: text });
    });
    page.on("request", (request) => {
      volunteerPaths.push(new URL(request.url()).pathname);
      assert.ok(!request.url().includes(valid.token));
      assert.ok(!String(request.headers().referer || "").includes(valid.token));
    });
    const first = await page.goto(`${base}/s#${valid.token}`);
    assert.equal(first.headers()["referrer-policy"], "no-referrer");
    assert.match(first.headers()["cache-control"], /no-store/);
    await page.getByRole("button", { name: "Retry opening My Schedule", exact: true }).click();
    await page.getByRole("button", { name: "Retry My Schedule", exact: true }).waitFor();
    interruptSchedule = false;
    await page.getByRole("button", { name: "Retry My Schedule", exact: true }).click();
    await page.getByRole("button", { name: "Accept remaining assignments" }).waitFor();
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(await page.getByRole("button", { name: /Open December service/i }).count(), 0,
      "An availability form occurrence without an assignment is not shown as a My Schedule card");
    await page.getByRole("textbox", { name: /^Search/ }).fill("Evening");
    await page.getByRole("button", { name: /Open Evening Gathering/i }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Open Sunday Gathering/i }).count(), 0);
    await page.getByRole("textbox", { name: /^Search/ }).fill("");
    await page.getByRole("combobox", { name: /^Team\b/ }).click();
    await page.getByRole("option", { name: "Worship", exact: true }).click();
    await page.getByRole("button", { name: /Open Evening Gathering/i }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Open Sunday Gathering/i }).count(), 0);
    await page.getByRole("combobox", { name: /^Team\b/ }).click();
    await page.getByRole("option", { name: "All teams", exact: true }).click();
    await page.getByRole("combobox", { name: /^Service\b/ }).click();
    await page.getByRole("option", { name: "Evening Gathering", exact: true }).click();
    await page.getByRole("button", { name: /Open Evening Gathering/i }).waitFor();
    await page.getByRole("combobox", { name: /^Service\b/ }).click();
    await page.getByRole("option", { name: "All services", exact: true }).click();
    await page.getByRole("button", { name: "Show 1 past service" }).click();
    await page.getByRole("button", { name: /Open Past gathering/i }).waitFor();
    await page.getByRole("button", { name: "Hide past services" }).click();

    assert.equal(await page.evaluate(async (token) => {
      if ([JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some((value) => value.includes(token))) return true;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (request.url.includes(token) || (await (await cache.match(request)).text()).includes(token)) return true;
        }
      }
      for (const info of await indexedDB.databases()) {
        const database = await new Promise((resolve) => { const open = indexedDB.open(info.name); open.onsuccess = () => resolve(open.result); });
        for (const name of database.objectStoreNames) {
          const records = await new Promise((resolve) => { const read = database.transaction(name).objectStore(name).getAll(); read.onsuccess = () => resolve(read.result); });
          if (JSON.stringify(records).includes(token)) { database.close(); return true; }
        }
        database.close();
      }
      return false;
    }, valid.token), false);
    assert.equal(await page.getByText("PRIVATE-DRAFT").count(), 0);
    await page.getByRole("button", { name: /Time off/i }).click();
    await page.getByRole("button", { name: /Edit time off/i }).click();
    await page.getByRole("textbox", { name: /Notes/i }).fill("Volunteer unsaved dates");
    await memberRef.update({ updatedAt: "admin-revision-b", blockoutDates: [{
      startDate: "2099-11-02", endDate: "2099-11-02", notes: "Administrator saved dates",
    }] });
    let failSecondSchedule = true;
    // Fail one real transaction before its commit, after another schedule can
    // commit. No business operation or authorization response is mocked.
    setServerFirestoreForTests(new Proxy(db, { get(target, key) {
      if (key === "runTransaction") return (operation) => target.runTransaction((transaction) => operation(new Proxy(transaction, {
        get(current, method) {
          if (method === "update") return (ref, patch, ...rest) => {
            if (failSecondSchedule && ref.path === secondScheduleRef.path && patch.responses) {
              failSecondSchedule = false; throw new Error("Synthetic isolated schedule commit failure");
            }
            return current.update(ref, patch, ...rest);
          };
          const value = current[method]; return typeof value === "function" ? value.bind(current) : value;
        },
      })));
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } }));
    const acceptedResponse = page.waitForResponse((response) => response.url().endsWith("/api/volunteer/accept-unanswered"));
    await page.getByRole("button", { name: "Accept remaining assignments" }).click();
    const partial = await (await acceptedResponse).json();
    assert.equal(partial.newlyAccepted, 1);
    assert.equal(partial.failedScheduleCount, 1);
    await page.getByText(/Retry to finish the rest/).waitFor();
    const firstResponse = (await scheduleRef.get()).data().responses[occurrenceId]["camera::0"];
    const retryResponse = page.waitForResponse((response) => response.url().endsWith("/api/volunteer/accept-unanswered"));
    await page.getByRole("button", { name: "Accept remaining assignments", exact: true }).click();
    const retried = await (await retryResponse).json();
    assert.equal(retried.newlyAccepted, 1); assert.equal(retried.failedScheduleCount, 0);
    assert.deepEqual((await scheduleRef.get()).data().responses[occurrenceId]["camera::0"], firstResponse);
    setServerFirestoreForTests(db);
    await page.getByText(/Your saved information changed elsewhere/).waitFor();
    const notesInput = page.getByPlaceholder("Notes (optional)");
    if (await notesInput.count() === 0) {
      // A refresh may return the row to its summary view; the draft should
      // still be visible there and editable when the volunteer reopens it.
      await page.getByText("Volunteer unsaved dates", { exact: true }).waitFor();
      await page.getByRole("button", { name: /Edit time off/i }).click();
    }
    assert.equal(await page.getByPlaceholder("Notes (optional)").inputValue(), "Volunteer unsaved dates");
    assert.equal(await page.getByRole("button", { name: /Save time off/i }).isDisabled(), true);
    await page.getByText("Review saved dates").click();
    await page.getByText(/Administrator saved dates/).waitFor();
    if (process.env.VOLUNTEER_BROWSER_SCREENSHOT) {
      await page.screenshot({ path: process.env.VOLUNTEER_BROWSER_SCREENSHOT, fullPage: true });
    }
    assert.equal((await scheduleRef.get()).data().responses[occurrenceId]["camera::0"].response, "accepted");
    assert.deepEqual((await scheduleRef.get()).data().responses.past, ownSchedule.responses.past);
    assert.deepEqual((await scheduleRef.get()).data().responses[occurrenceId]["camera::1"], ownSchedule.responses[occurrenceId]["camera::1"]);
    await page.getByRole("button", { name: "Discard changes" }).click();
    await page.getByText("Administrator saved dates", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Edit time off/i }).click();
    assert.equal(await page.getByPlaceholder("Notes (optional)").inputValue(), "Administrator saved dates");
    await page.getByRole("button", { name: /Remove blockout/i }).click();
    await page.getByRole("button", { name: /Save time off/i }).click();
    await page.getByText("Time off saved.").waitFor();
    assert.deepEqual((await memberRef.get()).data().blockoutDates, []);
    assert.equal((await memberRef.get()).data().notes, "PRIVATE-BROWSER-NOTE");
    await page.getByRole("button", { name: "Accept remaining assignments" }).waitFor({ state: "detached" });
    assert.deepEqual((await memberRef.get()).data().serviceAvailability, { "historical@2099-10-01": "available" });
    const retainedForm = (await db.collection(COLLECTIONS.teamIntakeForms).doc(formId).get()).data();
    assert.equal(retainedForm.active, true);
    assert.equal(retainedForm.availabilityOccurrences.length, 2);
    const retainedRecipient = (await db.collection(COLLECTIONS.teamIntakeRecipients).doc(recipientId).get()).data();
    assert.equal(retainedRecipient.respondedAt, "previous-response");
    const availabilitySubmission = (await db.collection(COLLECTIONS.teamIntakeSubmissions).doc(submissionId).get()).data();
    assert.deepEqual(availabilitySubmission.occurrenceAvailability, { "historical@2099-10-01": "available" });
    assert.deepEqual(availabilitySubmission.answers, { notes: "Keep this answer" });
    const signedInPage = await adminContext.newPage();
    await signedInPage.goto(`${base}/#/my-schedule`);
    await signedInPage.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    await signedInPage.getByRole("button", { name: /Change your response for Camera/ }).click();
    const declineResponsePromise = signedInPage.waitForResponse((result) =>
      new URL(result.url()).pathname === "/api/volunteer/respond" && result.request().method() === "POST",
    );
    await signedInPage.getByRole("button", { name: /Decline Camera/ }).click();
    const declineResponse = await declineResponsePromise;
    assert.equal(declineResponse.status(), 200);
    assert.deepEqual(await declineResponse.json(), { success: true, response: "declined" });
    assert.equal((await scheduleRef.get()).get(`responses.${occurrenceId}.camera::0.response`), "declined");
    await signedInPage.close();
    for (const response of ["Decline", "Accept"]) {
      await page.getByRole("button", { name: /^Change your response for Camera/ }).click();
      const savedResponse = page.waitForResponse((result) => result.url().endsWith("/api/volunteer/respond"));
      await page.getByRole("button", { name: new RegExp(`^${response} Camera`) }).click();
      assert.equal((await savedResponse).status(), 200);
      assert.equal((await scheduleRef.get()).get(`responses.${occurrenceId}.camera::0.response`), response === "Accept" ? "accepted" : "declined");
    }
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).click();
    await page.getByRole("button", { name: "Save as PDF", exact: true }).click();
    await page.getByRole("heading", { name: "PDF preview", exact: true }).waitFor();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    assert.match((await downloaded).suggestedFilename(), /\.pdf$/);
    await page.getByRole("button", { name: "Close modal", exact: true }).click();
    await page.getByRole("tab", { name: /Service plan/i }).click();
    await page.getByText("Welcome everyone", { exact: true }).waitFor();
    assert.equal(await page.getByText("PRIVATE-PLAN-NOTE").count(), 0);
    assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
    await page.reload();
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    assert.ok([401, 403].includes((await context.request.get(`${base}/api/churches/${churchId}/teams/bootstrap`)).status()));
    assert.ok([401, 403].includes((await context.request.get(`${base}/api/churches/${churchId}/service-plans/${scheduleId}_plan`)).status()));
    // A later roster change removes the service from this person's scope,
    // while independent self-service remains available.
    await secondScheduleRef.update({ assignments: {} });
    await scheduleRef.update({ assignments: { [occurrenceId]: { "camera::1": expiredMemberId }, past: { "camera::0": memberId } } });
    await page.reload();
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Accept Camera/ }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /Time off/i }).count(), 1);
    await scheduleRef.update({ assignments: ownSchedule.assignments });
    await secondScheduleRef.update({ assignments: { "evening@2099-12-03": { "vocals::0": memberId } } });
    await page.reload();
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    const cookies = await context.cookies();
    const cookie = cookies.find((item) => item.name === "__Host-worshipsync-volunteer");
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, "Strict");
    assert.ok(requestPaths.every((path) => !path.includes(valid.token)));
    assert.ok(!volunteerPaths.some((path) => /bootstrap|\/api\/auth\/me|public.*service-flow/.test(path)));
    await adminPage.getByRole("button", { name: "Replace personal link", exact: true }).click();
    await adminPage.getByText("Personal link replaced. Previous links and sessions no longer work.", { exact: true }).waitFor();
    await adminPage.getByRole("button", { name: "Copy personal link", exact: true }).click();
    const replacement = { token: new URL(await adminPage.evaluate(() => navigator.clipboard.readText())).hash.slice(1) };
    await page.reload();
    await page.getByRole("button", { name: "Verify identity" }).waitFor();
    await page.goto(`${base}/s#${valid.token}`);
    await page.getByRole("button", { name: "Verify identity" }).waitFor();
    await page.goto(`${base}/s#${replacement.token}`);
    await page.getByRole("button", { name: /Open Sunday Gathering/i }).waitFor();
    await page.getByRole("button", { name: /Time off/i }).click();
    await page.getByRole("button", { name: /Add single day/i }).click();
    await page.getByRole("textbox", { name: /Notes/i }).fill("Keep this unsaved draft after revocation");
    await adminPage.getByRole("button", { name: "Turn off personal access", exact: true }).click();
    await adminPage.getByText("Personal access turned off.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Save time off", exact: true }).click();
    await page.getByText("Open your personal link to continue.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: /Notes/i }).inputValue(), "Keep this unsaved draft after revocation");
    assert.deepEqual((await memberRef.get()).data().blockoutDates, []);
    await page.reload();
    await page.getByRole("button", { name: "Verify identity" }).waitFor();
    await page.goto(`${base}/s#${replacement.token}`);
    await page.getByText("Personal access has been turned off. Contact your church administrator.").waitFor();
    assert.equal(new URL(page.url()).hash, "");
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
    assert.ok(!consoleMessages.some((text) => text.includes(valid.token)));
    await page.goto(`${base}/s#invalid-synthetic-link`);
    await page.getByRole("button", { name: "Verify identity" }).waitFor();
    assert.equal(new URL(page.url()).hash, "");
    // A volunteer with no assignments still has Time Off, but no availability
    // request cards are blended into the assignment schedule.
    const emptyCredential = await access.prepare({ churchId, memberId: emptyMemberId });
    const emptyContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    await emptyContext.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const emptyPage = await emptyContext.newPage();
    let loseSaveResponse = true;
    await emptyContext.route(`${base}/api/volunteer/blockouts`, async (route) => {
      const committed = await route.fetch();
      if (loseSaveResponse) { loseSaveResponse = false; return route.abort("connectionreset"); }
      return route.fulfill({ response: committed });
    });
    await emptyPage.goto(`${base}/s#${emptyCredential.token}`);
    await emptyPage.getByText("You are not scheduled for anything coming up.", { exact: true }).waitFor();
    assert.equal(await emptyPage.getByRole("button", { name: /Open December service/i }).count(), 0);
    await emptyPage.getByRole("button", { name: /Time off/i }).click();
    await emptyPage.getByRole("button", { name: /Add single day/i }).click();
    await emptyPage.getByRole("button", { name: "Open calendar", exact: true }).click();
    await emptyPage.getByRole("button", { name: /today/i }).click();
    await emptyPage.getByRole("textbox", { name: /Notes/i }).fill("Travel with no assignments");
    await emptyPage.getByRole("button", { name: "Save time off", exact: true }).click();
    await emptyPage.getByRole("button", { name: "Save time off", exact: true }).waitFor({ state: "visible" });
    assert.equal(await emptyPage.getByRole("textbox", { name: /Notes/i }).inputValue(), "Travel with no assignments");
    await emptyPage.getByRole("button", { name: "Save time off", exact: true }).click();
    await emptyPage.getByText(/Your saved information changed elsewhere/).waitFor();
    await emptyPage.getByText("Review saved dates", { exact: true }).click();
    await emptyPage.getByRole("button", { name: "Discard changes", exact: true }).click();
    assert.equal((await emptyMemberRef.get()).data().blockoutDates[0].notes, "Travel with no assignments");
    await emptyPage.getByRole("textbox", { name: /Notes/i }).fill("Edited travel");
    await emptyPage.getByRole("button", { name: "Save time off", exact: true }).click();
    await emptyPage.getByText("Time off saved.", { exact: true }).waitFor();
    assert.equal((await emptyMemberRef.get()).data().blockoutDates[0].notes, "Edited travel");
    await emptyPage.getByRole("button", { name: /Remove blockout/i }).click();
    const removedTimeOff = emptyPage.waitForResponse((result) => result.url().endsWith("/api/volunteer/blockouts") && result.status() === 200);
    await emptyPage.getByRole("button", { name: "Save time off", exact: true }).click();
    await removedTimeOff;
    await emptyPage.getByText("Time off saved.", { exact: true }).last().waitFor();
    assert.deepEqual((await emptyMemberRef.get()).data().blockoutDates, []);
    assert.equal((await emptyMemberRef.get()).data().serviceAvailability, undefined);
    assert.equal((await db.collection(COLLECTIONS.teamIntakeForms).doc(formId).get()).data().availabilityOccurrences.length, 2);
    const returning = await emptyContext.newPage();
    await returning.goto(`${base}/s`);
    await returning.getByText("You are not scheduled for anything coming up.", { exact: true }).waitFor();
    await emptyMemberRef.update({ archivedAt: new Date().toISOString() });
    await returning.reload();
    await returning.getByRole("button", { name: "Verify identity", exact: true }).waitFor();
    await emptyMemberRef.delete();
    assert.equal((await emptyContext.request.get(`${base}/api/volunteer/session`)).status(), 401);
    await emptyContext.close();
    assert.deepEqual(errors, []);
    await context.close();
    await adminContext.close();
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
