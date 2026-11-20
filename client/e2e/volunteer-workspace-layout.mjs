import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { build, preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const outDir = resolve(root, "node_modules/.cache/volunteer-workspace-build");
const screenshots = resolve(root, "node_modules/.cache/volunteer-workspace-screenshots");
await mkdir(screenshots, { recursive: true });

const options = {
  configFile: false,
  root,
  plugins: [
    {
      name: "volunteer-workspace-browser-fixture",
      enforce: "pre",
      load(id) {
        const path = id.replaceAll("\\", "/");
        if (path.endsWith("/src/hooks/index.ts")) {
          return `const state={undoable:{present:{preferences:{scrollbarWidth:'8px'},item:{hasPendingUpdate:false},itemList:{hasPendingUpdate:false},overlay:{hasPendingUpdate:false},overlays:{hasPendingUpdate:false},overlayTemplates:{hasPendingUpdate:false}}},autosaveIndicator:{debouncedSaveDepth:{}}};
            export const useSelector=(selector)=>selector(state);
            export const useDispatch=()=>()=>{};
            export const useWindowWidth=()=>1280;
            export const useSyncRemoteTimers=()=>{};
            export const useSyncMonitorSettings=()=>{};
            export const useSyncOnReconnect=()=>{};
            export const useMediaSelection=()=>null;
            export const useFirebaseValueWithRetry=()=>({value:null,loading:false,error:null});`;
        }
        if (path.endsWith("/src/context/toastContext.tsx")) {
          return `export const useToast=()=>({showToast:()=>"fixture-toast",removeToast:()=>{}});
            export const ToastProvider=({children})=>children;`;
        }
      },
    },
    react(),
  ],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, "e2e/volunteer-workspace-fixture.html") },
  },
};

await build(options);
const server = await preview({
  ...options,
  preview: { host: "127.0.0.1", port: 3131, strictPort: true },
});
const browser = await chromium.launch({ headless: true });

const viewportCases = [
  { width: 375, height: 760, label: "mobile-375" },
  { width: 390, height: 844, label: "mobile-390" },
  { width: 768, height: 900, label: "tablet-768" },
  { width: 1024, height: 900, label: "tablet-1024" },
  { width: 1280, height: 900, label: "desktop-1280" },
  { width: 1440, height: 960, label: "desktop-1440" },
  { width: 1920, height: 1080, label: "desktop-1920" },
];

const scheduleResponse = {
  success: true,
  serviceTimeZone: "America/New_York",
  member: {
    memberId: "fixture-member",
    churchId: "fixture-church",
    firstName: "Jordan",
    lastName: "Ray",
    blockoutDates: [],
    updatedAt: "2098-01-01T00:00:00.000Z",
  },
  occurrences: Array.from({ length: 8 }, (_, index) => {
    const startsAt = new Date(Date.UTC(2099, 10, 1 + index * 7, 15)).toISOString();
    return {
      occurrenceId: `fixture-service-${index + 1}@${startsAt}`,
      serviceIds: [`fixture-service-${index + 1}`],
      name: index === 0 ? "Sabbath Service & Second Worship Gathering with Guest Musicians" : `Fixture Service ${index + 1}`,
      date: startsAt.slice(0, 10),
      startsAt,
      serving: [{ memberId: "fixture-member", name: "Jordan Ray", isMe: true, scheduleId: `schedule-${index + 1}`, teamId: "media", teamName: "Media", positionId: "camera", positionName: "Camera - Stationary and Shoulder Rig (Long Position Name)", columnKey: `camera::${index}`, isPrimary: true, response: "pending" }],
      plan: null,
    };
  }),
};

const availabilityRead = {
  success: true,
  serviceTimeZone: "America/New_York",
  requests: [{
    recipientId: "fixture-recipient",
    formId: "fixture-form",
    name: "November Availability",
    responseDeadline: "2099-11-01",
    availabilityMessage: "Please respond for each service date.",
    respondedAt: "",
    submissionId: "",
    editable: true,
    occurrences: [
      { occurrenceId: "group:1jrege3bu2c6hs0lrc7c@2026-11-07", responseOccurrenceIds: ["group:1jrege3bu2c6hs0lrc7c@2026-11-07", "1j8r6dqu4anb91e4jac8@2026-11-07"], name: "Sabbath Service & 2nd service", startsAt: "2026-11-07T14:00:00.000Z", serviceDate: "2026-11-07" },
      ...Array.from({ length: 6 }, (_, index) => {
        const startsAt = new Date(Date.UTC(2099, 10, 14 + index * 7, 15)).toISOString();
        return {
          occurrenceId: `fixture-availability-${index + 1}@${startsAt.slice(0, 10)}`,
          name: index === 0 ? "Sabbath Service with a Long Guest Musician and Volunteer Team Name" : `Fixture Availability Service ${index + 1}`,
          startsAt,
          serviceDate: startsAt.slice(0, 10),
        };
      }),
    ],
    availability: {},
    unansweredOccurrenceIds: [],
    availabilityRevision: {},
  }],
};
availabilityRead.requests[0].unansweredOccurrenceIds = availabilityRead.requests[0].occurrences.map(({ occurrenceId }) => occurrenceId);
availabilityRead.requests[0].availabilityRevision = Object.fromEntries(availabilityRead.requests[0].occurrences.flatMap(({ occurrenceId, responseOccurrenceIds }) =>
  (responseOccurrenceIds?.length ? responseOccurrenceIds : [occurrenceId]).map((id) => [id, 0]),
));

const openFixture = async (page, mode, path, errors = []) => {
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/my-team-assignments")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scheduleResponse) });
    }
    if (url.includes("/my-availability") || url.includes("/volunteer/availability")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(availabilityRead) });
    }
    if (url.includes("/my-assignments/accept-pending")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, newlyAccepted: 0, alreadyAccepted: 0, alreadyDeclined: 0, skipped: 0, failedScheduleCount: 0, schedules: [], authorizationChanged: false, hasMore: false, nextCursor: null }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  const url = `http://127.0.0.1:3131/e2e/volunteer-workspace-fixture.html?mode=${mode}#${path}`;
  await page.goto(url);
  try {
    await page.getByTestId("volunteer-workspace-scrollport").waitFor();
    await page.getByTestId("app-workspace-title").waitFor();
  } catch (error) {
    const body = (await page.locator("body").innerText()).slice(0, 1200);
    throw new Error(`Fixture failed to show workspace (${mode} ${path}; url=${page.url()}; pageErrors=${errors.join(" | ")}; body=${body}); ${error.message}`);
  }
};

const inspectLayout = async (page, viewport, mode, activePage) => {
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector("[data-volunteer-workspace]");
    const sidebar = document.querySelector("[data-testid='volunteer-desktop-sidebar']");
    const scrollport = document.querySelector("[data-testid='volunteer-workspace-scrollport']");
    const bottomNavigation = document.querySelector("[data-testid='volunteer-mobile-bottom-navigation']");
    if (!(workspace instanceof HTMLElement) || !(sidebar instanceof HTMLElement) || !(scrollport instanceof HTMLElement) || !(bottomNavigation instanceof HTMLElement)) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      workspace: box(workspace),
      sidebar: box(sidebar),
      scrollport: box(scrollport),
      scrollportClientWidth: scrollport.clientWidth,
      scrollportScrollWidth: scrollport.scrollWidth,
      overflowCandidates: Array.from(scrollport.querySelectorAll("*"))
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          return element.scrollWidth > element.clientWidth + 1 || rect.right > scrollport.getBoundingClientRect().right + 1;
        })
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          left: Math.round(element.getBoundingClientRect().left),
          right: Math.round(element.getBoundingClientRect().right),
        })),
      sidebarDisplay: getComputedStyle(sidebar).display,
      bottomNavigation: box(bottomNavigation),
      bottomNavigationPosition: getComputedStyle(bottomNavigation).position,
    bottomNavigationClass: bottomNavigation.getAttribute("class") || "",
    };
  });
  assert(layout, `${mode} ${activePage}: workspace elements are present`);
  assert(layout.documentWidth <= layout.viewportWidth, `${mode} ${activePage}: document has no horizontal overflow at ${viewport.width}px (${layout.documentWidth}px)`);
  assert(layout.scrollportScrollWidth <= layout.scrollportClientWidth + 1, `${mode} ${activePage}: main content has no horizontal overflow at ${viewport.width}px (${layout.scrollportScrollWidth}px > ${layout.scrollportClientWidth}px; candidates ${JSON.stringify(layout.overflowCandidates)})`);
  assert(Math.abs(layout.workspace.left) <= 1, `${mode} ${activePage}: workspace is aligned to the available viewport edge`);
  assert(Math.abs(layout.workspace.width - viewport.width) <= 1, `${mode} ${activePage}: outer workspace spans the viewport`);
  if (viewport.width >= 1024) {
    assert.equal(layout.sidebarDisplay, "flex", `${mode} ${activePage}: desktop sidebar is visible`);
    assert(Math.abs(layout.sidebar.left) <= 1, `${mode} ${activePage}: sidebar begins at the viewport's left edge`);
    assert(layout.scrollport.left >= layout.sidebar.right - 1, `${mode} ${activePage}: sidebar and main content do not overlap`);
    assert(layout.scrollport.height >= layout.sidebar.height - 1, `${mode} ${activePage}: main and sidebar share the full workspace height`);
  } else {
    assert.equal(layout.sidebarDisplay, "none", `${mode} ${activePage}: mobile uses bottom navigation`);
    assert.equal(layout.bottomNavigationPosition, "fixed", `${mode} ${activePage}: bottom navigation remains fixed`);
    assert(layout.bottomNavigation.top < viewport.height, `${mode} ${activePage}: bottom navigation remains visible`);
    assert(layout.bottomNavigationClass.includes("pb-[env(safe-area-inset-bottom)]"), `${mode} ${activePage}: bottom navigation includes safe-area padding`);
  }
};

try {
  for (const mode of ["accountless", "signed-in"]) {
    for (const viewport of viewportCases) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

      await openFixture(page, mode, mode === "accountless" ? "/s?view=schedule" : "/my-schedule", errors);
      await page.getByRole("button", { name: /Open Sabbath Service/ }).waitFor();
      await inspectLayout(page, viewport, mode, "My Schedule");
      const scheduleScreenshot = mode === "accountless" ? "accountless" : "signed-in";
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({ path: resolve(screenshots, `my-schedule-${scheduleScreenshot}-${viewport.label}.png`), fullPage: true });
      }

      if (viewport.width >= 1024) {
        const sidebar = page.getByTestId("volunteer-desktop-sidebar");
        const scrollport = page.getByTestId("volunteer-workspace-scrollport");
        const sidebarBeforeScroll = await sidebar.boundingBox();
        const scrollCapacity = await scrollport.evaluate((element) => element.scrollHeight - element.clientHeight);
        if (scrollCapacity > 1) {
          await scrollport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          await page.waitForFunction(() => {
            const element = document.querySelector("[data-testid='volunteer-workspace-scrollport']");
            return Boolean(element && element.scrollTop > 0);
          });
          const sidebarAfterScroll = await sidebar.boundingBox();
          assert(
            sidebarBeforeScroll && sidebarAfterScroll &&
              Math.abs(sidebarBeforeScroll.y - sidebarAfterScroll.y) <= 1 &&
              Math.abs(sidebarBeforeScroll.height - sidebarAfterScroll.height) <= 1,
            `${mode} ${viewport.label}: sidebar stays fixed while main content scrolls`,
          );
          await scrollport.evaluate((element) => { element.scrollTop = 0; });
        }
        const collapse = page.getByRole("button", { name: "Collapse sections" });
        const sidebarBounds = await sidebar.boundingBox();
        const collapseBounds = await collapse.boundingBox();
        assert(sidebarBounds && collapseBounds && collapseBounds.x >= sidebarBounds.x && collapseBounds.x + collapseBounds.width <= sidebarBounds.x + sidebarBounds.width, `${mode} ${viewport.label}: collapse control stays visible inside the sidebar`);
        const initialSidebarWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
        assert(initialSidebarWidth >= 170, `${mode} ${viewport.label}: expanded sidebar shows its labels`);
        await collapse.click();
        await page.waitForFunction(() => document.querySelector("[data-testid='volunteer-desktop-sidebar']")?.getBoundingClientRect().width === 56);
        assert(await page.getByRole("link", { name: "My Availability" }).first().getAttribute("title") === "My Availability", `${mode} ${viewport.label}: collapsed link retains an accessible tooltip`);
        assert.equal(await page.getByRole("button", { name: "Expand sections" }).getAttribute("aria-expanded"), "false");
      }

      const desktopOrMobileNavigation = page.getByRole("navigation", { name: "Volunteer pages" }).last();
      await desktopOrMobileNavigation.getByRole("link", { name: "My Availability" }).click();
      await page.getByRole("button", { name: "Open November Availability" }).waitFor();
      await inspectLayout(page, viewport, mode, "My Availability");
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({ path: resolve(screenshots, `my-availability-${scheduleScreenshot}-${viewport.label}.png`), fullPage: true });
      }
      if (viewport.width >= 1024) {
        assert.equal(await page.getByRole("button", { name: "Expand sections" }).getAttribute("aria-expanded"), "false", `${mode} ${viewport.label}: collapsed sidebar presentation persists across sections`);
      }

      await page.getByRole("button", { name: "Open November Availability" }).click();
      const groupedCard = page.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ });
      await groupedCard.waitFor();
      const groupedBounds = await groupedCard.evaluate((element) => {
        const label = element.closest("label");
        if (!label) return null;
        const rect = label.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert(groupedBounds && groupedBounds.height >= 76, `${mode} ${viewport.label}: availability card has a touch-friendly target`);
      if (viewport.width < 640) {
        assert(groupedBounds.width >= viewport.width * 0.8, `${mode} ${viewport.label}: availability card uses most of the narrow content column`);
      } else {
        assert(groupedBounds.width >= 288 && groupedBounds.width <= 560, `${mode} ${viewport.label}: availability cards keep a comfortable desktop width`);
      }
      const longCard = page.getByRole("checkbox", { name: /Long Guest Musician and Volunteer Team Name/ });
      assert(await longCard.count() === 1, `${mode} ${viewport.label}: long availability service name remains readable`);
      assert(await page.getByText(/\d+ past/).count() >= 1, `${mode} ${viewport.label}: past availability dates are grouped compactly`);
      await inspectLayout(page, viewport, mode, "My Availability editor");
      const firstSelection = page.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ });
      const firstSelectionCard = firstSelection.locator("xpath=ancestor::label[1]");
      await firstSelectionCard.click({ position: { x: groupedBounds.width - 8, y: groupedBounds.height / 2 } });
      assert(await firstSelection.isChecked(), `${mode} ${viewport.label}: clicking the card surface changes its checkbox`);
      assert((await firstSelectionCard.getAttribute("class") || "").includes("border-teal-400/70"), `${mode} ${viewport.label}: selected state is visible on the whole card`);
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({ path: resolve(screenshots, `my-availability-cards-${scheduleScreenshot}-${viewport.label}.png`), fullPage: true });
      }
      await page.getByRole("button", { name: "By service" }).click();
      assert(await page.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ }).isChecked(), `${mode} ${viewport.label}: switching organization preserves answer IDs`);
      assert.equal(await page.getByRole("checkbox").count(), 7, `${mode} ${viewport.label}: proven duplicate aliases appear as one service`);
      await page.getByRole("button", { name: "By date" }).click();
      assert(await page.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ }).isChecked(), `${mode} ${viewport.label}: switching back preserves selected answers`);

      const nav = page.getByRole("navigation", { name: "Volunteer pages" }).last();
      await nav.getByRole("link", { name: "My Schedule" }).click();
      const unsaved = page.getByRole("dialog", { name: "Unsaved changes" });
      await unsaved.waitFor();
      await unsaved.getByRole("button", { name: "Stay" }).click();
      assert(await page.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ }).isChecked(), `${mode} ${viewport.label}: canceled navigation keeps the response draft`);
      const historyBefore = await page.evaluate(() => ({
        href: window.location.href,
        hash: window.location.hash,
        state: window.history.state,
        length: window.history.length,
      }));
      await page.evaluate(() => {
        window.__volunteerPopEvents = [];
        window.addEventListener("popstate", (event) => {
          window.__volunteerPopEvents.push({ href: window.location.href, state: event.state });
        }, true);
        window.history.back();
      });
      const historyWarning = page.getByRole("dialog", { name: "Unsaved changes" });
      try {
        await historyWarning.waitFor({ timeout: 4000 });
      } catch (error) {
        const historyAfter = await page.evaluate(() => ({
          href: window.location.href,
          hash: window.location.hash,
          state: window.history.state,
          length: window.history.length,
          pops: window.__volunteerPopEvents,
        }));
        throw new Error(`Browser Back didn't show the draft guard (${mode} ${viewport.label}; before=${JSON.stringify(historyBefore)} after=${JSON.stringify(historyAfter)}); ${error.message}`);
      }
      assert(mode === "accountless" ? page.url().includes("view=availability") : page.url().includes("/my-availability"), `${mode} ${viewport.label}: browser Back remains on the current availability route`);
      await historyWarning.getByRole("button", { name: "Stay" }).click();
      assert(await page.getByRole("checkbox", { name: /Sabbath Service & 2nd service/ }).isChecked(), `${mode} ${viewport.label}: canceled browser Back keeps the response draft`);

      await page.getByRole("button", { name: "Open menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("link", { name: "My Schedule" }).click();
      const menuWarning = page.getByRole("dialog", { name: "Unsaved changes" });
      await menuWarning.waitFor();
      await menuWarning.getByRole("button", { name: "Stay" }).click();
      await menuWarning.waitFor({ state: "hidden" });
      assert(mode === "accountless" ? page.url().includes("view=availability") : page.url().includes("/my-availability"), `${mode} ${viewport.label}: canceled menu navigation stays on My Availability`);
      if (!(await menu.isVisible())) await page.getByRole("button", { name: "Open menu" }).click();

      await menu.getByRole("link", { name: "My Schedule" }).click();
      await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Discard changes" }).click();
      await page.getByRole("button", { name: /Open Sabbath Service/ }).waitFor();

      if (viewport.width < 1024) {
        const menuButton = page.getByRole("button", { name: "Open menu" });
        await menuButton.click();
        const menu = page.getByRole("dialog", { name: "Menu" });
        await menu.getByRole("link", { name: "My Availability" }).click();
        await page.getByRole("button", { name: "Open November Availability" }).waitFor();
      }

      if (mode === "accountless" && viewport.width === 1440) {
        await page.evaluate(() => { document.documentElement.style.zoom = "80%"; });
        await page.waitForTimeout(150);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "accountless 80% zoom: document has no horizontal overflow");
      }

      assert.deepEqual(errors, [], `${mode} ${viewport.label}: no browser errors`);
      console.log(`PASS ${mode} volunteer workspace at ${viewport.label}`);
      await page.close();
    }
  }
  console.log(`Volunteer workspace layout and interaction checks passed. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
