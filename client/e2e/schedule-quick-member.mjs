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
