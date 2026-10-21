import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, devices } from "@playwright/test";
import { SchedulingBackend } from "../e2e/schedulingBackend";
import { assertSafeSchedule } from "../e2e/schedulingScope";
import { getE2EAuthConfig, requireReusableSavedSession, validateSavedSession } from "../e2e/auth";
import { allowedE2EAuthOrigins } from "../e2e/authOrigins";

dotenv.config({ quiet: true });
const args = process.argv.slice(2);
const index = args.indexOf("--manifest");
if (index < 0 || !args[index + 1]) throw new Error("Supply one exact --manifest path. No name/date-based or automatic leftover cleanup is supported.");
const path = resolve(args[index + 1]);
const manifest = JSON.parse(await readFile(path, "utf8"));
const backend = new SchedulingBackend(manifest.userId, manifest);
if (path !== backend.manifestPath) throw new Error("Manifest path does not match its run ID");
try {
  console.log(JSON.stringify({ manifest: path, scope: backend.scope, schedules: (await backend.schedules()).map(doc => doc.scheduleId), claims: (await backend.claims()).map(doc => doc.id), services: (await backend.services()).filter(doc => backend.scope.serviceIds.includes(doc.id)).map(doc => doc.id) }, null, 2));
  if (args.includes("--cleanup") && manifest.status !== "cleaned") {
    const needsCleanup = await backend.verifyRecoveryLease();
    if (needsCleanup && await backend.schedule()) {
      // No password login, auth refresh, or email-generating fallback.
      const browser = await chromium.launch();
      try {
        const { baseURL, email } = await getE2EAuthConfig();
        requireReusableSavedSession(await validateSavedSession(browser, baseURL, email));
        const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL, storageState: "playwright/.auth/worshipsync-user.json", ignoreHTTPSErrors: new URL(baseURL).hostname === "local.worshipsync.net" });
        const page = await context.newPage();
        const origins = allowedE2EAuthOrigins(baseURL);
        await page.route(/\/api\//, async route => {
          const request = route.request();
          const url = new URL(request.url());
          const deletePath = `/api/churches/${backend.scope.churchId}/team-schedules/${backend.scope.scheduleId}/delete`;
          if (!origins.has(url.origin) || (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !(request.method() === "POST" && url.pathname === deletePath))) { await route.abort("blockedbyclient"); return; }
          await route.continue();
        });
        await page.goto("/#/home");
        await backend.cleanup(async () => {
          assertSafeSchedule(await backend.schedule(), backend.scope);
          await page.evaluate(async ({ churchId, scheduleId }) => {
            const modulePath = "/src/api/auth.ts";
            const api = await import(modulePath);
            await api.getAuthBootstrap({});
            await api.deleteTeamSchedule(churchId, scheduleId);
          }, backend.scope);
        });
      } finally { await browser.close(); }
    } else if (needsCleanup) {
      await backend.cleanup(async () => { throw new Error(`Unexpected schedule appeared: ${backend.scope.scheduleId}; preserved it`); });
    }
    console.log(`Cleanup verified for ${backend.scope.runId}; stable team, position and contact-free member retained.`);
  }
} finally {
  await backend.runtime.db.terminate();
  await backend.runtime.rtdb.goOffline();
}
process.exit(0);
