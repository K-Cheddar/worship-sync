import { build, createServer, preview, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Run from client/. This mounts the production Teams shell and real ScheduleTab
// in Chromium with deterministic local fixtures and no application API access.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "@playwright/test");
const root = process.cwd();

const fixture = [
  'import React, { Profiler } from "react";',
  'import { createRoot } from "react-dom/client";',
  'import { HashRouter, Route, Routes } from "react-router-dom";',
  'import TeamsAndServices from "/src/pages/Teams/TeamsAndServices";',
  'import { GlobalInfoContext } from "/src/context/globalInfo";',
  'import { ToastProvider } from "/src/context/toastContext";',
  'import "/src/index.css";',
  'window.__schedulesProfile = { longTasks: [], commits: [], memberDetailsMs: 0, memberDetailsCount: 0 };',
  'try { new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.__schedulesProfile.longTasks.push({ startTime: entry.startTime, duration: entry.duration }))).observe({ entryTypes: ["longtask"] }); } catch {}',
  'const onRender = (id, phase, actualDuration, baseDuration, startTime, commitTime) => window.__schedulesProfile.commits.push({ id, phase, actualDuration, startTime, commitTime });',
  'createRoot(document.getElementById("root")).render(',
  '  <GlobalInfoContext.Provider value={{ loginState: "loggedIn", churchId: "fixture-church", churchName: "Fixture Church", role: "admin" }}>',
  '    <ToastProvider><Profiler id="teams-shell" onRender={onRender}><HashRouter><Routes>',
  '      <Route path="/teams-and-services/*" element={<TeamsAndServices />} />',
  '      <Route path="/home" element={<div>Home</div>} />',
  '    </Routes></HashRouter></Profiler></ToastProvider>',
  '  </GlobalInfoContext.Provider>',
  ');',
].join("\n");

const schedulesPage = [
  'import React, { Profiler } from "react";',
  'import ScheduleTab from "/src/pages/Teams/schedule/ScheduleTab";',
  'import { useTeamsPage } from "/src/pages/Teams/TeamsPageContext";',
  'window.__schedulesPageModuleLoaded = true; window.__schedulesModuleReadyAt = performance.now();',
  'const onScheduleRender = (id, phase, actualDuration, baseDuration, startTime, commitTime) => window.__schedulesProfile.commits.push({ id, phase, actualDuration, startTime, commitTime });',
  'const noop = () => {};',
  'export default React.memo(function TeamsSchedulesPage() {',
  '  const state = useTeamsPage();',
  '  return <Profiler id="ScheduleTab" onRender={onScheduleRender}><ScheduleTab data={state.pageData} serviceTimeZone={state.serviceTimeZone} canEdit={true} editableTeamIds={state.editableTeamIds} canEditMember={() => true} selectedScheduleId="" setSelectedScheduleId={noop} scheduleDrafts={{}} onScheduleSaved={noop} onScheduleRemoved={noop} onMemberSaved={noop} onTeamSaved={noop} onScheduleDraftChanged={noop} onScheduleDraftFlush={noop} onScheduleDraftClear={noop} trackTeamsSave={(run) => run} onImported={noop} /></Profiler>;',
  '});',
].join("\n");

const genericPage = [
  'import React from "react";',
  'import { useLocation } from "react-router-dom";',
  'export default function FixturePage() { const { pathname } = useLocation(); return <main><h1>Fixture section</h1><p>{pathname}</p></main>; }',
].join("\n");

const schedulesPerformancePlugin = {
    name: "schedules-performance-fixture",
    enforce: "pre",
    resolveId(id) {
      if (id === "/schedules-performance-fixture.tsx") return "\0schedules-performance-fixture.tsx";
    },
    async load(id) {
      if (id === "\0schedules-performance-fixture.tsx") {
        return (await transformWithEsbuild(fixture, "schedules-performance-fixture.tsx", { loader: "tsx", jsx: "automatic" })).code;
      }
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/Teams/TeamsPageContext.tsx")) {
        return [
          'import { getAvailableTeamsNavSections } from "/src/pages/Teams/teamsNavSections";',
          'const members = Array.from({ length: 20 }, (_, index) => ({ memberId: "member-" + index, churchId: "fixture-church", firstName: "Member", lastName: String(index), positionIds: ["camera"], blockoutDates: [] }));',
          'const team = { teamId: "media", churchId: "fixture-church", name: "Media", memberIds: members.map((member) => member.memberId) };',
          'const position = { positionId: "camera", churchId: "fixture-church", teamId: "media", name: "Camera" };',
          'const service = { id: "weekly-service", serviceId: "weekly-service", churchId: "fixture-church", name: "Weekly service", timerType: "countdown", reccurence: "weekly", dayOfWeek: 0, time: "10:00", startDateISO: "2025-01-01", positionRequirements: [{ positionId: "camera", count: 1 }] };',
          'const services = [service];',
          'const schedules = Array.from({ length: 5 }, (_, scheduleIndex) => {',
          '  const year = 2021 + scheduleIndex;',
          '  const occurrences = [];',
          '  for (let date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1)) {',
          '    if (date.getUTCDay() !== 0) continue;',
          '    const plainDate = date.toISOString().slice(0, 10);',
          '    const startsAt = plainDate + "T10:00:00.000Z";',
          '    occurrences.push({ occurrenceId: "weekly-service@" + plainDate, logicalOccurrenceId: "weekly-service@" + plainDate, serviceId: "weekly-service", name: "Weekly service", startsAt, serviceDate: plainDate, positionRequirements: [{ positionId: "camera", count: 1 }] });',
          '    if (occurrences.length === 52) break;',
          '  }',
          '  const assignments = Object.fromEntries(occurrences.map((occurrence, index) => [occurrence.occurrenceId, { "camera::0": { primaryMemberId: "member-" + (index % members.length) } }]));',
          '  return { scheduleId: "history-" + year, churchId: "fixture-church", name: "History " + year, teamId: "media", startDate: year + "-01-01", endDate: year + "-12-31", serviceIds: ["weekly-service"], occurrences, assignments };',
          '});',
          'const pageData = { members, positions: [position], teams: [team], teamRoles: [], qualificationAreas: [], qualificationLevels: [], services, schedules, intakeForms: [], intakeSubmissions: [], intakeRecipients: [] };',
          'const availableNavSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: true, canViewServices: true });',
          'const state = { loading: false, accessDenied: false, canViewServices: true, pageData, churchId: "fixture-church", churchName: "Fixture Church", toolbarLogos: [], serviceTimeZone: "UTC", serviceTimeZoneStatus: "ready", availableNavSections, editableTeamIds: new Set(["media"]), canEditTeams: true, canEditAnyTeam: true, canEditTeam: () => true, editableMemberIds: new Set(members.map((member) => member.memberId)), selectedScheduleId: "", scheduleDrafts: {}, upsertData: () => {}, removeData: () => {}, trackTeamsSave: (run) => run, updateSelectedScheduleId: () => {}, updateScheduleDraft: () => {}, flushScheduleDraft: () => {}, clearScheduleDraft: () => {}, refresh: async () => {} };',
          'export const TeamsPageProvider = ({ children }) => children;',
          'export const useTeamsPage = () => state;',
        ].join("\n");
      }
      if (path.endsWith("/Teams/pages/TeamsSchedulesPage.tsx")) return schedulesPage;
      if (/\/Teams\/pages\/Teams\w+Page\.tsx$/.test(path)) return genericPage;
      if (path.endsWith("/context/controllerInfo.tsx")) return 'import { createContext } from "react"; export const ControllerInfoContext = createContext({});';
      if (path.endsWith("/context/globalInfo.tsx")) return 'import { createContext } from "react"; export const GlobalInfoContext = createContext({});';
      if (path.endsWith("/context/churchServiceTimeZone.tsx")) return 'export const useChurchServiceTimeZone = () => ({ timeZone: "UTC", isConfigured: true, status: "ready" });';
      if (path.endsWith("/ToolbarElements/UserSection.tsx")) return 'export default function UserSection() { return null; }';
      if (path.endsWith("/hooks/useAboutChangelogMenu.tsx")) return 'export const useAboutChangelogMenu = () => ({ aboutChangelogMenuItems: [], aboutChangelogModals: null, updateReadyVersion: "" });';
    },
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/ScheduleMembersPanel.tsx")) return;
      const measure = (expression) => `renderDetails={() => { const startedAt = performance.now(); const details = ${expression}; window.__schedulesProfile.memberDetailsMs += performance.now() - startedAt; window.__schedulesProfile.memberDetailsCount += 1; return details; }}`;
      return code
        .replaceAll("renderDetails={() => renderMemberDetails(member)}", measure("renderMemberDetails(member)"))
        .replaceAll("renderDetails={() => renderMemberDetails(row.member)}", measure("renderMemberDetails(row.member)"));
    },
    configureServer(viteServer) {
      viteServer.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/navigation-performance") return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await viteServer.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/schedules-performance-fixture.tsx"></script></body></html>'));
      });
    },
  };
const fixturePlugins = () => [schedulesPerformancePlugin, react()];
const server = await createServer({
  configFile: false,
  root,
  plugins: fixturePlugins(),
  optimizeDeps: {
    entries: ["src/pages/Teams/TeamsAndServices.tsx"],
  },
  resolve: { alias: { "@": resolve(root, "src") } },
  server: { host: "127.0.0.1", port: 3113, strictPort: true },
});

await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const localOrigin = "http://127.0.0.1:3113";
  await page.route("**/*", (route) => new URL(route.request().url()).origin === localOrigin
    ? route.continue()
    : route.abort("blockedbyclient"));
  await page.goto(localOrigin + "/navigation-performance#/teams-and-services/members");
  await page.waitForTimeout(1000);
  if (await page.getByRole("heading", { name: "Fixture section" }).count() === 0) {
    console.error("Browser fixture did not reach Members:", await page.locator("body").innerText(), errors);
  }
  await page.getByRole("heading", { name: "Fixture section" }).waitFor();

  const nav = page.getByRole("navigation", { name: "Teams and Services sections" });
  const schedulesLink = nav.getByRole("link", { name: "Schedules", exact: true });
  const membersLink = nav.getByRole("link", { name: "Members", exact: true });
  const scheduleReady = page.locator('[aria-label="Team schedule identity"]');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Performance.enable");
  const browserMetrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  const beforeFirstVisitMetrics = await browserMetrics();
  await cdp.send("Profiler.start");
  await page.evaluate(() => { window.__profileVisitStart = performance.now(); });
  await schedulesLink.click();
  const loading = page.getByRole("status", { name: "Loading schedules" });
  const skeletonSeen = await loading.isVisible().catch(() => false);
  try {
    await scheduleReady.waitFor({ timeout: 60000 });
  } catch (error) {
    console.error("Schedules did not reach ready:", await page.locator("body").innerText(), errors, await page.url());
    throw error;
  }
  const firstVisitProfile = await cdp.send("Profiler.stop");
  const afterFirstVisitMetrics = await browserMetrics();
  const firstVisit = await page.evaluate(() => ({
    startedAtMs: window.__profileVisitStart,
    durationMs: performance.now() - window.__profileVisitStart,
    moduleReadyOffsetMs: window.__schedulesModuleReadyAt - window.__profileVisitStart,
    profile: window.__schedulesProfile,
    memberDetailsRenderMs: window.__schedulesProfile.memberDetailsMs,
    memberDetailsRenderCount: window.__schedulesProfile.memberDetailsCount,
    url: location.hash,
    scheduleModuleLoaded: Boolean(window.__schedulesPageModuleLoaded),
    moduleResources: performance.getEntriesByType("resource")
      .filter(({ name }) => /TeamsSchedulesPage|ScheduleTab|teamSchedulePeriod/.test(name))
      .map(({ name, duration, transferSize }) => ({ name, duration, transferSize })),
  }));
  assert(skeletonSeen, "Schedules skeleton should display while its lazy module is pending");
  assert.equal(firstVisit.memberDetailsRenderCount, 0, "collapsed member details should not be built on the initial visit");
  assert(firstVisit.url.endsWith("/teams-and-services/schedules"));
  assert.equal(await schedulesLink.getAttribute("aria-current"), "page");

  await membersLink.click();
  await page.getByRole("heading", { name: "Fixture section" }).waitFor();
  await page.evaluate(() => { window.__profileVisitStart = performance.now(); });
  await schedulesLink.click();
  await scheduleReady.waitFor({ timeout: 60000 });
  const subsequentVisit = await page.evaluate(() => performance.now() - window.__profileVisitStart);

  const rapidPage = await browser.newPage();
  const rapidErrors = [];
  rapidPage.on("pageerror", (error) => rapidErrors.push(error.message));
  await rapidPage.route("**/src/pages/Teams/pages/TeamsSchedulesPage.tsx*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await rapidPage.goto(localOrigin + "/navigation-performance#/teams-and-services/members");
  await rapidPage.getByRole("heading", { name: "Fixture section" }).waitFor();
  const rapidNav = rapidPage.getByRole("navigation", { name: "Teams and Services sections" });
  const rapidSchedulesLink = rapidNav.getByRole("link", { name: "Schedules", exact: true });
  const rapidMembersLink = rapidNav.getByRole("link", { name: "Members", exact: true });
  await rapidSchedulesLink.click();
  const rapidLoading = rapidPage.getByRole("status", { name: "Loading schedules" });
  await rapidLoading.waitFor();
  assert.equal(await rapidSchedulesLink.getAttribute("aria-current"), "page");
  assert.equal(await rapidSchedulesLink.getAttribute("aria-busy"), "true");
  assert(new URL(rapidPage.url()).hash.endsWith("/teams-and-services/schedules"));
  const switchStartedAt = await rapidPage.evaluate(() => performance.now());
  await rapidMembersLink.click();
  const delayedSwitchInputMs = await rapidPage.evaluate((startedAt) => performance.now() - startedAt, switchStartedAt);
  await rapidPage.getByRole("heading", { name: "Fixture section" }).waitFor();
  await rapidPage.waitForFunction(() => Boolean(window.__schedulesPageModuleLoaded), { timeout: 60000 });
  const rapidSwitch = {
    url: new URL(rapidPage.url()).hash,
    delayMs: delayedSwitchInputMs,
    active: await rapidMembersLink.getAttribute("aria-current"),
    skeletonVisible: await rapidLoading.isVisible().catch(() => false),
    errors: rapidErrors,
  };
  assert(rapidSwitch.url.endsWith("/teams-and-services/members"), rapidSwitch.url);
  assert.equal(rapidSwitch.active, "page");
  assert.equal(rapidSwitch.skeletonVisible, false);
  assert.equal(rapidErrors.length, 0, rapidErrors.join("\n"));
  assert.equal(errors.length, 0, errors.join("\n"));

  const longTasks = firstVisit.profile.longTasks.filter((entry) =>
    entry.startTime >= firstVisit.startedAtMs &&
    entry.startTime <= firstVisit.startedAtMs + firstVisit.durationMs,
  );
  const scheduleCommits = firstVisit.profile.commits.filter((commit) => commit.id === "ScheduleTab");
  const sampleWeightsByNode = new Map();
  const sampleWeightsByScript = new Map();
  (firstVisitProfile.profile.samples || []).forEach((nodeId, index) => {
    const node = firstVisitProfile.profile.nodes.find(({ id }) => id === nodeId);
    if (!node) return;
    const callFrame = node.callFrame;
    const label = `${callFrame.functionName || "(anonymous)"} @ ${callFrame.url || "(runtime)"}`;
    const sampleWeight = firstVisitProfile.profile.timeDeltas?.[index] || 0;
    sampleWeightsByNode.set(label, (sampleWeightsByNode.get(label) || 0) + sampleWeight);
    if (!label.startsWith("(idle)")) {
      const script = callFrame.url || "(runtime)";
      sampleWeightsByScript.set(script, (sampleWeightsByScript.get(script) || 0) + sampleWeight);
    }
  });
  const topCpuSamples = [...sampleWeightsByNode.entries()]
    .filter(([label]) => !label.startsWith("(idle)"))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([label, micros]) => ({ label, sampledMs: Math.round(micros / 1000 * 100) / 100 }));
  const topCpuModules = [...sampleWeightsByScript.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20)
    .map(([url, micros]) => ({ url, sampledMs: Math.round(micros / 1000 * 100) / 100 }));
  const metricDeltas = Object.fromEntries(["ScriptDuration", "TaskDuration", "LayoutDuration", "RecalcStyleDuration"].map((name) => [name, Math.round(((afterFirstVisitMetrics[name] || 0) - (beforeFirstVisitMetrics[name] || 0)) * 1000) / 1000]));
  console.log(JSON.stringify({
    fixture: { generatedOccurrences: 52, savedOccurrences: 260, savedAssignments: 260, members: 20, timezone: "UTC" },
    firstVisitMs: Math.round(firstVisit.durationMs * 100) / 100,
    memberDetailsRenderMs: Math.round(firstVisit.memberDetailsRenderMs * 100) / 100,
    memberDetailsRenderCount: firstVisit.memberDetailsRenderCount,
    scheduleModuleReadyAfterClickMs: Math.round(firstVisit.moduleReadyOffsetMs * 100) / 100,
    scheduleModuleResources: firstVisit.moduleResources,
    subsequentVisitMs: Math.round(subsequentVisit * 100) / 100,
    delayedSwitchInputMs: Math.round(rapidSwitch.delayMs * 100) / 100,
    matchingLoadingSkeletonObserved: skeletonSeen,
    longestLongTaskMs: Math.round(Math.max(0, ...longTasks.map((entry) => entry.duration)) * 100) / 100,
    longTaskCount: longTasks.length,
    longTasks: longTasks.map((entry) => ({
      afterClickMs: Math.round((entry.startTime - firstVisit.startedAtMs) * 100) / 100,
      durationMs: Math.round(entry.duration * 100) / 100,
    })),
    scheduleReactCommitMs: Math.round(Math.max(0, ...scheduleCommits.map((commit) => commit.actualDuration)) * 100) / 100,
    scheduleReactCommits: scheduleCommits.map(({ phase, actualDuration, startTime }) => ({
      phase,
      durationMs: Math.round(actualDuration * 100) / 100,
      afterClickMs: Math.round((startTime - firstVisit.startedAtMs) * 100) / 100,
    })),
    browserMetricDeltasSeconds: metricDeltas,
    topCpuSamples,
    topCpuModules,
    latestDestination: rapidSwitch.url,
  }, null, 2));
  await rapidPage.close();

  const productionOutDir = resolve(root, "node_modules/.cache/schedules-performance-" + process.pid);
  const productionBuild = await build({
    configFile: false,
    root,
    plugins: fixturePlugins(),
    resolve: { alias: { "@": resolve(root, "src") } },
    build: {
      outDir: productionOutDir,
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, "e2e/schedules-performance.html") },
    },
  });
  const productionPreview = await preview({
    configFile: false,
    root,
    build: { outDir: productionOutDir },
    preview: { host: "127.0.0.1", port: 3114, strictPort: true },
  });
  try {
    const productionPage = await browser.newPage();
    const productionErrors = [];
    productionPage.on("pageerror", (error) => productionErrors.push(error.message));
    await productionPage.route("**/*", (route) => new URL(route.request().url()).origin === "http://127.0.0.1:3114"
      ? route.continue()
      : route.abort("blockedbyclient"));
    await productionPage.goto("http://127.0.0.1:3114/e2e/schedules-performance.html#/teams-and-services/members");
    await productionPage.getByRole("heading", { name: "Fixture section" }).waitFor();
    const productionNav = productionPage.getByRole("navigation", { name: "Teams and Services sections" });
    const productionSchedulesLink = productionNav.getByRole("link", { name: "Schedules", exact: true });
    const productionLoading = productionPage.getByRole("status", { name: "Loading schedules" });
    const productionReady = productionPage.locator('[aria-label="Team schedule identity"]');
    const productionCdp = await productionPage.context().newCDPSession(productionPage);
    await productionCdp.send("Performance.enable");
    await productionCdp.send("Profiler.enable");
    await productionCdp.send("Profiler.setSamplingInterval", { interval: 100 });
    const productionMetricsBefore = Object.fromEntries((await productionCdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
    await productionCdp.send("Profiler.start");
    await productionPage.evaluate(() => { window.__profileVisitStart = performance.now(); });
    await productionSchedulesLink.click();
    const productionSkeletonSeen = await productionLoading.isVisible().catch(() => false);
    await productionReady.waitFor({ timeout: 60000 });
    const productionProfile = await productionCdp.send("Profiler.stop");
    const productionMetricsAfter = Object.fromEntries((await productionCdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
    const productionVisit = await productionPage.evaluate(() => ({
      startedAtMs: window.__profileVisitStart,
      durationMs: performance.now() - window.__profileVisitStart,
      url: location.hash,
      profile: window.__schedulesProfile,
      memberDetailsRenderMs: window.__schedulesProfile.memberDetailsMs,
      memberDetailsRenderCount: window.__schedulesProfile.memberDetailsCount,
      moduleResources: performance.getEntriesByType("resource")
        .filter(({ name }) => /TeamsSchedulesPage|ScheduleTab|teamSchedulePeriod/.test(name))
        .map(({ name, duration, transferSize }) => ({ name, duration, transferSize })),
    }));
    const productionLongTasks = productionVisit.profile.longTasks.filter((entry) =>
      entry.startTime >= productionVisit.startedAtMs &&
      entry.startTime <= productionVisit.startedAtMs + productionVisit.durationMs,
    );
    const productionScriptSamples = new Map();
    (productionProfile.profile.samples || []).forEach((nodeId, index) => {
      const node = productionProfile.profile.nodes.find(({ id }) => id === nodeId);
      if (!node) return;
      const url = node.callFrame.url || "(runtime)";
      if (url === "(runtime)") return;
      productionScriptSamples.set(url, (productionScriptSamples.get(url) || 0) + (productionProfile.profile.timeDeltas?.[index] || 0));
    });
    const productionMetricDeltas = Object.fromEntries(["ScriptDuration", "TaskDuration", "LayoutDuration", "RecalcStyleDuration"].map((name) => [name, Math.round(((productionMetricsAfter[name] || 0) - (productionMetricsBefore[name] || 0)) * 1000) / 1000]));
    assert(productionSkeletonSeen, "production Schedules skeleton should display while its lazy module is pending");
    assert.equal(productionVisit.memberDetailsRenderCount, 0, "production collapsed member details should not be built on the initial visit");
    assert(productionVisit.url.endsWith("/teams-and-services/schedules"));
    assert.equal(await productionSchedulesLink.getAttribute("aria-current"), "page");
    assert.equal(productionErrors.length, 0, productionErrors.join("\n"));
    console.log(JSON.stringify({
      productionFixture: { generatedOccurrences: 52, savedOccurrences: 260, savedAssignments: 260, members: 20, timezone: "UTC" },
      firstVisitMs: Math.round(productionVisit.durationMs * 100) / 100,
      memberDetailsRenderMs: Math.round(productionVisit.memberDetailsRenderMs * 100) / 100,
      memberDetailsRenderCount: productionVisit.memberDetailsRenderCount,
      matchingLoadingSkeletonObserved: productionSkeletonSeen,
      longestLongTaskMs: Math.round(Math.max(0, ...productionLongTasks.map((entry) => entry.duration)) * 100) / 100,
      longTaskCount: productionLongTasks.length,
      scheduleReactCommitMs: Math.round(Math.max(0, ...(productionVisit.profile.commits || []).filter((commit) => commit.id === "ScheduleTab").map((commit) => commit.actualDuration)) * 100) / 100,
      browserMetricDeltasSeconds: productionMetricDeltas,
      topCpuModules: [...productionScriptSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([url, micros]) => ({ url, sampledMs: Math.round(micros / 1000 * 100) / 100 })),
      scheduleModuleResources: productionVisit.moduleResources,
      buildAssets: Array.isArray(productionBuild)
        ? productionBuild.flatMap((output) => output.output || []).filter((item) => item.type === "chunk" && /TeamsSchedulesPage|ScheduleTab/.test(item.fileName)).map(({ fileName, code }) => ({ fileName, bytes: Buffer.byteLength(code) }))
        : (productionBuild.output || []).filter((item) => item.type === "chunk" && /TeamsSchedulesPage|ScheduleTab/.test(item.fileName)).map(({ fileName, code }) => ({ fileName, bytes: Buffer.byteLength(code) })),
    }, null, 2));
    await productionPage.close();
  } finally {
    await productionPreview.close();
  }
} finally {
  await browser.close();
  await server.close();
}
