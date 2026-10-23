import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const { build } = require("esbuild");
const root = process.cwd();
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["./e2e/modal-mobile-focus-entry.tsx"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  alias: { "@": resolve(root, "src") },
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.env": JSON.stringify({
      DEV: true,
      PROD: false,
      MODE: "development",
      SSR: false,
      BASE_URL: "/",
      VITE_FIREBASE_API_KEY: "",
    }),
  },
});
const javascript = bundle.outputFiles[0]?.text;
assert(javascript, "Modal browser fixture bundle was not produced");

const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(javascript);
    return;
  }
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html>
      <html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <style>
        * { box-sizing: border-box; }
        html, body, #root { width: 100%; height: 100%; margin: 0; }
        #root { overflow: hidden; }
        [data-testid="modal-overlay-host"] { position: fixed; inset: 0; }
        [role="dialog"] { position: fixed; inset: 0; width: 100vw; height: 100dvh; }
      </style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
    return;
  }
  res.statusCode = 404;
  res.end();
});

await new Promise((resolveListen) => server.listen(3115, "127.0.0.1", resolveListen));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 720 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => console.error("BROWSER ERROR", error.message));
  await page.goto("http://127.0.0.1:3115/");
  const bodyBeforeOpen = await page.evaluate(() => ({
    inlineOverflow: document.body.style.overflow,
    computedOverflow: getComputedStyle(document.body).overflow,
    inlinePaddingRight: document.body.style.paddingRight,
  }));
  await page.getByRole("button", { name: "Media Library" }).click();
  await page.getByRole("dialog", { name: "Media Library" }).waitFor();
  const before = await page.evaluate(() => {
    const main = document.getElementById("controller-main");
    const scroller = document.getElementById("controller-scroll-area");
    const opener = document.getElementById("media-library-opener");
    if (!main || !scroller || !(opener instanceof HTMLButtonElement)) throw new Error("Fixture elements are missing");
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentScrollWidth: document.documentElement.scrollWidth,
      visualViewportOffsetLeft: window.visualViewport?.offsetLeft ?? 0,
      controllerLeft: main.getBoundingClientRect().left,
      controllerWidth: main.getBoundingClientRect().width,
      controllerScrollLeft: scroller.scrollLeft,
      controllerScrollTop: scroller.scrollTop,
      activeElement: document.activeElement?.id,
      bodyInlineOverflow: document.body.style.overflow,
      bodyComputedOverflow: getComputedStyle(document.body).overflow,
      bodyInlinePaddingRight: document.body.style.paddingRight,
    };
  });
  await page.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("dialog", { name: "Media Library" }).waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.id === "media-library-opener");
  const after = await page.evaluate(() => {
    const main = document.getElementById("controller-main");
    const scroller = document.getElementById("controller-scroll-area");
    if (!main || !scroller) throw new Error("Fixture elements are missing");
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentScrollWidth: document.documentElement.scrollWidth,
      visualViewportOffsetLeft: window.visualViewport?.offsetLeft ?? 0,
      controllerLeft: main.getBoundingClientRect().left,
      controllerWidth: main.getBoundingClientRect().width,
      controllerScrollLeft: scroller.scrollLeft,
      controllerScrollTop: scroller.scrollTop,
      activeElement: document.activeElement?.id,
      bodyInlineOverflow: document.body.style.overflow,
      bodyComputedOverflow: getComputedStyle(document.body).overflow,
      bodyInlinePaddingRight: document.body.style.paddingRight,
    };
  });
  assert.deepEqual(after, {
    ...before,
    activeElement: "media-library-opener",
    bodyInlineOverflow: bodyBeforeOpen.inlineOverflow,
    bodyComputedOverflow: bodyBeforeOpen.computedOverflow,
    bodyInlinePaddingRight: bodyBeforeOpen.inlinePaddingRight,
  }, "fullscreen close must restore focus and Radix scroll-lock styles without shifting the mobile viewport or controller");
  console.log("PASS 375x720: fullscreen close restored keyboard focus without horizontal viewport or controller movement");
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
