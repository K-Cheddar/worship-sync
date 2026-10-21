import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const outDir = resolve(root, "node_modules/.cache/my-schedule-service-cards-build");
const viteOptions = {
  configFile: false,
  root,
  plugins: [
    {
      name: "my-schedule-card-visual-fixture",
      enforce: "pre",
      load(id) {
        const path = id.replaceAll("\\", "/");
        if (path.endsWith("/src/hooks/index.ts")) {
          return `const state={undoable:{present:{preferences:{scrollbarWidth:'8px'}}}};
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
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "e2e/my-schedule-service-cards-fixture.html"),
    },
  },
  resolve: { alias: { "@": resolve(root, "src") } },
};

await build(viteOptions);
const server = await preview({
  ...viteOptions,
  preview: { host: "127.0.0.1", port: 3117, strictPort: true },
});
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 320, height: 640, expectedColumns: 1 },
    { width: 768, height: 900, expectedColumns: 2 },
    { width: 1280, height: 900, expectedColumns: 4 },
    { width: 1920, height: 1080, expectedColumns: 4 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("http://127.0.0.1:3117/e2e/my-schedule-service-cards-fixture.html");
    const cardLists = page.getByRole("list", { name: "My scheduled services" });
    await cardLists.first().waitFor();
    await page.getByRole("button", { name: /Open Sabbath Service/ }).waitFor();
    const plansCards = page.getByRole("list", { name: "Plans service card preview" });
    assert.equal(await plansCards.locator(":scope > li").count(), 3,
      "Plans preview should cover long, short, and Today card states");

    const planUpNextButton = page.getByRole("button", {
      name: /Open plan preview for Sabbath Service & Second Worship Gathering/,
    });
    const dateColumn = planUpNextButton.locator("time").first();
    const dateBounds = await dateColumn.boundingBox();
    const combinedName = planUpNextButton.getByText("Sabbath Service & Second Worship Gathering");
    const combinedNameBounds = await combinedName.boundingBox();
    const planReadyBounds = await planUpNextButton.locator("svg").boundingBox();
    assert.ok(dateBounds && combinedNameBounds && planReadyBounds);
    assert.ok(dateBounds.width >= 42 && dateBounds.width <= 48,
      `date column should be 42-48px wide at ${viewport.width}px`);
    assert.ok(combinedNameBounds.x >= dateBounds.x + dateBounds.width + 5,
      "service information should sit to the right of the date column");
    assert.ok(combinedNameBounds.x + combinedNameBounds.width <= planReadyBounds.x,
      "long service names should not overlap the status marker");
    assert.equal(await planUpNextButton.locator("time").count(), 1,
      "a grouped plan card with shared time should keep that time hidden");

    const shortPlanButton = page.getByRole("button", { name: "Open plan preview for Power Up" });
    const shortNameBounds = await shortPlanButton.getByText("Power Up").boundingBox();
    const shortTimeBounds = await shortPlanButton.getByText("3:00 PM").boundingBox();
    assert.ok(shortNameBounds && shortTimeBounds);
    assert.ok(shortTimeBounds.y >= shortNameBounds.y + shortNameBounds.height - 1,
      "service time should appear below the service name");
    const readyPlanClass = await plansCards.locator(":scope > li").nth(1)
      .locator("article").getAttribute("class");
    assert.match(readyPlanClass || "", /border-emerald-500\/30/,
      "Plans should retain its green plan-ready treatment");
    assert.ok(await page.getByRole("button", { name: /Open plan preview for Easter Sunday, today/i }).count());

    const grid = cardLists.locator(":scope > li");
    assert.equal(await grid.count(), 6, "all assigned services should render");
    const cardRows = await grid.evaluateAll((items) => items.map((item) => {
      const box = item.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y) };
    }));
    const rowCounts = new Map();
    cardRows.forEach(({ y }) => rowCounts.set(y, (rowCounts.get(y) || 0) + 1));
    const actualColumns = Math.max(...rowCounts.values());
    assert.equal(actualColumns, viewport.expectedColumns,
      `expected ${viewport.expectedColumns} card columns at ${viewport.width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      `page should not overflow horizontally at ${viewport.width}px`);

    const longPosition = page.getByText("Camera - Stationary and Shoulder Rig (Long Position Name)");
    const positionBox = await longPosition.boundingBox();
    assert.ok(positionBox && positionBox.height > 16,
      `long positions should wrap at ${viewport.width}px`);
    const acceptButton = page.getByRole("button", { name: /Accept Camera - Stationary/i }).first();
    const acceptBox = await acceptButton.boundingBox();
    assert.ok(acceptBox);
    assert.ok(acceptBox.height >= (viewport.width < 640 ? 43 : 35),
      `response buttons should have a comfortable target at ${viewport.width}px`);

    const firstResponse = page.getByText("Accepted");
    assert.equal(await firstResponse.evaluate((element) => element.tagName.toLowerCase()), "span",
      "saved response chips must not be interactive controls");
    assert.equal(await page.getByText("Declined").count(), 1,
      "My Schedule should retain the declined response state");
    const planBorder = await grid.nth(1).locator("article").evaluate((element) => getComputedStyle(element).borderTopColor);
    const neutralBorder = await grid.nth(2).locator("article").evaluate((element) => getComputedStyle(element).borderTopColor);
    assert.equal(planBorder, neutralBorder,
      "plan availability on My Schedule should not use the Accepted green border");

    if (viewport.width >= 1280) {
      const ordinaryCard = grid.nth(2).locator("article");
      const openButton = ordinaryCard.getByRole("button", { name: /Open Fixture Service 3/ });
      const ordinaryBorder = await ordinaryCard.evaluate((element) => getComputedStyle(element).borderTopColor);
      await openButton.hover();
      const openHoverBorder = await ordinaryCard.evaluate((element) => getComputedStyle(element).borderTopColor);
      assert.notEqual(openHoverBorder, ordinaryBorder, "hovering the open action should highlight its card");
      await ordinaryCard.getByRole("button", { name: /Accept Camera - Stationary/i }).hover();
      const responseHoverBorder = await ordinaryCard.evaluate((element) => getComputedStyle(element).borderTopColor);
      assert.equal(responseHoverBorder, ordinaryBorder,
        "hovering response controls should not trigger the card open-action hover style");
      await openButton.evaluate((button) => button.focus({ preventScroll: true, focusVisible: true }));
      const focusBorder = await ordinaryCard.evaluate((element) => getComputedStyle(element).borderTopColor);
      assert.notEqual(focusBorder, ordinaryBorder, "keyboard focus should visibly highlight the open action card");
    }

    await page.screenshot({
      path: resolve(tmpdir(), `worshipsync-my-schedule-${viewport.width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, [], `browser should be error-free at ${viewport.width}px`);
    console.log(`PASS My Schedule cards at ${viewport.width}x${viewport.height}: ${actualColumns} columns`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
