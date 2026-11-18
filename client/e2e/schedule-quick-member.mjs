import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { expect } = require("@playwright/test");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
);
const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  appType: "custom",
  plugins: [
    {
      name: "schedule-quick-member-fixture",
      enforce: "pre",
      load(id) {
        if (id.replaceAll("\\", "/").endsWith("/context/controllerInfo.tsx")) return "import {createContext} from 'react'; export const ControllerInfoContext=createContext({});";
        if (id.replaceAll("\\", "/").endsWith("/api/auth.ts"))
          return "export const getTeamsBootstrap=async()=>({members:[]}); export class AuthApiError extends Error {}; export const searchTeamRosterCandidates=async()=>({candidates:[]});";
      },
      configureServer(instance) {
        instance.middlewares.use(async (req, res, next) => {
          if (req.url?.split("?")[0] !== "/schedule-quick-member")
            return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await instance.transformIndexHtml(
              req.url,
              '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/schedule-quick-member-entry.tsx"></script></body></html>',
            ),
          );
        });
      },
    },
    react(),
  ],
  optimizeDeps: {
    entries: ["e2e/schedule-quick-member-entry.tsx"],
    esbuildOptions: { absWorkingDir: root },
  },
  cacheDir: resolve(root, "node_modules/.vite-schedule-quick-member"),
  resolve: { alias: { "@": resolve(root, "src") } },
  server: { host: "127.0.0.1", port: 3116, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 1280, height: 800 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
    await page.goto("http://127.0.0.1:3116/schedule-quick-member");
    await page.getByRole("button", { name: "Choose assignee" }).click();
    const options = page.getByTestId("schedule-assignment-options");
    await options.waitFor();
    const initialMetrics = await options.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    assert(
      initialMetrics.scrollHeight > initialMetrics.clientHeight,
      "the fixture should contain enough members to require scrolling",
    );

    const optionsBounds = await options.boundingBox();
    assert.ok(optionsBounds, "the Available Members list should have browser bounds");
    await page.mouse.move(
      optionsBounds.x + optionsBounds.width / 2,
      optionsBounds.y + optionsBounds.height / 2,
    );
    await page.mouse.wheel(0, 480);
    await page.waitForFunction(() => {
      const list = document.querySelector<HTMLElement>("[data-testid='schedule-assignment-options']");
      return Boolean(list && list.scrollTop > 0);
    });
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    const afterWheel = await options.evaluate((element) => element.scrollTop);
    assert(afterWheel > 0, "manual wheel scrolling should move through available members");

    await page.evaluate(() => window.forcePickerRerender?.());
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    assert.equal(
      await options.evaluate((element) => element.scrollTop),
      afterWheel,
      "an unrelated React render should preserve manual list scrolling",
    );

    await page.evaluate(() => window.addPickerMember?.());
    await page.getByRole("option", { name: /Member 37/ }).waitFor();
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    assert.equal(
      await options.evaluate((element) => element.scrollTop),
      afterWheel,
      "an asynchronous member-list update should preserve manual list scrolling",
    );

    const dragMetrics = await options.evaluate((element) => ({
      clientHeight: element.clientHeight,
      offsetWidth: element.offsetWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    const scrollbarWidth = dragMetrics.offsetWidth - dragMetrics.clientWidth;
    if (scrollbarWidth > 0) {
      const thumbHeight = Math.max(
        (dragMetrics.clientHeight * dragMetrics.clientHeight) / dragMetrics.scrollHeight,
        16,
      );
      const trackRange = dragMetrics.clientHeight - thumbHeight;
      const thumbTop = trackRange * (
        dragMetrics.scrollTop / (dragMetrics.scrollHeight - dragMetrics.clientHeight)
      );
      const scrollbarX = optionsBounds.x + optionsBounds.width - scrollbarWidth / 2;
      await page.mouse.move(scrollbarX, optionsBounds.y + thumbTop + thumbHeight / 2);
      await page.mouse.down();
      await page.mouse.move(
        scrollbarX,
        optionsBounds.y + dragMetrics.clientHeight - thumbHeight / 2,
        { steps: 8 },
      );
      await page.mouse.up();
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      const afterScrollbarDrag = await options.evaluate((element) => element.scrollTop);
      assert(
        afterScrollbarDrag > dragMetrics.scrollTop,
        "dragging the native scrollbar should move the Available Members list",
      );
    } else {
      console.log("SKIP native scrollbar drag: this browser uses overlay scrollbars");
    }

    await page.getByRole("option", { name: /Member 37/ }).click();
    await expect(page.getByRole("status")).toHaveText("Selected Member 37");
    await page.getByRole("button", { name: "Choose assignee" }).click();
    await page.getByRole("button", { name: "Add new member" }).click();
    await page.getByRole("textbox", { name: "First name" }).fill("Jordan");
    await page.getByRole("textbox", { name: "First name" }).press("Tab");
    assert.equal(
      await page
        .getByRole("textbox", { name: "Last name" })
        .evaluate((node) => node === node.ownerDocument.activeElement),
      true,
    );
    await page.getByRole("textbox", { name: "Last name" }).fill("Ray");
    await page
      .getByRole("textbox", { name: "Mobile phone (optional)" })
      .fill("2025550123");
    assert.equal(
      await page
        .getByRole("textbox", { name: "Mobile phone (optional)" })
        .inputValue(),
      "(202) 555-0123",
    );
    await page
      .getByRole("textbox", { name: "Email (optional)" })
      .fill("jordan@example.com");
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      "picker fits viewport",
    );
    await page
      .getByRole("button", { name: "Add & assign" })
      .scrollIntoViewIfNeeded();
    await mkdir(resolve(root, "../test-results"), { recursive: true });
    await page.screenshot({
      path: resolve(
        root,
        `../test-results/schedule-quick-member-${viewport.width}.png`,
      ),
    });
    await expect(page.getByRole("button", { name: "Add & assign" })).toBeEnabled();
    await page.getByRole("textbox", { name: "Email (optional)" }).press("Enter");
    await page
      .getByRole("status")
      .filter({ hasText: "Saved Jordan Ray" })
      .waitFor();
    await page.getByRole("button", { name: "Choose assignee" }).click();
    await page.getByRole("button", { name: "Add new member" }).click();
    await page.getByRole("textbox", { name: "First name" }).press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Choose assignee" })
        .evaluate((node) => node === node.ownerDocument.activeElement),
      true,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS quick-member keyboard, contact entry and viewport ${viewport.width}x${viewport.height}`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
