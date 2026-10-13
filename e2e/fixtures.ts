import { test as base } from "@playwright/test";
import { writeFile } from "node:fs/promises";

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

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const diagnostics: BrowserDiagnostic[] = [];

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

    try {
      await use(page);
    } finally {
      const report = JSON.stringify(diagnostics, null, 2);
      await writeFile(testInfo.outputPath("browser-diagnostics.json"), report);
      await testInfo.attach("browser-diagnostics.json", {
        body: Buffer.from(report),
        contentType: "application/json",
      });
    }
  },
});

export { expect } from "@playwright/test";
