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
const outDir = resolve(
  root,
  "node_modules/.cache/availability-workspace-build",
);
const screenshots = resolve(
  root,
  "node_modules/.cache/availability-workspace-screenshots",
);
await mkdir(screenshots, { recursive: true });
const options = {
  configFile: false,
  root,
  plugins: [
    {
      name: "availability-forms-route-context",
      enforce: "pre",
      load(id) {
        if (
          id.replaceAll("\\", "/").endsWith("/pages/Teams/TeamsPageContext.tsx")
        ) {
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
      input: resolve(root, "e2e/availability-workspace-fixture.html"),
    },
  },
};
await build(options);
const server = await preview({
  ...options,
  preview: { host: "127.0.0.1", port: 3126, strictPort: true },
});
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: width < 640 ? 640 : 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let dispatches = 0;
    // Exercise the real API client against reviewed fixtures; never contact a message provider.
    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/dispatch")) dispatches += 1;
      const memberIds = url.endsWith("/prepare") ? route.request().postDataJSON().memberIds : [];
      const eligible = Math.max(0, memberIds.length - 1);
      const recipients = memberIds.map((memberId, index) => ({
        memberId, memberName: memberId === "member-1" ? "John Davis" : `Volunteer ${memberId}`,
        eligible: index < eligible, status: index < eligible ? "ready" : "excluded",
        intentId: `intent-${memberId}`, segmentCount: index < eligible ? 1 : 0,
        phoneNumberSnapshot: index < 2 ? "+12025550123" : "+12025550124",
        message: index < eligible ? `Please share your availability: https://example.test/private/${memberId}` : "",
        exclusionReason: index < eligible ? "" : "SMS consent is needed",
      }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(url.endsWith("/prepare") ? { success: true, batch: {
          batchId: "batch", churchId: "church", formId: "form", intentType: "availability_request", reminderRound: 0,
          status: "prepared", selectedMemberIds: memberIds, intentIds: recipients.map((recipient) => recipient.intentId),
          approvalVersion: "review-v1", recipients,
          summary: { selected: memberIds.length, requested: memberIds.length, eligible, excluded: 1, totalSegments: eligible, sent: 0, delivered: 0, failed: 0, uncertain: 0, awaitingDispatch: eligible },
        } } : { success: true, intents: [], attempts: [] }),
      });
    });
    await page.goto(
      `http://127.0.0.1:3126/e2e/availability-workspace-fixture.html${width < 640 ? "?missingPurpose" : ""}`,
    );
    await page
      .getByRole("button", { name: "Edit October Availability", exact: true })
      .click();
    await page.getByRole("region", { name: "Volunteers", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab").count(), 0);
    assert.equal(await page.getByRole("checkbox").count(), 0);
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuetext"), "1 of 30 responded");
    assert.equal(await page.getByRole("button", { name: "Send requests", exact: true }).getAttribute("data-variant"), "presentCta");
    await page.screenshot({
      path: resolve(screenshots, `volunteers-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "View availability for Jane Smith", exact: true }).click();
    await page.getByRole("region", { name: "Jane Smith availability details" }).getByText("No answer", { exact: true }).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Page overflows at ${width}px`,
    );
    await page.screenshot({
      path: resolve(screenshots, `answers-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "View availability by date", exact: true }).click();
    const comparison = page.getByRole("dialog", { name: "Availability by date", exact: true });
    await comparison.waitFor();
    await comparison.getByRole("combobox", { name: /Service date/ }).click();
    await page.getByRole("option", { name: /October 11, 2026/ }).click();
    await comparison.getByRole("listitem", { name: "Jane Smith: Unavailable", exact: true }).waitFor();
    await page.screenshot({
      path: resolve(screenshots, `comparison-${width}.png`),
      fullPage: true,
    });
    await comparison.getByRole("button", { name: "Close modal", exact: true }).click();
    await page
      .getByRole("button", { name: "Send requests", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Send requests", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1);
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    await page.screenshot({
      path: resolve(screenshots, `send-${width}.png`),
      fullPage: true,
    });
    const continueButton = page.getByRole("button", { name: "Continue to review", exact: true });
    const selectionBounds = await page.getByRole("dialog").boundingBox();
    const continueBounds = await continueButton.boundingBox();
    assert(continueBounds.y + continueBounds.height <= selectionBounds.y + selectionBounds.height, "Continue remains inside the dialog viewport");
    await continueButton.click();
    await page.getByRole("dialog", { name: "Review text messages", exact: true }).waitFor();
    const sendButton = page.getByRole("button", { name: "Send 28 messages", exact: true });
    await sendButton.waitFor();
    await page.getByText("View message", { exact: true }).first().click();
    await page.getByText("Please share your availability: https://example.test/private/member-1", { exact: true }).waitFor();
    const reviewBounds = await page.getByRole("dialog").boundingBox();
    const sendBounds = await sendButton.boundingBox();
    assert(sendBounds.y + sendBounds.height <= reviewBounds.y + reviewBounds.height, "Send remains inside the dialog viewport");
    await page.screenshot({ path: resolve(screenshots, `review-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(await page.getByRole("checkbox", { name: "John Davis", exact: true }).isChecked(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(dispatches, 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `Availability workspace desktop/mobile checks passed. Screenshots: ${screenshots}`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
