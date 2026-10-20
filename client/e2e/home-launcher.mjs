import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const buildDirectory = await mkdtemp(join(tmpdir(), "worshipsync-home-launcher-"));
const outputDirectory = join(buildDirectory, "dist");
const virtualModules = new Map([
  ["\0home-launcher-menu", `import React from "react"; export default function HomeToolbarMenu(){return React.createElement("button", {"aria-label":"Open menu"}, "Menu");}`],
  ["\0home-launcher-user", `import React from "react"; export default function UserSection(){return React.createElement("div", null, "Account");}`],
  ["\0home-launcher-install", `export const useAppInstallChrome=()=>({installMenuItems:[],installHelpDialogs:null});`],
  ["\0home-launcher-hooks", `export { useSelector } from "react-redux";`],
]);

const fixturePlugin = {
  name: "home-launcher-smoke-mocks",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer?.replaceAll("\\", "/").endsWith("/src/pages/Home.tsx")) return null;
    if (source === "../components/HomeToolbarMenu/HomeToolbarMenu") return "\0home-launcher-menu";
    if (source === "../containers/Toolbar/ToolbarElements/UserSection") return "\0home-launcher-user";
    if (source === "../hooks/useAppInstallChrome") return "\0home-launcher-install";
    if (source === "../hooks") return "\0home-launcher-hooks";
    return null;
  },
  load(id) {
    return virtualModules.get(id) ?? null;
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
    rollupOptions: {
      input: resolve(root, "e2e/home-launcher-entry.html"),
    },
  },
});

  server = await preview({
    configFile: false,
    root,
    build: { outDir: outputDirectory },
    preview: { host: "127.0.0.1", port: 3116, strictPort: true },
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:3116/e2e/home-launcher-entry.html#/home");
  await page.getByRole("heading", { name: "Church administration" }).waitFor();

  const getColumnCount = async (groupName) => page.getByRole("group", { name: groupName }).evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  const mobileColumns = await getColumnCount("Church administration navigation");
  const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileToolbarHeight = await page.getByTestId("home-toolbar").evaluate((element) => element.getBoundingClientRect().height);
  assert.equal(mobileColumns, 2, "mobile launcher should use two columns");
  assert.equal(mobileScrollWidth, 375, "mobile launcher should not overflow horizontally");
  assert.ok(mobileToolbarHeight <= 48, "mobile Home toolbar should stay within its current compact height");
  assert.equal(await page.getByRole("group", { name: "Church administration navigation" }).getByRole("link").count(), 3);
  assert.equal(await page.getByRole("link", { name: "Text Master" }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Lobby Screens" }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Text Master" }).locator("[data-testid=home-navigation-icon]").getAttribute("class").then((value) => value?.includes("text-orange-300")), true);

  await page.setViewportSize({ width: 900, height: 900 });
  assert.equal(await getColumnCount("Church administration navigation"), 3, "tablet launcher should use three columns");
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await getColumnCount("Church administration navigation"), 4, "desktop launcher should use four columns");
  const controllerCards = page.getByRole("group", { name: "Controllers navigation" }).getByRole("link");
  assert.equal(await controllerCards.count(), 5, "all three configured controllers and both controller tools should stay together");
  const controllerRows = await controllerCards.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  assert.ok(controllerRows[4] > controllerRows[3], "the fifth controller destination should wrap at the same card width");
  const sharedCardWidths = await Promise.all([
    page.getByRole("group", { name: "Church administration navigation" }).getByRole("link").first().evaluate((element) => element.getBoundingClientRect().width),
    page.getByRole("group", { name: "Personal and service tools navigation" }).getByRole("link").first().evaluate((element) => element.getBoundingClientRect().width),
    controllerCards.first().evaluate((element) => element.getBoundingClientRect().width),
  ]);
  assert.ok(sharedCardWidths.every((width) => Math.abs(width - sharedCardWidths[0]) < 0.5), "launcher sections should share card widths");
  const desktopToolbarHeight = await page.getByTestId("home-toolbar").evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(desktopToolbarHeight <= 56, "desktop Home toolbar should stay within its current height");

  await page.setViewportSize({ width: 2560, height: 1000 });
  assert.equal(await getColumnCount("Church administration navigation"), 4, "ultrawide launcher should remain four columns");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 2560, "ultrawide launcher should remain centered without horizontal overflow");

  const details = page.getByTestId("display-outputs-details");
  assert.equal(await details.getAttribute("open"), null, "display outputs should be collapsed initially");
  await page.getByText("Display outputs").click();
  assert.notEqual(await details.getAttribute("open"), null, "display outputs should expand on request");
  const displayLink = page.getByRole("link", { name: "Open Sanctuary", exact: true });
  assert.equal(await displayLink.getAttribute("href"), "#/projector?output=out_sanctuary");
  assert.equal(await page.getByRole("link", { name: "Open Sanctuary (browser source)", exact: true }).getAttribute("href"), "#/projector-full?output=out_sanctuary");
  assert.equal(await page.getByRole("link", { name: "Open Stream", exact: true }).getAttribute("href"), "#/stream?output=stream");
  await page.getByRole("button", { name: "Copy Sanctuary link" }).click();
  await page.getByRole("status").filter({ hasText: "Link copied for Sanctuary." }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Copied Sanctuary link" }).locator("svg").getAttribute("class").then((value) => value?.includes("lucide-check")));
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /#\/projector\?output=out_sanctuary$/);
  await page.getByRole("button", { name: "Copy Sanctuary (browser source) link" }).click();
  await page.getByRole("status").filter({ hasText: "Link copied for Sanctuary (browser source)." }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /#\/projector-full\?output=out_sanctuary$/);

  await page.getByRole("link", { name: "Service Workspace" }).click();
  await page.getByText("Service workspace route").waitFor();
  assert.deepEqual(pageErrors, [], "home launcher should not produce browser errors");
  console.log("PASS home launcher browser smoke: responsive grids, stable toolbar, navigation, collapsed outputs, and copied output URL");
  await context.close();
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(buildDirectory, { recursive: true, force: true });
}
