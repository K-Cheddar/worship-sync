import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "../../node_modules/playwright");
const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "worshipsync-resources-"));
const output = resolve(root, "../artifacts/resources-responsive");
await mkdir(output, { recursive: true });
const modules = new Map([
  ["\0resources-api", `export * from ${JSON.stringify(resolve(root, "src/api/auth.ts").replaceAll("\\", "/"))};
    export const listChurchResources=async()=>({success:true,resources:window.resourceFixtures});
    export const getChurchStorageQuota=async()=>({success:true,quotas:{r2:{used:25000,limit:500000000,unit:"bytes"}}});
    export const deleteChurchResource=async()=>({success:true});
    export const getChurchResourceUrl=async()=>({url:"https://example.test/file.pdf",expiresAt:new Date(Date.now()+900000).toISOString()});
    export const getExternalResourceResolution=async()=>({url:"https://example.test",sourceKind:"external",mediaType:"web",provider:"google-drive"});`],
  ["\0resources-db", "export const updateAllDocs=async()=>true;"],
  ["\0resources-menu", 'import React from "react"; export default ()=>React.createElement("button",null,"Menu");'],
  ["\0resources-user", 'import React from "react"; export default ()=>React.createElement("span",null,"Account");'],
]);
const plugin = {
  name: "resources-boundary-fixtures", enforce: "pre",
  resolveId(source, importer) {
    const normalized = importer?.replaceAll("\\", "/") || "";
    if (source.endsWith("/api/auth") && (normalized.endsWith("/pages/Resources.tsx") || normalized.endsWith("/components/ResourcePreview.tsx") || normalized.endsWith("/StorageUsage/useChurchStorageQuota.ts"))) return "\0resources-api";
    if (normalized.endsWith("/pages/Resources.tsx") && source === "../utils/dbUtils") return "\0resources-db";
    if (normalized.endsWith("/AppPageShell/AppWorkspaceShell.tsx")) {
      if (source.includes("HomeToolbarMenu")) return "\0resources-menu";
      if (source.includes("UserSection")) return "\0resources-user";
    }
    return null;
  },
  load(id) { return modules.get(id) ?? null; },
};
let server, browser;
try {
  await build({ configFile: false, root, logLevel: "error", plugins: [plugin, react()], resolve: { alias: { "@": resolve(root, "src") } }, build: { outDir: join(directory, "dist"), rollupOptions: { input: resolve(root, "e2e/resources-responsive-fixture.html") } } });
  server = await preview({ configFile: false, root, build: { outDir: join(directory, "dist") }, preview: { host: "127.0.0.1", port: 3128, strictPort: true } });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ hasTouch: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["dark", "light"]) {
    for (const width of [320, 375, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("http://127.0.0.1:3128/e2e/resources-responsive-fixture.html#/resources");
      await page.evaluate((theme) => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
      await page.getByRole("button", { name: "Preview June-2026-by-date.pdf" }).waitFor();
      const sectionWidth = await page.locator("section").first().evaluate((node) => node.clientWidth);
      const compact = sectionWidth < 768;
      await page.getByRole(compact ? "list" : "table", { name: "Resources", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: page must not overflow`);
      assert.equal(await page.getByRole("button", { name: "Preview June-2026-by-date.pdf" }).count(), 1);
      if (compact) {
        const nameToggle = page.getByRole("button", { name: /^Toggle full name for Very-long-service/ });
        const measureName = () => nameToggle.locator("span").first().evaluate((node) => {
          const style = getComputedStyle(node);
          return { height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) };
        });
        const collapsed = await measureName();
        assert.ok(collapsed.height <= collapsed.lineHeight + 1, "names should start on one truncated line");
        await nameToggle.tap();
        assert.equal(await nameToggle.getAttribute("aria-expanded"), "true");
        const expanded = await measureName();
        assert.ok(expanded.height > expanded.lineHeight * 2, "expanded names should show all their lines");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "expanded name must wrap without overflow");
        assert.equal(await page.getByRole("dialog").count(), 0, "touching the name should not preview");
        await nameToggle.tap();
        assert.equal(await nameToggle.getAttribute("aria-expanded"), "false");
        assert.ok((await measureName()).height <= collapsed.lineHeight + 1, "touching again should restore one line");
        const bounds = await page.getByRole("button", { name: "Actions for June-2026-by-date.pdf" }).boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44, "44px overflow touch target");
        await page.getByRole("button", { name: "Sort resources" }).click();
        await page.getByRole("menuitemradio", { name: "Name descending", exact: true }).click();
        await page.getByRole("button", { name: "Actions for Worship flow" }).focus();
        await page.keyboard.press("Enter");
        await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor();
        assert.equal(await page.getByRole("menuitem", { name: "Download", exact: true }).count(), 0);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await page.getByRole("button", { name: "Select all", exact: true }).click();
        assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 10);
        await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
      }
      await page.screenshot({ path: join(output, `${theme}-${width}.png`), fullPage: true });
      console.log(`${theme} ${width}px: ${compact ? "compact list" : "table"}, no overflow`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await rm(directory, { recursive: true, force: true });
}
