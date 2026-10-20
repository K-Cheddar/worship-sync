import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const buildDirectory = await mkdtemp(join(tmpdir(), "worshipsync-home-navigation-"));
const outputDirectory = join(buildDirectory, "dist");
const screenshotDirectory = process.env.WORSHIPSYNC_HOME_NAV_SCREENSHOT_DIR;
const routeLabels = new Map([
  ["./pages/Account", "Church administration route"],
  ["./pages/Teams/TeamsAndServices", "Teams and Services route"],
  ["./pages/Controller/CurrentServiceWorkspace", "Service Workspace route"],
  ["./pages/Controller/Controller", "Presentation Controller route"],
  ["./pages/OverlayController/OverlayController", "Graphics Operator route"],
  ["./pages/AuxController/AuxController", "Additional Controller route"],
]);
const routeModules = new Map();
for (const [source, label] of routeLabels) {
  routeModules.set(`\0home-navigation-route:${source}`, label);
}
const virtualModules = new Map([
  ["\0home-navigation-outlet", `import React, { useEffect } from "react"; import { Outlet } from "react-router-dom"; export default function RouteOutlet(){ useEffect(()=>{ window.__controllerWrapperMounts = (window.__controllerWrapperMounts || 0) + 1; },[]); return React.createElement(Outlet); }`],
  ["\0home-navigation-update", `export default function WebUpdateCoordinator(){ return null; }`],
  ["\0home-navigation-user", `import React from "react"; export default function UserSection(){ return React.createElement("span", null, "Fixture account"); }`],
  ["\0home-navigation-install", `export const useAppInstallChrome=()=>({installMenuItems:[],installHelpDialogs:null});`],
  ["\0home-navigation-hooks", `export { useSelector } from "react-redux";`],
  ["\0home-navigation-about", `export const useAboutChangelogMenu=()=>({aboutChangelogMenuItems:[],aboutChangelogModals:null,updateReadyVersion:""});`],
  ["\0home-navigation-zoom", `export const useInterfaceZoom=()=>({zoomLevel:100});`],
]);
const fixturePlugin = {
  name: "home-navigation-app-route-fixture",
  enforce: "pre",
  resolveId(source, importer) {
    const normalizedImporter = importer?.replaceAll("\\", "/") ?? "";
    if (normalizedImporter.endsWith("/src/App.tsx")) {
      if (source === "./ControllerContextWrapper") return "\0home-navigation-outlet";
      if (source === "./components/WebUpdateCoordinator/WebUpdateCoordinator") return "\0home-navigation-update";
      if (routeLabels.has(source)) return `\0home-navigation-route:${source}`;
    }
    if (normalizedImporter.endsWith("/src/pages/Home.tsx")) {
      if (source === "../containers/Toolbar/ToolbarElements/UserSection") return "\0home-navigation-user";
      if (source === "../hooks/useAppInstallChrome") return "\0home-navigation-install";
      if (source === "../hooks") return "\0home-navigation-hooks";
    }
    if (normalizedImporter.endsWith("/src/components/HomeToolbarMenu/HomeToolbarMenu.tsx")) {
      if (source === "../../hooks/useAboutChangelogMenu") return "\0home-navigation-about";
      if (source === "../../hooks/useInterfaceZoom") return "\0home-navigation-zoom";
    }
    return null;
  },
  load(id) {
    if (virtualModules.has(id)) return virtualModules.get(id);
    if (routeModules.has(id)) {
      const label = routeModules.get(id);
      return `import React from "react"; import HomeToolbarMenu from "/src/components/HomeToolbarMenu/HomeToolbarMenu.tsx"; export default function RouteFixture(){ return React.createElement(React.Fragment, null, React.createElement(HomeToolbarMenu), React.createElement("main", {"data-testid":"fixture-route"}, ${JSON.stringify(label)})); }`;
    }
    return null;
  },
};

let server;
let browser;
try {
  await build({
    configFile: false,
    root,
    logLevel: "error",
    plugins: [fixturePlugin, react()],
    resolve: { alias: { "@": resolve(root, "src") } },
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, "e2e/home-navigation-entry.html") },
    },
  });
  server = await preview({
    configFile: false,
    root,
    build: { outDir: outputDirectory },
    preview: { host: "127.0.0.1", port: 3117, strictPort: true },
  });
  browser = await chromium.launch({ headless: true });

  const openApp = async (query = "") => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    const requests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => requests.push({
      url: request.url(),
      type: request.resourceType(),
      method: request.method(),
    }));
    await page.goto(`http://127.0.0.1:3117/e2e/home-navigation-entry.html${query}#/home`);
    await page.getByRole("heading", { name: "Church management" }).waitFor();
    return { context, page, pageErrors, requests };
  };

  const { context, page, pageErrors, requests } = await openApp();
  page.setDefaultTimeout(6000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: 48 * 1024,
    uploadThroughput: 24 * 1024,
    connectionType: "cellular3g",
  });

  const routeCases = [
    { link: "Church administration", route: "Church administration route" },
    { link: "Teams and Services", route: "Teams and Services route" },
    { link: "Service Workspace", route: "Service Workspace route" },
    { link: "Text Master", route: "Presentation Controller route" },
    { link: "Overlays", route: "Graphics Operator route" },
    { link: "Lobby Screens", route: "Additional Controller route" },
  ];

  // Recreate the old / route handoff in the browser to observe AppEntry itself.
  // Authenticated AppEntry renders Navigate without page content for one route commit.
  await page.getByRole("link", { name: /^Church administration(?:\s|$)/ }).click();
  await page.getByTestId("fixture-route").filter({ hasText: "Church administration route" }).waitFor();
  const baselineObservationIndex = await page.evaluate(() => window.__homeRouteObservations?.length ?? 0);
  await page.evaluate(() => { window.location.hash = "#/"; });
  await page.getByRole("heading", { name: "Church management" }).waitFor();
  const baselineTrace = await page.evaluate((start) => ({
    routes: (window.__homeRouteObservations ?? []).slice(start),
    frames: (window.__homeRouteFrames ?? []).slice(-100),
  }), baselineObservationIndex);
  const rootHandoff = baselineTrace.routes.find((entry) => entry.pathname === "/");
  const homeAfterRoot = baselineTrace.routes.find((entry) => entry.pathname === "/home" && entry.at > rootHandoff?.at);
  assert.ok(rootHandoff, "the reproduced old destination should render the public root route");
  assert.equal(rootHandoff.pageVisible, false, "authenticated AppEntry should have no page marker before its /home redirect commits");
  assert.ok(homeAfterRoot?.pageVisible, "AppEntry should subsequently redirect to the visible Home page");
  const baselineBlankIntervalMs = homeAfterRoot.at - rootHandoff.at;

  const returnMeasurements = [];
  for (const { link, route } of routeCases) {
    await page.getByRole("link", { name: new RegExp(`^${link}(?:\\s|$)`) }).click();
    await page.getByTestId("fixture-route").filter({ hasText: route }).waitFor();
    await page.waitForTimeout(30);
    const traceStart = await page.evaluate(() => ({
      observationIndex: window.__homeRouteObservations?.length ?? 0,
      frameIndex: window.__homeRouteFrames?.length ?? 0,
      hashIndex: window.__homeHashHistory?.length ?? 0,
      at: performance.now(),
    }));
    const requestStart = requests.length;
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: /^Home$/ }).click();
    await page.getByRole("heading", { name: "Church management" }).waitFor();
    await page.waitForTimeout(80);
    const result = await page.evaluate((start) => {
      const routes = (window.__homeRouteObservations ?? []).slice(start.observationIndex);
      const frames = (window.__homeRouteFrames ?? []).slice(start.frameIndex);
      const hashes = (window.__homeHashHistory ?? []).slice(start.hashIndex);
      return {
        durationMs: performance.now() - start.at,
        routePaths: routes.map((entry) => entry.pathname),
        emptyFrames: frames.filter((frame) => !frame.pageVisible).length,
        homeVisible: routes.some((entry) => entry.pathname === "/home" && entry.pageVisible),
        routeCommitMs: Math.max(0, (routes.find((entry) => entry.pathname === "/home" && entry.pageVisible)?.at ?? start.at) - (hashes.find((entry) => entry.hash === "#/home")?.at ?? start.at)),
        hashes: hashes.map((entry) => entry.hash),
        wrapperMounts: window.__controllerWrapperMounts ?? 0,
      };
    }, traceStart);
    const newNavigationRequests = requests.slice(requestStart).filter((request) =>
      ["document", "fetch", "xhr"].includes(request.type),
    );
    assert.ok(result.homeVisible, `Home was not visibly rendered after returning from ${route}`);
    assert.ok(result.routeCommitMs < 100, `Home route should render promptly under slow network conditions (observed ${result.routeCommitMs}ms after URL change)`);
    assert.ok(!result.routePaths.includes("/"), `Home from ${route} passed through the public root route`);
    assert.ok(!result.hashes.some((hash) => hash === "#/" || hash.startsWith("#/?")), `Home from ${route} wrote a root hash transition`);
    assert.equal(result.emptyFrames, 0, `a blank browser frame was sampled after leaving ${route}`);
    assert.equal(newNavigationRequests.length, 0, `returning Home from ${route} should not issue document/auth/bootstrap requests`);
    assert.equal(result.wrapperMounts, 1, "the shared route context wrapper should remain mounted while Home changes");
    returnMeasurements.push({ route, menuToHomeMs: Math.round(result.durationMs), routeCommitMs: Math.round(result.routeCommitMs) });
  }

  assert.equal(pageErrors.length, 0, `browser route fixture raised: ${pageErrors.join("; ")}`);
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, "home-after-app-routes.png"), animations: "disabled" });
  }
  await context.close();

  // A church-scoped cache remains visible during a deliberately delayed live snapshot.
  const delayed = await openApp("?delaySync=1");
  const delayedPage = delayed.page;
  await delayedPage.getByText("Text Master", { exact: true }).waitFor();
  assert.equal(await delayedPage.getByText("Text Master", { exact: true }).count(), 1, "cached Home metadata should render before live profile reads resolve");
  await delayedPage.getByRole("link", { name: /^Service Workspace(?:\s|$)/ }).click();
  await delayedPage.getByTestId("fixture-route").filter({ hasText: "Service Workspace route" }).waitFor();
  await delayedPage.getByRole("button", { name: "Open menu" }).click();
  await delayedPage.getByRole("menuitem", { name: /^Home$/ }).click();
  await delayedPage.getByRole("heading", { name: "Church management" }).waitFor();
  await delayedPage.getByText("Text Master", { exact: true }).waitFor();
  assert.equal(await delayedPage.getByText("Presentation Operator", { exact: true }).count(), 0, "cached labels should remain until the delayed live snapshot resolves");
  const homeNode = await delayedPage.evaluate(() => {
    window.__homeContentNode = document.querySelector("[data-testid='home-content']");
    return Boolean(window.__homeContentNode);
  });
  assert.equal(homeNode, true, "Home should be mounted from cached metadata while the live snapshot is delayed");
  await delayedPage.getByText("Presentation Operator", { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await delayedPage.evaluate(() => window.__homeContentNode === document.querySelector("[data-testid='home-content']")), true, "live metadata should update the mounted Home view without replacing its content container");
  assert.equal(await delayedPage.getByText("Text Master", { exact: true }).count(), 0, "new live controller metadata should replace the cached label");
  assert.equal(delayed.pageErrors.length, 0, `delayed synchronization fixture raised: ${delayed.pageErrors.join("; ")}`);
  await delayed.context.close();

  // Workstation and guest sessions use the same direct Home route while their AuthGate remains active.
  for (const session of ["workstation", "guest"]) {
    const fixture = await openApp(`?session=${session}`);
    const homeLink = session === "guest" ? "Overlays" : "Service Workspace";
    const route = session === "guest" ? "Graphics Operator route" : "Service Workspace route";
    await fixture.page.getByRole("link", { name: new RegExp(`^${homeLink}(?:\\s|$)`) }).click();
    await fixture.page.getByTestId("fixture-route").filter({ hasText: route }).waitFor();
    await fixture.page.getByRole("button", { name: "Open menu" }).click();
    await fixture.page.getByRole("menuitem", { name: /^Home$/ }).click();
    await fixture.page.getByRole("heading", { name: "Church management" }).waitFor();
    assert.equal(await fixture.page.evaluate(() => window.location.hash), "#/home", `${session} should remain on the Home route`);
    assert.equal(fixture.pageErrors.length, 0, `${session} browser fixture raised: ${fixture.pageErrors.join("; ")}`);
    await fixture.context.close();
  }

  console.log(`PASS actual AppRoutes Home navigation: old / -> AppEntry -> /home handoff had no route page marker for ${Math.round(baselineBlankIntervalMs)}ms; direct returns were visible without root, sampled blank frames, document/bootstrap requests, or route-wrapper remounts. Slow-network timings (menu open to Home, then URL-to-render): ${JSON.stringify(returnMeasurements)}. Delayed cached metadata updated in place.`);
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(buildDirectory, { recursive: true, force: true });
}
