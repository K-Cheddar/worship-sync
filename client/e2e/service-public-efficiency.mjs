import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build, preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const outDir = resolve(root, "node_modules/.cache/service-public-efficiency-build");
const viteOptions = {
  configFile: false,
  root,
  plugins: [react()],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "e2e/service-public-efficiency-fixture.html"),
    },
  },
};

await build(viteOptions);
const server = await preview({
  ...viteOptions,
  preview: { host: "127.0.0.1", port: 3116, strictPort: true },
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:3116/e2e/service-public-efficiency-fixture.html");
  await page.getByRole("heading", { name: "Efficiency Demo Service" }).waitFor();
  await page.getByRole("heading", { name: "Stress item 120" }).waitFor();

  const sample = () => page.evaluate(() => ({
    domNodes: document.getElementsByTagName("*").length,
    loadedResources: performance.getEntriesByType("resource").length,
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    serviceItems: Array.from(document.querySelectorAll("main h3"))
      .filter((heading) => heading.textContent?.startsWith("Stress item ")).length,
  }));

  const initial = await sample();
  assert.equal(initial.serviceItems, 120, "the demo fixture should render every service item");

  const resourceButton = page.getByRole("button", { name: "View Notes: Call sheet 1", exact: true });
  await resourceButton.click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });

  const samples = [initial];
  for (let cycle = 0; cycle < 12; cycle += 1) {
    await page.evaluate(() => window.setServicePublicFixtureRoute?.("/home"));
    await page.getByRole("heading", { name: "Demo Home" }).waitFor();
    await page.evaluate(() => window.setServicePublicFixtureRoute?.("/viewer"));
    await page.getByRole("heading", { name: "Efficiency Demo Service" }).waitFor();
    samples.push(await sample());
  }

  await page.waitForTimeout(1_100);
  const afterClockTick = await sample();
  assert.equal(afterClockTick.serviceItems, initial.serviceItems, "clock updates should preserve the rendered service content");
  assert.equal(samples.at(-1)?.domNodes, initial.domNodes, "repeated route transitions should return to the same DOM size");
  assert.equal(samples.at(-1)?.serviceItems, initial.serviceItems, "repeated route transitions should preserve the item count");
  assert.deepEqual(pageErrors, [], "the public viewer fixture should not emit browser errors");

  console.log("PASS ServicePublicView retained stable content across 12 viewer/home cycles and a one-second clock update");
  console.log(JSON.stringify({ initial, afterClockTick, routeCycleSamples: samples }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
