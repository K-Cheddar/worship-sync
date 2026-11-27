/* global globalThis */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { build, preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "../../node_modules/playwright",
);
const root = process.cwd();
const outDir = resolve(root, "node_modules/.cache/team-availability-intake-build");
const screenshots = resolve(root, "node_modules/.cache/team-availability-intake-screenshots");
await mkdir(screenshots, { recursive: true });

const options = {
  configFile: false,
  root,
  plugins: [
    {
      name: "team-availability-intake-route-context",
      enforce: "pre",
      load(id) {
        if (id.replaceAll("\\", "/").endsWith("/pages/Teams/TeamsPageContext.tsx")) {
          return "export const useTeamsPage = () => globalThis.__availabilityFixtureTeams;";
        }
      },
    },
    react(),
  ],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "e2e/team-availability-intake-fixture.html"),
    },
  },
};

await build(options);
const server = await preview({
  ...options,
  preview: { host: "127.0.0.1", port: 3127, strictPort: true },
});
const browser = await chromium.launch({ headless: true });

try {
  for (const { label, width, height } of [
    { label: "desktop", width: 1280, height: 800 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    let savedForm = {
      formId: "availability-form",
      churchId: "church",
      purpose: "team_availability",
      name: "December Availability",
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      availabilityServices: [{ serviceId: "sunday-service", name: "Sunday worship" }],
      availabilityOccurrences: [
        { occurrenceId: "sunday-service@2026-12-06T10:00:00.000Z", serviceId: "sunday-service", name: "Sunday worship", startsAt: "2026-12-06T10:00:00.000Z", serviceDate: "2026-12-06" },
        { occurrenceId: "sunday-service@2026-12-13T10:00:00.000Z", serviceId: "sunday-service", name: "Sunday worship", startsAt: "2026-12-13T10:00:00.000Z", serviceDate: "2026-12-13" },
      ],
      teamIds: ["worship"],
      enabledFields: ["availability"],
      active: true,
      welcomeMessage: "",
      submissionCount: 0,
    };
    let submittedRecord;
    let appliedRequest;

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.pathname.endsWith("/team-intake/preview")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            churchName: "Grace Chapel",
            serviceTimeZone: "UTC",
            form: savedForm,
            positions: [],
            teams: [],
          }),
        });
      }
      if (method === "POST" && url.pathname.endsWith("/team-intake/submit")) {
        const payload = request.postDataJSON();
        submittedRecord = {
          submissionId: "general-submission",
          churchId: "church",
          formId: savedForm.formId,
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
          normalizedName: `${payload.firstName} ${payload.lastName}`.trim().toLowerCase(),
          positionIds: [],
          occurrenceAvailability: payload.occurrenceAvailability,
          blockoutRanges: [],
          status: "new",
          submittedAt: "2026-11-24T15:00:00.000Z",
        };
        await page.evaluate((submission) => {
          globalThis.__teamAvailabilityIntakeFixture?.addSubmission(submission);
        }, submittedRecord);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, submissionId: submittedRecord.submissionId }),
        });
      }
      if (method === "POST" && url.pathname.endsWith("/team-intake/forms/availability-form")) {
        savedForm = { ...savedForm, ...request.postDataJSON() };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, form: savedForm }),
        });
      }
      if (method === "POST" && url.pathname.endsWith("/team-intake/submissions/general-submission")) {
        appliedRequest = request.postDataJSON();
        submittedRecord = {
          ...submittedRecord,
          status: "applied",
          appliedMemberId: appliedRequest.memberId,
          appliedMemberCreated: false,
          appliedAt: "2026-11-24T15:02:00.000Z",
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, submission: submittedRecord }),
        });
      }
      if (url.pathname.endsWith("/notification-intents")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, intents: [], nextCursor: "", limit: 100 }) });
      }
      if (url.pathname.includes("/sms-attempts")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, attempts: [] }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });

    await page.goto("http://127.0.0.1:3127/e2e/team-availability-intake-fixture.html");
    await page.getByRole("button", { name: "Edit December Availability", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const welcome = page.getByLabel(/Welcome message/);
    await welcome.fill("Welcome, Worship team.");
    await page.getByRole("button", { name: "Save form", exact: true }).click();
    await page.getByRole("button", { name: "Send requests", exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await page.getByLabel(/Welcome message/).inputValue(), "Welcome, Worship team.");
    await page.evaluate(() => globalThis.__teamAvailabilityIntakeFixture?.goToPublicForm());

    await page.getByRole("heading", { name: "December Availability", exact: true }).waitFor();
    await page.getByText("Welcome, Worship team.", { exact: true }).waitFor();
    await page.getByText("Select your available dates.", { exact: true }).waitFor();
    await page.getByText("Check all the dates you can serve. Leave dates you cannot serve unchecked.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Rae Kim", { exact: true }).count(), 0, "The anonymous page does not reveal roster identities");
    assert.equal(await page.getByRole("button", { name: "Submit availability", exact: true }).count(), 1);
    await page.getByLabel(/First name/).fill("Rae");
    await page.getByLabel(/Last name/).fill("Kim");
    await page.getByRole("button", { name: "Submit availability", exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(submittedRecord, undefined, "An untouched availability choice is not submitted");
    await page.getByRole("button", { name: "Close toast", exact: true }).click();
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("button", { name: "Submit availability", exact: true }).click();
    await page.getByText("Your availability was submitted. You can close this page.", { exact: true }).waitFor();
    assert.deepEqual(submittedRecord.occurrenceAvailability, {
      "sunday-service@2026-12-06T10:00:00.000Z": "available",
      "sunday-service@2026-12-13T10:00:00.000Z": "unavailable",
    });
    await page.screenshot({ path: resolve(screenshots, `public-${label}.png`), fullPage: true });
    await page.evaluate(() => globalThis.__teamAvailabilityIntakeFixture?.goToManager());

    await page.getByRole("button", { name: "Edit December Availability", exact: true }).click();
    await page.getByText(/Review availability link responses/).click();
    await page.getByRole("button", { name: "Expand submission from Rae Kim", exact: true }).click();
    await page.getByText("Suggested match:").waitFor();
    assert.equal(await page.getByRole("button", { name: "Create member", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Apply to member", exact: true }).click();
    await page.getByRole("progressbar").waitFor();
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuetext"), "1 of 1 responded");
    await page.getByRole("button", { name: "View availability for Rae Kim", exact: true }).click();
    const availabilityDetails = page.getByRole("region", { name: "Rae Kim availability details", exact: true });
    await availabilityDetails.getByText("Available", { exact: true }).waitFor();
    await availabilityDetails.getByText("Unavailable", { exact: true }).waitFor();
    assert.equal(appliedRequest.action, "applied");
    assert.equal(appliedRequest.memberId, "member-rae");
    assert.equal(await page.getByRole("button", { name: "Send requests", exact: true }).count(), 1);
    assert.equal(await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth), true, `${label} layout has no horizontal overflow`);
    await page.screenshot({ path: resolve(screenshots, `admin-${label}.png`), fullPage: true });
    assert.deepEqual(pageErrors, []);
    await page.close();
  }
  console.log(`Public availability form and admin review round trips passed on desktop and mobile. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
