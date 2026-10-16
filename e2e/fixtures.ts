import { test as base, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { allowedE2EAuthOrigins } from "./authOrigins";

type BrowserDiagnostic = {
  kind: "console_error" | "page_error" | "request_failed" | "http_error";
  source?: "app" | "external";
  message?: string;
  method?: string;
  url?: string;
  resourceType?: string;
  status?: number;
};

const redact = (value: string) => {
  let safe = value;
  for (const secret of [
    process.env.E2E_TEST_PASSWORD,
    process.env.MAILSLURP_API_KEY,
  ]) {
    if (secret) safe = safe.split(secret).join("[redacted]");
  }
  if (process.env.E2E_TEST_EMAIL) {
    safe = safe
      .split(process.env.E2E_TEST_EMAIL)
      .join("[redacted-email]");
  }
  safe = safe
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{6}\b/g, "[redacted-code]");
  return safe.slice(0, 1_000);
};

const safeUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    return redact(`${url.origin}${url.pathname}`);
  } catch {
    return "[unavailable-url]";
  }
};

const sourceFor = (rawUrl: string): "app" | "external" => {
  try {
    const appOrigin = process.env.E2E_BASE_URL
      ? new URL(process.env.E2E_BASE_URL).origin
      : "";
    return new URL(rawUrl).origin === appOrigin ? "app" : "external";
  } catch {
    return "external";
  }
};

const clearAuthenticationInputs = async (page: Page) => {
  await page
    .locator(
      'input[type="email"], input[name="email" i], input[autocomplete="username"], input[type="password"], input[autocomplete="current-password"]',
    )
    .evaluateAll((inputs) => {
      for (const input of inputs) {
        (input as HTMLInputElement).value = "";
      }
    })
    .catch(() => undefined);
};

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const diagnostics: BrowserDiagnostic[] = [];
    const blockedEmailGeneratingAuthRequests: { count: number } = { count: 0 };
    const blockedAutomaticSessionRenewals: { count: number } = { count: 0 };
    const blockedMailSlurpRequests: { count: number } = { count: 0 };
    const blockedUntrustedAuthRequests: { count: number } = { count: 0 };

    if (["chromium", "smoke"].includes(testInfo.project.name)) {
      const trustedAuthOrigins = process.env.E2E_BASE_URL
        ? allowedE2EAuthOrigins(process.env.E2E_BASE_URL)
        : new Set<string>();
      await page.route(/\/api\/auth(?:\/|$)/, async (route) => {
        const request = route.request();
        if (!trustedAuthOrigins.has(new URL(request.url()).origin)) {
          blockedUntrustedAuthRequests.count += 1;
          await route.abort("blockedbyclient");
          return;
        }
        if (request.method() !== "POST") {
          await route.continue();
          return;
        }

        let body: Record<string, unknown> = {};
        try {
          body = request.postDataJSON() as Record<string, unknown>;
        } catch {
          // An unreadable auth POST is unsafe for the normal controller suite.
        }
        const pathname = new URL(request.url()).pathname;
        const isNoEmailSessionRenewal =
          pathname === "/api/auth/session" && body.requestNewCode === false;
        if (isNoEmailSessionRenewal) {
          if (testInfo.project.name === "smoke") {
            blockedAutomaticSessionRenewals.count += 1;
            await route.abort("blockedbyclient");
            return;
          }
          await route.continue();
          return;
        }

        blockedEmailGeneratingAuthRequests.count += 1;
        await route.abort("blockedbyclient");
      });

      await page.route(/mailslurp\.com/i, async (route) => {
        blockedMailSlurpRequests.count += 1;
        await route.abort("blockedbyclient");
      });
    }

    page.on("console", (message) => {
      if (message.type() === "error") {
        diagnostics.push({
          kind: "console_error",
          message: redact(message.text()),
        });
      }
    });
    page.on("pageerror", (error) => {
      diagnostics.push({
        kind: "page_error",
        message: redact(error.message),
      });
    });
    page.on("requestfailed", (request) => {
      diagnostics.push({
        kind: "request_failed",
        source: sourceFor(request.url()),
        method: request.method(),
        url: safeUrl(request.url()),
        resourceType: request.resourceType(),
        message: redact(request.failure()?.errorText ?? "Request failed"),
      });
    });
    page.on("response", (response) => {
      const request = response.request();
      if (
        response.status() < 400 ||
        !["document", "fetch", "xhr"].includes(request.resourceType())
      ) {
        return;
      }
      diagnostics.push({
        kind: "http_error",
        source: sourceFor(response.url()),
        method: request.method(),
        url: safeUrl(response.url()),
        resourceType: request.resourceType(),
        status: response.status(),
      });
    });

    let testFailure: unknown;
    try {
      await use(page);
    } catch (error) {
      testFailure = error;
      await clearAuthenticationInputs(page);
    } finally {
      await clearAuthenticationInputs(page);
      const report = JSON.stringify(
        {
          blockedEmailGeneratingAuthRequests: blockedEmailGeneratingAuthRequests.count,
          blockedAutomaticSessionRenewals: blockedAutomaticSessionRenewals.count,
          blockedMailSlurpRequests: blockedMailSlurpRequests.count,
          blockedUntrustedAuthRequests: blockedUntrustedAuthRequests.count,
          diagnostics,
        },
        null,
        2,
      );
      await writeFile(testInfo.outputPath("browser-diagnostics.json"), report);
      await testInfo.attach("browser-diagnostics.json", {
        body: Buffer.from(report),
        contentType: "application/json",
      });
    }

    if (
      !testFailure &&
      (blockedEmailGeneratingAuthRequests.count > 0 ||
        blockedAutomaticSessionRenewals.count > 0 ||
        blockedMailSlurpRequests.count > 0 ||
        blockedUntrustedAuthRequests.count > 0)
    ) {
      throw new Error(
        `The browser test safety guard blocked ${blockedEmailGeneratingAuthRequests.count} unsafe auth POST(s), ${blockedAutomaticSessionRenewals.count} automatic smoke session renewal(s), ${blockedMailSlurpRequests.count} MailSlurp request(s), and ${blockedUntrustedAuthRequests.count} untrusted auth request(s). See sanitized browser-diagnostics.json.`,
      );
    }
    if (testFailure) throw testFailure;
  },
});

export { expect } from "@playwright/test";
