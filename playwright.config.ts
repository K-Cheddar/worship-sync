import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config({ quiet: true });

const rawBaseURL = process.env.E2E_BASE_URL?.trim();
if (!rawBaseURL) {
  throw new Error("E2E_BASE_URL is required to run the WorshipSync browser tests.");
}

let baseURL: string;
try {
  const parsed = new URL(rawBaseURL);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid protocol");
  }
  baseURL = parsed.toString();
} catch {
  throw new Error("E2E_BASE_URL must be a valid HTTP or HTTPS URL.");
}

const authFile = resolve("playwright/.auth/worshipsync-user.json");
const controllerSpec = resolve("e2e/controller.spec.ts");
const cliArgs = process.argv.slice(2);
const requestedProjects = cliArgs.flatMap((arg, index) => {
  if (arg.startsWith("--project=")) {
    return arg.slice("--project=".length).split(",");
  }
  if (arg === "--project") {
    return (cliArgs[index + 1] ?? "").split(",");
  }
  return [];
});
if (
  requestedProjects.includes("chromium") &&
  !existsSync(controllerSpec)
) {
  throw new Error(
    "No controller browser test exists at e2e/controller.spec.ts. Refusing to run authentication setup alone as a successful controller test.",
  );
}
const traceFlagIndex = cliArgs.indexOf("--trace");
const requestedTrace = cliArgs.find((arg) => arg.startsWith("--trace="))?.split("=", 2)[1]
  ?? (traceFlagIndex >= 0 ? cliArgs[traceFlagIndex + 1] : undefined);
if (requestedTrace && requestedTrace !== "off") {
  throw new Error(
    "Playwright tracing is disabled for authenticated WorshipSync tests because traces can contain reusable auth request data. Use the HTML report and sanitized browser diagnostics instead.",
  );
}

const localDevelopmentHosts = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "local.worshipsync.net",
]);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /\.(setup|spec)\.ts$/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: localDevelopmentHosts.has(new URL(baseURL).hostname),
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
        screenshot: "off",
        trace: "off",
      },
    },
    {
      name: "auth",
      testMatch: /auth\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        storageState: { cookies: [], origins: [] },
        screenshot: "off",
        trace: "off",
      },
    },
    {
      name: "auth-refresh",
      testMatch: /auth\.refresh\.setup\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
        screenshot: "off",
        trace: "off",
      },
    },
    {
      name: "chromium",
      testMatch: /controller\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        storageState: authFile,
        screenshot: "only-on-failure",
        trace: "off",
      },
    },
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        storageState: authFile,
        screenshot: "only-on-failure",
        trace: "off",
      },
    },
  ],
});
