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
const buildDirectory = await mkdtemp(join(tmpdir(), "worshipsync-home-launcher-"));
const outputDirectory = join(buildDirectory, "dist");
const screenshotDirectory = process.env.WORSHIPSYNC_HOME_SCREENSHOT_DIR;
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
  let context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:3116/e2e/home-launcher-entry.html#/home");
  await page.getByRole("heading", { name: "Management" }).waitFor();

  const getColumnCount = async (groupName) => page.getByRole("group", { name: groupName }).evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  const mobileColumns = await getColumnCount("Management navigation");
  const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const mobileToolbarHeight = await page.getByTestId("home-toolbar").evaluate((element) => element.getBoundingClientRect().height);
  const mobileCard = await page.getByRole("link", { name: /^Resources\b/ }).boundingBox();
  assert.equal(mobileColumns, 2, "mobile launcher should use two columns");
  assert.equal(mobileScrollWidth, 390, "mobile launcher should not overflow horizontally");
  assert.ok(mobileToolbarHeight <= 48, "mobile Home toolbar should stay within its current compact height");
  assert.ok(mobileCard && mobileCard.height >= 74, "mobile navigation cards should retain a comfortable minimum height while descriptions wrap");
  assert.equal(await page.getByRole("img", { name: "WorshipSync" }).count(), 0, "desktop brand lockup should stay out of the narrow mobile header");
  assert.equal(await page.getByRole("group", { name: "Management navigation" }).getByRole("link").count(), 3);
  assert.equal(await page.getByRole("link", { name: /^Administration\b/ }).getAttribute("href"), "#/account");
  assert.equal(await page.getByRole("link", { name: /^Current Service\b/ }).getAttribute("href"), "#/current-service/view");
  assert.equal(await page.getByRole("link", { name: /^Text Master\b/ }).count(), 1);
  assert.equal(await page.getByRole("link", { name: /^Lobby Screens\b/ }).count(), 1);
  assert.equal(await page.getByRole("link", { name: /^Text Master\b/ }).locator("[data-testid=home-navigation-icon]").getAttribute("class").then((value) => value?.includes("text-orange-300")), true);
  assert.equal(await page.getByRole("link", { name: /^Overlays\b/ }).locator("[data-testid=home-navigation-icon]").getAttribute("class").then((value) => value?.includes("text-purple-300")), true);
  assert.equal(await page.getByRole("link", { name: /^Lobby Screens\b/ }).locator("[data-testid=home-navigation-icon]").getAttribute("class").then((value) => value?.includes("text-cyan-300")), true);
  const descriptionsToggle = page.getByRole("switch", { name: "Show what each page does" });
  assert.equal(await descriptionsToggle.isChecked(), true, "homepage descriptions should be shown by default");
  assert.equal(await page.getByText("Access shared files and church resources.").count(), 1, "homepage descriptions should be visible by default");
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, "mobile-390x844.png"), animations: "disabled" });
  }
  await descriptionsToggle.click();
  assert.equal(await descriptionsToggle.isChecked(), false, "the mobile toggle should hide descriptions immediately");
  assert.equal(await page.getByText("Access shared files and church resources.").count(), 0, "turning descriptions off should hide them immediately");
  await descriptionsToggle.click();
  await page.getByText("Access shared files and church resources.").waitFor();
  assert.equal(await descriptionsToggle.isChecked(), true, "the mobile toggle should show descriptions immediately");
  assert.equal(await getColumnCount("Management navigation"), 2, "descriptions should preserve the mobile two-column grid");
  const mobileHeadingBounds = await page.getByRole("heading", { name: "Management" }).boundingBox();
  const mobileDescriptionBounds = await page.getByText("Manage resources, access, teams, and services.").boundingBox();
  assert.ok(mobileHeadingBounds && mobileDescriptionBounds && mobileDescriptionBounds.y >= mobileHeadingBounds.y + mobileHeadingBounds.height - 1, "section descriptions should wrap below the heading on mobile");
  await page.getByRole("region", { name: "Controllers" }).getByText("Present slides, songs, and scripture on your screens.").waitFor();
  const mobileDisplayTitleBounds = await page.getByText("Display outputs").boundingBox();
  const mobileDisplayDescriptionBounds = await page.getByText("Links for room screens and streaming software.").boundingBox();
  const mobileDisplayActionBounds = await page.getByText("View links", { exact: true }).boundingBox();
  assert.ok(mobileDisplayTitleBounds && mobileDisplayDescriptionBounds && mobileDisplayDescriptionBounds.y >= mobileDisplayTitleBounds.y + mobileDisplayTitleBounds.height - 1, "collapsed Display outputs summary should wrap its description beneath the title on mobile");
  assert.ok(mobileDisplayTitleBounds && mobileDisplayActionBounds && Math.abs(mobileDisplayTitleBounds.y - mobileDisplayActionBounds.y) <= 8, "mobile Display outputs action should stay aligned with its title instead of floating beside the description");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, "mobile descriptions should not cause horizontal overflow");
  assert.equal(await page.getByTestId("display-outputs-details").getAttribute("open"), null, "enabling descriptions should leave Display outputs collapsed");
  if (screenshotDirectory) {
    await page.screenshot({ path: join(screenshotDirectory, "mobile-390x844-descriptions.png"), animations: "disabled" });
    await page.getByTestId("display-outputs-details").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, "mobile-display-outputs-collapsed-descriptions.png"), animations: "disabled" });
  }
  await page.reload();
  await page.getByRole("heading", { name: "Management" }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "Show what each page does" }).isChecked(), true, "the saved preference should be restored after a browser reload");
  assert.equal(await page.getByText("Access shared files and church resources.").count(), 1, "the restored preference should apply on the first Home render");

  await context.close();
  context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:3116/e2e/home-launcher-entry.html#/home");
  await page.getByRole("heading", { name: "Management" }).waitFor();

  await page.setViewportSize({ width: 900, height: 900 });
  assert.equal(await getColumnCount("Management navigation"), 3, "tablet launcher should use three columns");
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await getColumnCount("Management navigation"), 4, "desktop launcher should use four columns");
  assert.equal(await page.getByTestId("home-toolbar").evaluate((element) => element.getBoundingClientRect().width), 1440, "desktop toolbar should use the full viewport width");
  assert.equal(await page.getByTestId("home-content").evaluate((element) => element.getBoundingClientRect().width), 1152, "desktop navigation content should use a centered max-w-6xl width");
  assert.equal(await page.getByRole("img", { name: "WorshipSync" }).isVisible(), true, "desktop header should show the branded lockup");
  const desktopDescriptionsToggle = page.getByRole("switch", { name: "Show what each page does" });
  assert.equal(await desktopDescriptionsToggle.isChecked(), true, "homepage descriptions should be shown by default on desktop");
  assert.equal(await page.getByText("Manage resources, access, teams, and services.").count(), 1, "default desktop view should show descriptions");
  const launcherCanvasColor = await page.locator("main").evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(launcherCanvasColor, "rgb(43, 53, 68)", "launcher canvas should retain the original slate-blue token");
  const launcherCanvasImage = await page.locator("main").evaluate((element) => getComputedStyle(element).backgroundImage);
  assert.equal(launcherCanvasImage, "none", "launcher should use the original flat canvas color without added gradients");
  const adminSection = await page.getByRole("region", { name: "Management" }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { classes: [...element.classList], backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow };
  });
  assert.ok(adminSection.classes.includes("bg-gray-900/40"), "homepage sections should use the original gray-900/40 surface");
  assert.ok(adminSection.classes.includes("border-gray-700"), "homepage sections should use the original gray-700 border");
  assert.equal(adminSection.backgroundImage, "none", "homepage sections should not add gradients");
  assert.equal(adminSection.boxShadow, "none", "homepage sections should not add shadows");
  const displaySection = await page.getByTestId("display-outputs-details").evaluate((element) => {
    const style = getComputedStyle(element);
    return { classes: [...element.classList], backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow };
  });
  assert.ok(displaySection.classes.includes("bg-gray-900/40"), "collapsed display outputs should use the original section surface");
  assert.ok(displaySection.classes.includes("border-gray-700"), "collapsed display outputs should use the original section border");
  assert.equal(displaySection.backgroundColor, adminSection.backgroundColor, "collapsed display outputs should match the other section surface");
  assert.equal(displaySection.backgroundImage, "none");
  assert.equal(displaySection.boxShadow, "none");
  const resourceCard = page.getByRole("link", { name: /^Resources\b/ });
  const cardStyle = await resourceCard.evaluate((element) => {
    const style = getComputedStyle(element);
    return { classes: [...element.classList], backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, borderColor: style.borderTopColor };
  });
  assert.ok(cardStyle.classes.includes("bg-gray-900"), "navigation cards should use the original gray-900 surface");
  assert.ok(cardStyle.classes.includes("border-gray-600"), "navigation cards should use the original gray-600 border");
  assert.ok(cardStyle.classes.includes("hover:bg-gray-800"), "navigation cards should use the original gray-800 hover surface");
  assert.ok(cardStyle.classes.includes("hover:border-gray-500"), "navigation cards should use the original gray-500 hover border");
  assert.equal(cardStyle.backgroundImage, "none", "navigation cards should not add gradients");
  assert.equal(cardStyle.boxShadow, "none", "navigation cards should not add shadows");
  const brandImages = await page.getByRole("img", { name: "WorshipSync" }).locator("img").evaluateAll((images) =>
    images.map((image) => ({
      loaded: image.complete && image.naturalWidth > 0,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: image.getBoundingClientRect().width,
      renderedHeight: image.getBoundingClientRect().height,
    })),
  );
  assert.equal(brandImages.length, 2, "desktop brand lockup should use the original icon and wordmark artwork");
  assert.ok(brandImages.every((image) => image.loaded), "both WorshipSync logo assets should load");
  assert.equal(brandImages[1].naturalWidth, 1204, "toolbar wordmark should use the cropped existing logo artwork");
  assert.equal(brandImages[1].naturalHeight, 94, "toolbar wordmark should preserve the source crop dimensions");
  assert.ok(
    Math.abs(brandImages[1].renderedWidth / brandImages[1].renderedHeight - 1204 / 94) < 0.02,
    "toolbar wordmark should retain its original aspect ratio",
  );
  if (screenshotDirectory) {
    await page.screenshot({ path: join(screenshotDirectory, "desktop-1440x900.png"), animations: "disabled" });
  }
  await desktopDescriptionsToggle.click();
  assert.equal(await desktopDescriptionsToggle.isChecked(), false, "desktop descriptions toggle should hide descriptions immediately");
  assert.equal(await page.getByText("Manage resources, access, teams, and services.").count(), 0, "turning descriptions off should restore the compact view");
  await desktopDescriptionsToggle.click();
  await page.getByText("Manage resources, access, teams, and services.").waitFor();
  const desktopHeadingBounds = await page.getByRole("heading", { name: "Management" }).boundingBox();
  const desktopDescriptionBounds = await page.getByText("Manage resources, access, teams, and services.").boundingBox();
  assert.ok(desktopHeadingBounds && desktopDescriptionBounds && Math.abs(desktopDescriptionBounds.y + desktopDescriptionBounds.height / 2 - desktopHeadingBounds.y - desktopHeadingBounds.height / 2) <= 8, "section descriptions should sit inline with the heading when desktop space allows");
  await page.getByRole("region", { name: "Controllers" }).getByText("Present slides, songs, and scripture on your screens.").waitFor();
  const desktopDisplayTitleBounds = await page.getByText("Display outputs").boundingBox();
  const desktopDisplayDescriptionBounds = await page.getByText("Links for room screens and streaming software.").boundingBox();
  const desktopDisplayActionBounds = await page.getByText("View links", { exact: true }).boundingBox();
  assert.ok(desktopDisplayTitleBounds && desktopDisplayDescriptionBounds && Math.abs(desktopDisplayDescriptionBounds.y + desktopDisplayDescriptionBounds.height / 2 - desktopDisplayTitleBounds.y - desktopDisplayTitleBounds.height / 2) <= 8, "collapsed Display outputs description should sit inline with its title on desktop");
  assert.ok(desktopDisplayTitleBounds && desktopDisplayActionBounds && Math.abs(desktopDisplayTitleBounds.y - desktopDisplayActionBounds.y) <= 8, "desktop Display outputs action should remain aligned with its heading");
  await page.getByText("Links for room screens and streaming software.").waitFor();
  assert.equal(await desktopDescriptionsToggle.isChecked(), true, "desktop descriptions toggle should show descriptions immediately");
  assert.equal(await page.getByTestId("display-outputs-details").getAttribute("open"), null, "showing descriptions should keep Display outputs collapsed");
  assert.equal(await getColumnCount("Management navigation"), 4, "desktop descriptions should preserve the four-column grid");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1440, "desktop descriptions should not cause horizontal overflow");
  if (screenshotDirectory) {
    await page.screenshot({ path: join(screenshotDirectory, "desktop-1440x900-descriptions.png"), animations: "disabled" });
  }
  await desktopDescriptionsToggle.click();
  assert.equal(await page.getByText("Manage resources, access, teams, and services.").count(), 0, "turning descriptions off should restore the compact view");
  const resourceHref = await resourceCard.getAttribute("href");
  await resourceCard.hover();
  await page.waitForFunction(
    (original) => {
      const element = [...document.querySelectorAll("a")].find((anchor) => anchor.getAttribute("href") === original.href);
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.backgroundColor !== original.backgroundColor && style.borderTopColor !== original.borderColor;
    },
    { href: resourceHref, backgroundColor: cardStyle.backgroundColor, borderColor: cardStyle.borderColor },
  );
  const cardHoverStyle = await resourceCard.evaluate((element) => {
    const style = getComputedStyle(element);
    return { hovered: element.matches(":hover"), backgroundColor: style.backgroundColor, borderColor: style.borderTopColor };
  });
  assert.equal(cardHoverStyle.hovered, true, "the browser should apply the actual navigation card hover state");
  assert.notEqual(cardHoverStyle.backgroundColor, cardStyle.backgroundColor, "hover should apply the gray-800 background treatment");
  assert.notEqual(cardHoverStyle.borderColor, cardStyle.borderColor, "hover should apply the gray-500 border treatment");
  const desktopCard = await page.getByRole("link", { name: /^Resources\b/ }).boundingBox();
  assert.ok(desktopCard && desktopCard.height >= 96 && desktopCard.height <= 112, "desktop navigation cards should be approximately 96–112px tall");
  const desktopIconWidth = await page.getByRole("link", { name: /^Resources\b/ }).locator("[data-testid=home-navigation-icon] svg").evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(desktopIconWidth >= 32 && desktopIconWidth <= 36, "desktop navigation icons should be approximately 32–36px");
  const adminSectionRadius = await page.getByRole("region", { name: "Management" }).evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  assert.ok(parseFloat(adminSectionRadius) >= 12, "major navigation sections should have rounded containers");
  const adminHeadingSize = await page.getByRole("heading", { name: "Management" }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(adminHeadingSize >= 20 && adminHeadingSize <= 22, "desktop section headings should stay around 20–22px");
  const controllerCards = page.getByRole("group", { name: "Controllers navigation" }).getByRole("link");
  assert.equal(await controllerCards.count(), 5, "all three configured controllers and both controller tools should stay together");
  const controllerRows = await controllerCards.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  assert.ok(controllerRows[4] > controllerRows[3], "the fifth controller destination should wrap at the same card width");
  const sharedCardWidths = await Promise.all([
    page.getByRole("group", { name: "Management navigation" }).getByRole("link").first().evaluate((element) => element.getBoundingClientRect().width),
    page.getByRole("group", { name: "Personal and service tools navigation" }).getByRole("link").first().evaluate((element) => element.getBoundingClientRect().width),
    controllerCards.first().evaluate((element) => element.getBoundingClientRect().width),
  ]);
  assert.ok(sharedCardWidths.every((width) => Math.abs(width - sharedCardWidths[0]) < 0.5), "launcher sections should share card widths");
  const firstRowHeights = await page.getByRole("group", { name: "Management navigation" }).getByRole("link").evaluateAll((elements) => elements.slice(0, 3).map((element) => element.getBoundingClientRect().height));
  assert.ok(firstRowHeights.every((height) => Math.abs(height - firstRowHeights[0]) < 0.5), "cards in a desktop row should remain equal height with descriptions shown");
  const desktopToolbarHeight = await page.getByTestId("home-toolbar").evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(desktopToolbarHeight <= 56, "desktop Home toolbar should stay within its current height");

  await page.evaluate(() => { document.documentElement.style.fontSize = "80%"; });
  assert.equal(await page.getByRole("group", { name: "Management navigation" }).evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length), 4, "80% interface zoom should preserve the desktop grid");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1440, "80% interface zoom should not create horizontal overflow");
  await page.evaluate(() => { document.documentElement.style.fontSize = "150%"; });
  assert.equal(await page.getByRole("group", { name: "Management navigation" }).evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length), 4, "150% interface zoom should preserve the desktop grid");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1440, "150% interface zoom should not create horizontal overflow");
  await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });

  await page.setViewportSize({ width: 2560, height: 1000 });
  assert.equal(await getColumnCount("Management navigation"), 4, "ultrawide launcher should remain four columns");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 2560, "ultrawide launcher should remain centered without horizontal overflow");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
  assert.equal(await getColumnCount("Management navigation"), 2, "125% mobile interface zoom should preserve the two-column grid");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, "125% mobile interface zoom should not create horizontal overflow");
  await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });

  const details = page.getByTestId("display-outputs-details");
  assert.equal(await details.getAttribute("open"), null, "display outputs should be collapsed initially");
  await desktopDescriptionsToggle.click();
  await page.getByText("Links for room screens and streaming software.").waitFor();
  assert.equal(await details.getAttribute("open"), null, "display output section description should show while collapsed");
  if (screenshotDirectory) {
    await details.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDirectory, "desktop-display-outputs-collapsed-descriptions.png"), animations: "disabled" });
  }
  await page.getByText("Display outputs").click();
  assert.notEqual(await details.getAttribute("open"), null, "display outputs should expand on request");
  await page.getByText("Open these displays full-screen in your browser.").waitFor();
  await page.getByText("Copy these links into OBS or other streaming software as browser sources.").waitFor();
  assert.equal(await page.getByText("Show full-screen projection content.").count(), 0, "display cards should not show individual fullscreen descriptions");
  assert.equal(await page.getByText("Use as a browser source in streaming software.").count(), 0, "display cards should not show repeated browser-source descriptions");
  assert.equal(await page.getByText("Sanctuary", { exact: true }).count(), 2, "the visible projector card title should stay the configured name in both groups");
  const displayLink = page.getByRole("link", { name: "Open Sanctuary fullscreen link" });
  assert.equal(await displayLink.getAttribute("href"), "#/projector?output=out_sanctuary");
  assert.equal(await page.getByRole("link", { name: "Open Sanctuary browser source link" }).getAttribute("href"), "#/projector-full?output=out_sanctuary");
  assert.equal(await page.getByRole("link", { name: "Open Stream browser source link" }).getAttribute("href"), "#/stream?output=stream");
  assert.equal(await page.getByRole("link", { name: "Open Projector fullscreen link" }).getAttribute("href"), "#/projector?output=projector");
  assert.equal(await page.getByRole("link", { name: "Open Projector browser source link" }).getAttribute("href"), "#/projector-full?output=projector");
  assert.equal(await page.getByRole("button", { name: "Copy Projector fullscreen link" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Copy Projector browser source link" }).count(), 1);
  await page.getByRole("button", { name: "Copy Sanctuary fullscreen link" }).click();
  await page.getByRole("status").filter({ hasText: "Link copied for Sanctuary fullscreen." }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Copied Sanctuary fullscreen link" }).locator("svg").getAttribute("class").then((value) => value?.includes("lucide-check")));
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /#\/projector\?output=out_sanctuary$/);
  await page.getByRole("button", { name: "Copy Sanctuary browser source link" }).click();
  await page.getByRole("status").filter({ hasText: "Link copied for Sanctuary browser source." }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /#\/projector-full\?output=out_sanctuary$/);
  await desktopDescriptionsToggle.click();
  assert.equal(await page.getByText("Open these displays full-screen in your browser.").count(), 0, "turning descriptions off should hide the subgroup explanation");
  assert.equal(await page.getByText("Copy these links into OBS or other streaming software as browser sources.").count(), 0, "turning descriptions off should hide the browser-source explanation");
  assert.equal(await page.getByRole("heading", { name: "Fullscreen in the browser" }).isVisible(), true, "subgroup headings should stay visible when descriptions are off");
  assert.equal(await page.getByRole("link", { name: "Open Projector browser source link" }).isVisible(), true, "display cards should stay visible when descriptions are off");
  for (const { width, columns, expectedHeight } of [
    { width: 390, columns: 2, expectedHeight: 74 },
    { width: 900, columns: 3, expectedHeight: 82 },
    { width: 1440, columns: 4, expectedHeight: 82 },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await getColumnCount("Fullscreen in the browser navigation"),
      columns,
      `fullscreen output cards should use ${columns} columns at ${width}px`,
    );
    const projectorCardHeight = await page.getByRole("link", { name: "Open Projector fullscreen link" }).evaluate((element) => element.parentElement?.getBoundingClientRect().height ?? 0);
    assert.ok(Math.abs(projectorCardHeight - expectedHeight) <= 1, `output cards should match the ${expectedHeight}px homepage tile height at ${width}px (measured ${projectorCardHeight}px)`);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, `output cards should not overflow horizontally at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

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
