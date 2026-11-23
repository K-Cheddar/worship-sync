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

const availabilityRequest = {
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
  availability: { "group:1jrege3bu2c6hs0lrc7c@2026-11-07": "available" },
  unansweredOccurrenceIds: [],
  availabilityRevision: {},
};
availabilityRequest.unansweredOccurrenceIds = availabilityRequest.occurrences
  .map(({ occurrenceId }) => occurrenceId)
  .filter((occurrenceId) => occurrenceId !== "group:1jrege3bu2c6hs0lrc7c@2026-11-07");
availabilityRequest.availabilityRevision = Object.fromEntries(availabilityRequest.occurrences.flatMap(({ occurrenceId, responseOccurrenceIds }) =>
  (responseOccurrenceIds?.length ? responseOccurrenceIds : [occurrenceId]).map((id) => [id, 0]),
));

const requestSummary = {
  recipientId: availabilityRequest.recipientId,
  formId: availabilityRequest.formId,
  name: availabilityRequest.name,
  responseDeadline: availabilityRequest.responseDeadline,
  respondedAt: availabilityRequest.respondedAt,
  submissionId: availabilityRequest.submissionId,
  editable: availabilityRequest.editable,
};
const schedulingPreferences = {
  servingFrequency: "twice_monthly",
  recurringAvailability: { weeksOfMonth: [1, 3], includeLastWeekOfMonth: false },
  updatedAt: "preference-revision",
};

const openFixture = async (page, mode, path, errors = []) => {
  const availabilityReads = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/my-team-assignments")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scheduleResponse) });
    }
    if (url.pathname.includes("/my-availability") || url.pathname.includes("/volunteer/availability")) {
      const recipientId = url.searchParams.get("recipientId");
      const history = url.searchParams.get("history") === "1";
      const summary = url.searchParams.get("summary") === "1";
      availabilityReads.push({ recipientId, history, summary });
      const body = recipientId
        ? { success: true, serviceTimeZone: "America/New_York", requests: [availabilityRequest] }
        : {
            success: true,
            serviceTimeZone: "America/New_York",
            requests: [],
            requestSummaries: history ? [] : [requestSummary],
            schedulingPreferences,
          };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (url.pathname.includes("/my-assignments/accept-pending")) {
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
  return availabilityReads;
};

const inspectLayout = async (page, viewport, mode, state) => {
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector("[data-volunteer-workspace]");
    const scrollport = document.querySelector("[data-testid='volunteer-workspace-scrollport']");
    if (!(workspace instanceof HTMLElement) || !(scrollport instanceof HTMLElement)) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      workspace: box(workspace),
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
        .map((element) => ({ tag: element.tagName.toLowerCase(), className: typeof element.className === "string" ? element.className : "", clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, right: Math.round(element.getBoundingClientRect().right) })),
      hasVolunteerNavigation: Boolean(document.querySelector("[data-testid='volunteer-desktop-sidebar'], [data-testid='volunteer-mobile-bottom-navigation']")),
      scrollportClass: scrollport.getAttribute("class") || "",
    };
  });
  assert(layout, `${mode} ${state}: workspace elements are present`);
  assert(layout.documentWidth <= layout.viewportWidth, `${mode} ${state}: document has no horizontal overflow at ${viewport.width}px (${layout.documentWidth}px)`);
  assert(layout.scrollportScrollWidth <= layout.scrollportClientWidth + 1, `${mode} ${state}: workspace has no horizontal overflow at ${viewport.width}px (${layout.scrollportScrollWidth}px > ${layout.scrollportClientWidth}px; ${JSON.stringify(layout.overflowCandidates)})`);
  assert(Math.abs(layout.workspace.left) <= 1, `${mode} ${state}: workspace aligns with the viewport`);
  assert(Math.abs(layout.workspace.width - viewport.width) <= 1, `${mode} ${state}: workspace spans the viewport`);
  assert.equal(layout.hasVolunteerNavigation, false, `${mode} ${state}: volunteer-specific sidebar and bottom navigation are absent`);
  assert(layout.scrollportClass.includes("env(safe-area-inset-bottom)"), `${mode} ${state}: scroll area reserves mobile safe-area space`);
  assert.equal(await page.getByRole("navigation", { name: "Volunteer pages" }).count(), 0, `${mode} ${state}: volunteer page navigation is absent`);
};

try {
  for (const mode of ["accountless", "signed-in"]) {
    for (const viewport of viewportCases) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

      const schedulePath = mode === "accountless" ? "/s?view=schedule" : "/my-schedule";
      const availabilityReads = await openFixture(page, mode, schedulePath, errors);
      await page.getByRole("button", { name: /Open Sabbath Service/ }).waitFor();
      await page.getByRole("heading", { name: "Scheduling preferences" }).waitFor();
      await page.getByRole("button", { name: "Respond November Availability" }).waitFor();
      await inspectLayout(page, viewport, mode, "unified schedule");
      assert.equal(availabilityReads.length, 1, `${mode} ${viewport.label}: one initial availability read`);
      assert.deepEqual(availabilityReads[0], { recipientId: null, history: false, summary: true }, `${mode} ${viewport.label}: startup uses only the active summary`);
      const editPreferences = page.getByRole("button", { name: "Edit preferences" });
      await editPreferences.click();
      const servingFrequency = page.getByRole("combobox", { name: "Serving frequency" });
      assert.equal(await servingFrequency.evaluate((element) => document.activeElement === element), true, `${mode} ${viewport.label}: opening preferences focuses the first field`);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await editPreferences.evaluate((element) => document.activeElement === element), true, `${mode} ${viewport.label}: closing preferences restores focus to its trigger`);
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({ path: resolve(screenshots, `unified-schedule-${mode}-${viewport.label}.png`), fullPage: true });
      }

      const availabilityCard = page.getByRole("button", { name: "Respond November Availability" });
      const availabilityCardBounds = await availabilityCard.boundingBox();
      assert(availabilityCardBounds && availabilityCardBounds.height >= 44, "Availability request cards have touch-friendly height");
      await availabilityCard.click();
      const editorHeading = page.getByRole("heading", { name: "November Availability" });
      await editorHeading.waitFor();
      assert.equal(await editorHeading.evaluate((element) => document.activeElement === element), true, `${mode} ${viewport.label}: opening an availability request focuses its heading`);
      assert.deepEqual(availabilityReads[1], { recipientId: "fixture-recipient", history: false, summary: false }, `${mode} ${viewport.label}: opening a card loads only its recipient detail`);
      await inspectLayout(page, viewport, mode, "availability editor");

      const groupedAnswers = page.getByRole("radiogroup", { name: /Sabbath Service & 2nd service/ });
      const groupedAvailable = groupedAnswers.getByRole("radio", { name: "Available", exact: true });
      await groupedAvailable.waitFor();
      const groupedBounds = await groupedAvailable.evaluate((element) => {
        const label = element.closest("label");
        if (!label) return null;
        const rect = label.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert(groupedBounds && groupedBounds.height >= 44, "Availability answer choices have touch-friendly height");
      assert.equal(await page.getByRole("radiogroup", { name: /Long Guest Musician and Volunteer Team Name/ }).count(), 1, "Long service names remain readable");
      assert(await page.getByText(/\d+ past/).count() >= 1, `${mode} ${viewport.label}: past availability dates remain identified`);

      const groupedUnavailable = groupedAnswers.getByRole("radio", { name: "Unavailable", exact: true });
      await groupedUnavailable.focus();
      await page.keyboard.press("Space");
      assert(await groupedUnavailable.isChecked(), "Availability choices work from the keyboard");
      if (viewport.width === 1440 || viewport.width === 390) {
        await page.screenshot({ path: resolve(screenshots, `availability-editor-${mode}-${viewport.label}.png`), fullPage: true });
      }

      await page.getByRole("button", { name: "By service" }).click();
      assert(await page.getByRole("radiogroup", { name: /Sabbath Service & 2nd service/ })
        .getByRole("radio", { name: "Unavailable", exact: true }).isChecked(), "Organization changes preserve the answer");
      assert.equal(await page.getByRole("radiogroup").count(), 7, "Historical grouped aliases remain one answer");
      await page.getByRole("button", { name: "By date" }).click();

      await page.getByRole("button", { name: "Open menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("link", { name: "Home" }).click();
      const navigationWarning = page.getByRole("dialog", { name: "Unsaved changes" });
      await navigationWarning.waitFor();
      await navigationWarning.getByRole("button", { name: "Stay" }).click();
      await navigationWarning.waitFor({ state: "detached" });
      await menu.getByRole("button", { name: "Close" }).click();
      await menu.waitFor({ state: "detached" });
      assert(await page.getByRole("radiogroup", { name: /Sabbath Service & 2nd service/ })
        .getByRole("radio", { name: "Unavailable", exact: true }).isChecked(), "Canceling navigation keeps the response draft");
      await page.getByRole("button", { name: "Back to requests" }).click();
      const discardWarning = page.getByRole("dialog", { name: "Unsaved changes" });
      await discardWarning.getByRole("button", { name: "Discard changes" }).click();
      await availabilityCard.waitFor();
      await discardWarning.waitFor({ state: "detached" });
      assert.equal(await availabilityCard.evaluate((element) => document.activeElement === element), true, `${mode} ${viewport.label}: closing an availability request restores focus to its card`);

      if (viewport.width === 1440) {
        const historyAlias = mode === "accountless" ? "/s?view=availability" : "/my-availability";
        await page.evaluate((path) => { window.location.hash = path; }, historyAlias);
        await page.waitForFunction((path) => window.location.hash === `#${path}`, historyAlias);
        await page.goBack();
        await page.waitForFunction((path) => window.location.hash === `#${path}`, schedulePath);
        await page.goForward();
        await page.waitForFunction((path) => window.location.hash === `#${path}`, historyAlias);
        assert.equal(availabilityReads.length, 2, `${mode} ${viewport.label}: Back and Forward do not duplicate the availability summary request`);
      }

      const legacyAvailabilityPath = mode === "accountless"
        ? "/s?view=availability&availabilityRequest=fixture-recipient"
        : "/my-availability?availabilityRequest=fixture-recipient";
      const aliasReads = await openFixture(page, mode, legacyAvailabilityPath, errors);
      await page.getByRole("heading", { name: "November Availability" }).waitFor();
      assert(page.url().includes("availabilityRequest=fixture-recipient"), `${mode} ${viewport.label}: legacy availability deep link retains recipient context`);
      assert.deepEqual(aliasReads, [{ recipientId: "fixture-recipient", history: false, summary: false }], `${mode} ${viewport.label}: compatibility deep link loads only the selected request without a duplicate summary read`);
      await inspectLayout(page, viewport, mode, "availability compatibility route");

      if (mode === "accountless" && viewport.width === 1440) {
        await page.evaluate(() => { document.documentElement.style.zoom = "80%"; });
        await page.waitForTimeout(150);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "accountless 80% zoom: document has no horizontal overflow");
      }

      assert.deepEqual(errors, [], `${mode} ${viewport.label}: no browser errors`);
      console.log(`PASS ${mode} unified volunteer workspace at ${viewport.label}`);
      await page.close();
    }
  }
  console.log(`Unified volunteer workspace checks passed. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
