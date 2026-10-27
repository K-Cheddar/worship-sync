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
  const scenarios = [
    { label: "desktop-short", width: 1280, height: 800, memberCount: 30 },
    { label: "mobile-short", width: 375, height: 640, memberCount: 30 },
    { label: "mobile-long", width: 375, height: 640, memberCount: 65 },
  ];
  for (const { label, width, height, memberCount } of scenarios) {
    const page = await browser.newPage({ viewport: { width, height } });
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
      `http://127.0.0.1:3126/e2e/availability-workspace-fixture.html${width < 640 ? `?missingPurpose${memberCount > 50 ? "&longList" : ""}` : ""}`,
    );
    await page
      .getByRole("button", { name: "Edit October Availability", exact: true })
      .click();
    await page.getByRole("region", { name: "Volunteers", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab").count(), 0);
    assert.equal(await page.getByRole("checkbox").count(), 0);
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuetext"), `1 of ${memberCount} responded`);
    assert.equal(await page.getByRole("button", { name: "Send requests", exact: true }).getAttribute("data-variant"), "presentCta");
    await page.screenshot({
      path: resolve(screenshots, `volunteers-${label}.png`),
      fullPage: true,
    });
    if (width < 640) {
      const mobileLayout = await page.evaluate(() => {
        const list = document.querySelector("ul[aria-label='Availability volunteers']");
        const scroller = document.querySelector("[data-testid='teams-page-scroll']");
        const navigation = document.querySelector("[data-testid='teams-bottom-navigation']");
        if (!(list instanceof HTMLElement) || !(scroller instanceof HTMLElement) || !(navigation instanceof HTMLElement)) return null;
        return {
          listClientHeight: list.clientHeight,
          listScrollHeight: list.scrollHeight,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          scrollBottom: scroller.getBoundingClientRect().bottom,
          navigationTop: navigation.getBoundingClientRect().top,
        };
      });
      assert(mobileLayout, "Mobile Teams scroll containers are present");
      assert(mobileLayout.listScrollHeight <= mobileLayout.listClientHeight + 1, "Mobile volunteer rows do not create a nested vertical scroll area");
      assert(mobileLayout.scrollHeight > mobileLayout.clientHeight, "The Teams page scroll container owns vertical scrolling");
      assert(mobileLayout.scrollBottom <= mobileLayout.navigationTop, "The page scroll area ends above the bottom navigation");
    } else {
      const desktopTable = page.getByRole("table", { name: "Availability volunteers" });
      const desktopScrollArea = desktopTable.locator("xpath=../..");
      const desktopLayout = await desktopScrollArea.evaluate((element) => ({
        maxHeight: getComputedStyle(element).maxHeight,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      assert(Math.abs(Number.parseFloat(desktopLayout.maxHeight) - height * 0.58) < 1, "Desktop volunteer table retains its 58vh limit");
      assert(desktopLayout.scrollHeight > desktopLayout.clientHeight, "Desktop volunteer table keeps its own scrolling");
    }
    if (width < 640) {
      const volunteerList = page.getByRole("list", { name: "Availability volunteers" });
      const search = page.getByRole("textbox", { name: "Search volunteers" });
      await search.fill("Mary Wilson");
      assert.equal(await volunteerList.getByRole("listitem").count(), 1, "Searching narrows the volunteer list");
      await search.fill("");
      const statusFilter = page.getByRole("combobox", { name: "Response/request status" });
      await statusFilter.click();
      await page.getByRole("option", { name: "Responded", exact: true }).click();
      await volunteerList.getByText("Jane Smith", { exact: true }).waitFor();
      assert.equal(await volunteerList.getByRole("listitem").count(), 1, "Status filtering narrows the volunteer list");
      await statusFilter.click();
      await page.getByRole("option", { name: "All statuses", exact: true }).click();
      const teamFilter = page.getByRole("combobox", { name: "Team" });
      await teamFilter.click();
      await page.getByRole("option", { name: "Praise Team", exact: true }).click();
      await volunteerList.getByText("Mary Wilson", { exact: true }).waitFor();
      assert.equal(await volunteerList.getByRole("listitem").count(), Math.min(memberCount, 50), "Team filtering retains matching volunteers");
      await teamFilter.click();
      await page.getByRole("option", { name: "All teams", exact: true }).click();
      await volunteerList.getByText("Jane Smith", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Actions for John Davis", exact: true }).click();
      await page.getByRole("menuitem", { name: "View request and delivery history" }).click();
      await page.getByRole("dialog", { name: /Request history/ }).waitFor();
      await page.getByRole("button", { name: "Close modal" }).click();
    }
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
      path: resolve(screenshots, `answers-${label}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "View availability by date", exact: true }).click();
    const comparison = page.getByRole("dialog", { name: "Availability by date", exact: true });
    await comparison.waitFor();
    await comparison.getByRole("combobox", { name: /Service date/ }).click();
    await page.getByRole("option", { name: /October 11, 2026/ }).click();
    await comparison.getByRole("listitem", { name: "Jane Smith: Unavailable", exact: true }).waitFor();
    await page.screenshot({
      path: resolve(screenshots, `comparison-${label}.png`),
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
      path: resolve(screenshots, `send-${label}.png`),
      fullPage: true,
    });
    const continueButton = page.getByRole("button", { name: "Continue to review", exact: true });
    const selectionBounds = await page.getByRole("dialog").boundingBox();
    const continueBounds = await continueButton.boundingBox();
    assert(continueBounds.y + continueBounds.height <= selectionBounds.y + selectionBounds.height, "Continue remains inside the dialog viewport");
    await continueButton.click();
    await page.getByRole("dialog", { name: "Review text messages", exact: true }).waitFor();
    const sendButton = page.getByRole("button", { name: `Send ${memberCount - 2} messages`, exact: true });
    await sendButton.waitFor();
    await page.getByText("View message", { exact: true }).first().click();
    await page.getByText("Please share your availability: https://example.test/private/member-1", { exact: true }).waitFor();
    const reviewBounds = await page.getByRole("dialog").boundingBox();
    const sendBounds = await sendButton.boundingBox();
    assert(sendBounds.y + sendBounds.height <= reviewBounds.y + reviewBounds.height, "Send remains inside the dialog viewport");
    await page.screenshot({ path: resolve(screenshots, `review-${label}.png`), fullPage: true });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Change recipients", exact: true }).click();
    assert.equal(await page.getByRole("checkbox", { name: "John Davis", exact: true }).isChecked(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(dispatches, 0);
    if (width < 640) {
      const volunteerList = page.getByRole("list", { name: "Availability volunteers" });
      if (memberCount > 50) {
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await volunteerList.getByText("Volunteer 65", { exact: true }).waitFor();
      } else {
        await volunteerList.getByText("Volunteer 30", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Next", exact: true }).count(), 0);
      }
      await page.evaluate(() => {
        const scroller = document.querySelector("[data-testid='teams-page-scroll']");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      const bottomLayout = await page.evaluate(() => {
        const scroller = document.querySelector("[data-testid='teams-page-scroll']");
        const navigation = document.querySelector("[data-testid='teams-bottom-navigation']");
        const workspace = document.querySelector("section[aria-label='October Availability workspace']");
        const list = document.querySelector("ul[aria-label='Availability volunteers']");
        const paginationButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Next");
        const lastRow = list?.lastElementChild instanceof HTMLElement ? list.lastElementChild : null;
        if (!scroller || !navigation || !workspace || !list || !lastRow) return null;
        const controls = paginationButton || lastRow;
        return {
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          navigationTop: navigation.getBoundingClientRect().top,
          scrollBottom: scroller.getBoundingClientRect().bottom,
          workspaceBottom: workspace.getBoundingClientRect().bottom,
          controlsBottom: controls.getBoundingClientRect().bottom,
          rowBottom: lastRow.getBoundingClientRect().bottom,
          background: getComputedStyle(workspace).backgroundColor,
        };
      });
      assert(bottomLayout, "Mobile workspace and list remain mounted");
      assert(bottomLayout.scrollTop > 0, "The Teams page container scrolls to the end of the workspace");
      assert(bottomLayout.scrollHeight > bottomLayout.clientHeight, "The mobile workspace remains in the page scroll flow");
      assert(bottomLayout.scrollBottom <= bottomLayout.navigationTop, "The bottom of the page scroll area remains above navigation");
      assert(bottomLayout.rowBottom <= bottomLayout.scrollBottom, "The final volunteer row can scroll above bottom navigation");
      assert(bottomLayout.controlsBottom <= bottomLayout.scrollBottom, "Pagination controls remain accessible above bottom navigation");
      assert(bottomLayout.workspaceBottom - bottomLayout.controlsBottom >= 12, "Workspace padding remains below the final row and pagination");
      assert.notEqual(bottomLayout.background, "rgba(0, 0, 0, 0)", "The volunteer rows remain inside the rounded workspace background");
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `Availability workspace desktop and mobile short/long-list checks passed. Screenshots: ${screenshots}`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
