import { type BrowserContext } from "@playwright/test";
import { test as diagnosticTest } from "./fixtures";
import { getE2EChurchId } from "./testChurch";
import { installControllerRuntime } from "./controllerRuntime";
import { installSavedSessionAuthRequestGuard } from "./authRequestPolicy";
import { isAllowedSmokeChurchRead } from "./smokeRequestPolicy";

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
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (!options.baseURL || !isAllowedSmokeChurchRead(
          request.method(),
          request.url(),
          options.baseURL,
          churchId,
        )) {
          await route.abort("blockedbyclient");
          throw new Error(`Read-only smoke guard blocked ${request.method()} ${pathname}.`);
        }
        await route.fallback();
      });
      const expectedEmail = process.env.E2E_TEST_EMAIL?.trim();
      if (!expectedEmail || !options.baseURL) {
        throw new Error("Smoke recovery requires the configured E2E account and API origin.");
      }
      const authGuard = await installSavedSessionAuthRequestGuard(
        context,
        options.baseURL,
        { email: expectedEmail, churchId },
      );
      // Home's controller navigation readiness check uses the same startup
      // snapshot as the controller suite. Install it before the first page
      // navigates so smoke diagnostics report measured startup state.
      await installControllerRuntime(context);
      context.setDefaultTimeout(options.actionTimeout ?? 15_000);
      context.setDefaultNavigationTimeout(options.navigationTimeout ?? 30_000);
      try {
        await use(context);
      } finally {
        const authRecoveryDiagnostics = authGuard.recoveryDiagnostics();
        console.info(
          `Smoke auth guard: ${authGuard.blockedRequests()} unsafe request(s); recovery ${JSON.stringify(authRecoveryDiagnostics)}.`,
        );
        await authGuard.dispose();
        await context.close();
        if (authGuard.blockedRequests() > 0) {
          throw new Error("Smoke authentication guard blocked an unsafe request; see sanitized browser diagnostics.");
        }
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
