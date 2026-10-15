import { type BrowserContext } from "@playwright/test";
import { test as diagnosticTest } from "./fixtures";

/**
 * Keep one authenticated browser context for the smoke project. PouchDB's
 * IndexedDB cache is browser-context scoped, so opening fresh pages between
 * cases reuses the initial synchronized data without sharing live page state.
 */
export const test = diagnosticTest.extend<{}, { smokeContext: BrowserContext }>({
  smokeContext: [
    async ({ browser }, use, workerInfo) => {
      const options = workerInfo.project.use;
      const context = await browser.newContext({
        baseURL: options.baseURL,
        storageState: options.storageState,
        ignoreHTTPSErrors: options.ignoreHTTPSErrors,
        viewport: options.viewport,
        userAgent: options.userAgent,
        serviceWorkers: "block",
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
    await use(smokeContext);
  },
});

export { expect } from "./fixtures";
