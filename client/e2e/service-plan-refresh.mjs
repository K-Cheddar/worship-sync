import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build, preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const outDir = resolve(root, "node_modules/.cache/service-plan-refresh-build");
const viteOptions = {
  configFile: false,
  root,
  plugins: [react()],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "e2e/service-plan-refresh-fixture.html"),
    },
  },
};
await build(viteOptions);

const server = await preview({
  ...viteOptions,
  preview: { host: "127.0.0.1", port: 3115, strictPort: true },
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:3115/e2e/service-plan-refresh-fixture.html");

  const scrollport = page.locator('[data-testid="floating-window"] .overflow-y-auto').first();
  const readingItem = page
    .getByRole("heading", { name: "Plan item 25" })
    .locator("xpath=../..");
  await readingItem.waitFor();
  const beforeTop = await readingItem.evaluate((element) => {
    const floatingWindow = element.closest('[data-testid="floating-window"]');
    const scrollContainer = floatingWindow?.querySelector(".overflow-y-auto");
    if (!(scrollContainer instanceof HTMLElement)) throw new Error("Missing FloatingWindow scroll container");
    scrollContainer.scrollTop +=
      element.getBoundingClientRect().top -
      scrollContainer.getBoundingClientRect().top -
      100;
    return element.getBoundingClientRect().top;
  });
  assert((await scrollport.evaluate((element) => element.scrollTop)) > 0, "the controller plan should be scrolled halfway down");

  const notes = readingItem.locator("details");
  await notes.locator("summary").click();
  assert.equal(await notes.evaluate((element) => element.open), true, "the visible item's notes should expand");
  const anchoredTop = await readingItem.evaluate((element) => element.getBoundingClientRect().top);
  assert(Number.isFinite(beforeTop), "the initial reading position should be measurable");

  await page.evaluate(() => window.applyServicePlanRefresh?.());
  await page.getByRole("heading", { name: "Inserted plan item" }).waitFor();
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));

  const afterTop = await readingItem.evaluate((element) => element.getBoundingClientRect().top);
  assert(
    Math.abs(afterTop - anchoredTop) <= 4,
    `the visible Controller item moved from ${anchoredTop}px to ${afterTop}px after an in-place plan refresh`,
  );
  assert.equal(await notes.evaluate((element) => element.open), true, "expanded notes should stay open during the update");
  console.log("PASS real FloatingWindow and ControllerServicePlanView preserve the visible item and expanded notes after insertion above it");

  const nextItem = page
    .getByRole("heading", { name: "Plan item 26" })
    .locator("xpath=../..");
  const beforeDeleteTop = await nextItem.evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(() => window.removeServicePlanItem?.("item-25"));
  await readingItem.waitFor({ state: "detached" });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const afterDeleteTop = await nextItem.evaluate((element) => element.getBoundingClientRect().top);
  const scrollTopAfterDelete = await scrollport.evaluate((element) => element.scrollTop);
  const scrollportBounds = await scrollport.boundingBox();
  assert(scrollTopAfterDelete > 0, "deleting the visible Controller item should not reset the plan to its beginning");
  assert(scrollportBounds, "the Controller scroll container should have browser bounds");
  assert(
    afterDeleteTop >= scrollportBounds.y && afterDeleteTop < scrollportBounds.y + scrollportBounds.height,
    "the nearest surviving item should remain in the visible reading area after deletion",
  );
  assert(
    Math.abs(afterDeleteTop - beforeDeleteTop) <= 100,
    `the nearest Controller item moved from ${beforeDeleteTop}px to ${afterDeleteTop}px after deletion`,
  );
  assert.deepEqual(pageErrors, [], "the controller fixture should not emit browser errors");
  console.log("PASS real ControllerServicePlanView retains a nearby reading position when its visible item is deleted");
} finally {
  await browser.close();
  await server.close();
}
