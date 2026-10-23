import { type BrowserContext } from "@playwright/test";
import { test as diagnosticTest } from "./fixtures";
import { getE2EChurchId } from "./testChurch";

/**
 * Keep one authenticated browser context for the smoke project. PouchDB's
 * IndexedDB cache is browser-context scoped, so opening fresh pages between
 * cases reuses the initial synchronized data without sharing live page state.
 */
export const test = diagnosticTest.extend<{}, { smokeContext: BrowserContext }>({
  smokeContext: [
    async ({ browser }, use, workerInfo) => {
      const churchId = getE2EChurchId();
      const options = workerInfo.project.use;
      const context = await browser.newContext({
        baseURL: options.baseURL,
        storageState: options.storageState,
        ignoreHTTPSErrors: options.ignoreHTTPSErrors,
        viewport: options.viewport,
        userAgent: options.userAgent,
        serviceWorkers: "block",
      });
      // Refuse church-scoped traffic outside the explicitly selected test tenant.
      await context.route(/\/api\/churches\/[^/]+(?:\/|$)/, async (route) => {
        const requestedChurch = new URL(route.request().url()).pathname.match(/\/api\/churches\/([^/]+)/)?.[1];
        if (!requestedChurch || decodeURIComponent(requestedChurch) !== churchId) {
          await route.abort("blockedbyclient");
          throw new Error(`Smoke request targeted a church other than the approved E2E church (${churchId}).`);
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
          await route.abort("blockedbyclient");
          throw new Error(`Read-only smoke guard blocked ${route.request().method()} ${new URL(route.request().url()).pathname}`);
        }
        await route.fallback();
      });
      context.setDefaultTimeout(options.actionTimeout ?? 15_000);
      context.setDefaultNavigationTimeout(options.navigationTimeout ?? 30_000);
      try {
        await use(context);
      } finally {
        await context.close();
      }
    },
    { scope: "worker" },
  ],
  context: async ({ smokeContext }, use) => {
    try {
      await use(smokeContext);
    } finally {
      // The context is worker-scoped, so Playwright's page fixture cannot
      // retire its page by disposing the context after each test. Close pages
      // here so route subscriptions and component effects unmount before the
      // next smoke case starts.
      for (const page of smokeContext.pages()) await page.close();
    }
  },
});

export { expect } from "./fixtures";
