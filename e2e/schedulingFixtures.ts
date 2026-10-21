import { test as diagnosticTest, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { SchedulingBackend, TEST_MEMBER_NAME } from "./schedulingBackend";
import { assertSafeSchedule, schedulingMutationAllowed } from "./schedulingScope";
import { allowedE2EAuthOrigins } from "./authOrigins";

export async function applicationApi(page: Page, method: string, args: unknown[]) {
  return page.evaluate(async ({ method, args }) => {
    const modulePath = "/src/api/auth.ts";
    const api = await import(modulePath);
    return api[method](...args);
  }, { method, args });
}

export class SchedulingFixture {
  lastEnsureBody: any;
  constructor(readonly page: Page, readonly backend: SchedulingBackend) {}
  get scope() { return this.backend.scope; }
  async open() {
    await this.page.goto("/#/teams-and-services/schedules", { waitUntil: "domcontentloaded" });
    await expect(this.page.getByRole("status", { name: "Loading schedules" })).toBeHidden();
    await expect(this.page.getByRole("group", { name: "Team schedule controls" })).toBeVisible({ timeout: 60_000 });
    await expect(this.page.locator('[data-schedule-cell-trigger]')).toHaveCount(1);
    // Reading the authoritative backend proves a virtual view is still unsaved.
  }
  async assign() {
    const trigger = this.page.locator('[data-schedule-cell-trigger]').first();
    await trigger.click();
    await this.page.getByRole("option", { name: new RegExp(TEST_MEMBER_NAME) }).click();
    await expect.poll(async () => {
      const schedule: any = await this.backend.schedule();
      return JSON.stringify(schedule?.assignments || {}).includes(this.scope.memberId);
    }, { timeout: 30_000 }).toBe(true);
    await expect(trigger).toContainText(TEST_MEMBER_NAME);
  }
  async ensureAgain() {
    if (!this.lastEnsureBody) throw new Error("No real application period request was recorded");
    return applicationApi(this.page, "ensureTeamScheduleForPeriod", [this.scope.churchId, this.lastEnsureBody]);
  }
  async deleteSchedule() {
    assertSafeSchedule(await this.backend.schedule(), this.scope);
    await applicationApi(this.page, "deleteTeamSchedule", [this.scope.churchId, this.scope.scheduleId]);
    await this.backend.verifyReleased();
  }
  async cleanup() {
    // Unmount the grid before deleting so SSE cannot recreate the fixture.
    await this.page.goto("/#/home", { waitUntil: "domcontentloaded" });
    await this.backend.cleanup(() => this.deleteSchedule());
  }
}

export const test = diagnosticTest.extend<{ scheduling: SchedulingFixture }>({
  scheduling: async ({ page }, use, testInfo) => {
    const churchId = process.env.E2E_DEMO_CHURCH_ID?.trim();
    if (!churchId) throw new Error("Set E2E_DEMO_CHURCH_ID to the explicitly verified demo church ID.");
    // Install safety before the app mounts. No anonymous default team is opened.
    const authOrigins = allowedE2EAuthOrigins(testInfo.project.use.baseURL!);
    const blocked: string[] = [];
    await page.route(/\/api\/churches\/[^/]+(?:\/|$)/, async route => {
      const path = new URL(route.request().url()).pathname;
      const requested = path.match(/\/api\/churches\/([^/]+)/)?.[1];
      if (!requested || decodeURIComponent(requested) !== churchId || !authOrigins.has(new URL(route.request().url()).origin)) {
        blocked.push(path); await route.abort("blockedbyclient"); return;
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
        blocked.push(path); await route.abort("blockedbyclient"); return;
      }
      await route.fallback();
    });
    await page.goto("/#/home", { waitUntil: "domcontentloaded" });
    const auth: any = await applicationApi(page, "getAuthBootstrap", [{}]);
    if (auth.churchId !== churchId || auth.sessionKind !== "human" || !auth.user?.uid) throw new Error(`Saved demo identity did not match E2E_DEMO_CHURCH_ID=${churchId}; no fixtures changed`);
    const backend = new SchedulingBackend(auth.user.uid);
    if (auth.role !== "admin" && auth.permissions?.teams !== "edit" && auth.permissions?.teamScopes?.[backend.scope.teamId] !== "edit") {
      throw new Error(`Saved account needs edit access to reserved team ${backend.scope.teamId}; no test records were changed`);
    }
    const fixture = new SchedulingFixture(page, backend);
    await page.addInitScript(({ churchId, teamId }) => {
      localStorage.setItem(`teams:schedule-team-filter:${churchId}`, teamId);
      localStorage.removeItem(`teams:selected-schedule:${churchId}`);
    }, fixture.scope);
    await page.evaluate(({ churchId, teamId }) => {
      localStorage.setItem(`teams:schedule-team-filter:${churchId}`, teamId);
      localStorage.removeItem(`teams:selected-schedule:${churchId}`);
    }, fixture.scope);
    await page.route(/\/api\/churches\/[^/]+\/team-schedules(?:\/|$)/, async route => {
      const request = route.request();
      if (["GET", "HEAD", "OPTIONS"].includes(request.method())) { await route.fallback(); return; }
      const path = new URL(request.url()).pathname;
      let body: any;
      try { body = request.postDataJSON(); } catch { /* fail closed */ }
      if (!authOrigins.has(new URL(request.url()).origin) || !schedulingMutationAllowed(path, body, fixture.scope)) {
        blocked.push(path); await route.abort("blockedbyclient"); return;
      }
      if (path.endsWith("/ensure")) {
        fixture.lastEnsureBody = body;
        await backend.intendSchedule();
        const response = await route.fetch();
        if (response.ok()) {
          const result = await response.json();
          if (result.schedule?.scheduleId !== fixture.scope.scheduleId) throw new Error(`Unexpected schedule ID ${result.schedule?.scheduleId}; preserved it`);
          await backend.adoptSchedule();
        }
        await route.fulfill({ response });
      } else {
        assertSafeSchedule(await backend.schedule(), fixture.scope);
        await route.continue();
      }
    });
    try {
      await backend.begin();
      await use(fixture);
    } catch (error) {
      await testInfo.attach("scheduling-before-cleanup.txt", { body: Buffer.from(await page.locator("body").ariaSnapshot().catch(() => "Page unavailable")), contentType: "text/plain" });
      throw error;
    } finally {
      try {
        if (backend.leaseAcquired) await fixture.cleanup();
        expect(blocked, "The scheduling scope guard blocked unsafe requests").toEqual([]);
      } finally {
        await testInfo.attach("scheduling-records.json", { body: Buffer.from(JSON.stringify({ scope: fixture.scope, manifestPath: backend.manifestPath, events: backend.events, blocked }, null, 2)), contentType: "application/json" });
      }
    }
  },
});
export { expect };
