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
  plugins: [react()],
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
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      "http://127.0.0.1:3126/e2e/availability-workspace-fixture.html",
    );
    await page.getByRole("tab", { name: "Recipients", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab").count(), 2);
    assert.equal(await page.getByRole("checkbox").count(), 0);
    await page.screenshot({
      path: resolve(screenshots, `recipients-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Responses", exact: true }).click();
    if (width < 640) {
      assert.equal(await page.getByRole("table").isVisible(), false);
      await page.locator("summary").filter({ hasText: "Jane Smith" }).click();
      await page
        .getByLabel("Volunteer responses")
        .getByText("Unavailable", { exact: true })
        .waitFor();
    } else {
      assert.equal(await page.getByRole("table").isVisible(), true);
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Page overflows at ${width}px`,
    );
    await page.screenshot({
      path: resolve(screenshots, `responses-${width}.png`),
      fullPage: true,
    });
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
      path: resolve(screenshots, `send-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `Availability workspace desktop/mobile checks passed. Screenshots: ${screenshots}`,
  );
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
