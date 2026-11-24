import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import sharp from "sharp";
import { build, preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const outDir = resolve(root, "node_modules/.cache/unavailable-source-thumbnail-build");
const viteOptions = {
  configFile: false,
  root,
  plugins: [react()],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "e2e/unavailable-source-thumbnail-layering-fixture.html"),
    },
  },
};

await build(viteOptions);
const server = await preview({
  ...viteOptions,
  preview: { host: "127.0.0.1", port: 3116, strictPort: true },
});
const browser = await chromium.launch({ headless: true });

const scaleFromStyle = (style) => {
  const match = style.match(/scale\(([^)]+)\)/);
  return match ? Number(match[1]) : 0;
};

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:3116/e2e/unavailable-source-thumbnail-layering-fixture.html");
  await page.getByText("Local source on another device").first().waitFor();
  await page.evaluate(() => document.fonts.ready);

  const slider = page.getByRole("slider", { name: "Thumbnail zoom" });
  const firstCanvas = page
    .getByTestId("unavailable-source-slide-tile")
    .getByTestId("static-slide-reference-canvas");
  const initialScale = scaleFromStyle(await firstCanvas.getAttribute("style") || "");
  assert(initialScale > 0, `shared thumbnail geometry should resolve a positive scale, got ${initialScale}`);
  const initialHeadingHeight = await page
    .getByText("Local source on another device").first()
    .evaluate((element) => element.getBoundingClientRect().height);

  const sourceLayout = await page
    .getByRole("status")
    .first()
    .evaluate((status) => {
      const thumbnail = status.closest("[data-testid='static-slide-thumbnail']");
      const source = [...status.querySelectorAll("p")].find((paragraph) =>
        paragraph.textContent?.includes("Main camera from the worship hall"),
      );
      const heading = status.querySelector("p");
      const tile = status.closest("li");
      if (!thumbnail || !source || !heading || !tile) throw new Error("Missing thumbnail status source text");
      const thumbnailRect = thumbnail.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      return {
        statusFontSize: getComputedStyle(heading).fontSize,
        tileIsolation: getComputedStyle(tile).isolation,
        thumbnailIsolation: getComputedStyle(thumbnail).isolation,
        sourceInsideThumbnail:
          sourceRect.left >= thumbnailRect.left - 1 &&
          sourceRect.right <= thumbnailRect.right + 1,
        sourceScrolls: source.scrollWidth > source.clientWidth + 1,
      };
    });
  assert.equal(sourceLayout.statusFontSize, "80px", "thumbnail text should use reference-space typography");
  assert.equal(sourceLayout.tileIsolation, "isolate", "slide tiles should establish local stacking contexts");
  assert.equal(sourceLayout.thumbnailIsolation, "isolate", "thumbnail content should establish local stacking contexts");
  assert(sourceLayout.sourceInsideThumbnail, "long source text should stay within the thumbnail");
  assert.equal(sourceLayout.sourceScrolls, false, "long source text should wrap instead of overflowing");

  await slider.press("ArrowRight");
  await page.waitForFunction((before) => {
    const canvas = document.querySelector(
      "[data-testid='unavailable-source-slide-tile'] [data-testid='static-slide-reference-canvas']",
    );
    const value = canvas ? Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1]) : 0;
    return value > before;
  }, initialScale);
  const zoomedScale = scaleFromStyle(await firstCanvas.getAttribute("style") || "");
  const zoomedHeadingHeight = await page
    .getByText("Local source on another device").first()
    .evaluate((element) => element.getBoundingClientRect().height);
  assert(zoomedScale > initialScale, "zoom changes should update the shared thumbnail scale");
  assert(
    zoomedHeadingHeight > initialHeadingHeight,
    "reference-space status text should scale with the thumbnail canvas",
  );

  await page.getByRole("button", { name: "Open controller drawer" }).click();
  const drawer = page.getByTestId("controller-drawer");
  const indicator = page
    .getByTestId("saved-still-slide-tile")
    .getByRole("status");
  await drawer.waitFor();
  const indicatorRect = await indicator.boundingBox();
  const drawerRect = await drawer.boundingBox();
  assert(indicatorRect && drawerRect, "drawer and unavailable indicator should have browser bounds");
  const sampleX = Math.floor(indicatorRect.x + indicatorRect.width - 5);
  const sampleY = Math.floor(indicatorRect.y + indicatorRect.height / 2);
  assert(
    sampleX >= drawerRect.x && sampleY >= drawerRect.y && sampleY < drawerRect.y + drawerRect.height,
    "the drawer should cover the saved-thumbnail indicator region",
  );
  const screenshot = await page.screenshot({ animations: "disabled" });
  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelOffset = (sampleY * info.width + sampleX) * info.channels;
  const sampledPixel = [...data.subarray(pixelOffset, pixelOffset + 3)];
  assert(
    sampledPixel[1] > 100,
    `the drawer should visibly cover the status indicator; sampled pixel was ${sampledPixel}`,
  );

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction((before) => {
    const canvas = document.querySelector(
      "[data-testid='unavailable-source-slide-tile'] [data-testid='static-slide-reference-canvas']",
    );
    const value = canvas ? Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1]) : 0;
    return value > before;
  }, zoomedScale);
  const landscapeScale = scaleFromStyle(await firstCanvas.getAttribute("style") || "");
  assert(landscapeScale > zoomedScale, "landscape resizing should recalculate the shared scale");

  await slider.press("ArrowLeft");
  await slider.press("ArrowLeft");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector(
      "[data-testid='unavailable-source-slide-tile'] [data-testid='static-slide-reference-canvas']",
    );
    const value = canvas ? Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1]) : 0;
    return value > 0.1 && value < 0.8;
  });
  assert.deepEqual(pageErrors, [], "the thumbnail fixture should not emit browser errors");
  console.log("PASS thumbnail statuses scale through zoom and responsive layouts, and the mobile drawer paints above saved-thumbnail diagnostics");
} finally {
  await browser.close();
  await server.close();
}
