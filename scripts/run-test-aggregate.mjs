import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import dotenv from "dotenv";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const authFile = resolve(repoRoot, "playwright/.auth/worshipsync-user.json");
const localHosts = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "local.worshipsync.net",
]);
let savedAuthSecrets = [];

dotenv.config({ path: resolve(repoRoot, ".env"), quiet: true });

export const E2E_SUITES = [
  {
    name: "Smoke / navigation",
    script: "test:e2e:smoke",
    auth: true,
    demoChurch: true,
  },
  {
    name: "Scheduling workflows",
    script: "test:e2e:scheduling",
    auth: true,
    demoChurch: true,
    scheduling: true,
  },
  {
    name: "Presentation Controller",
    script: "test:e2e:controller",
    auth: true,
  },
  {
    name: "Account responsive navigation",
    script: "test:e2e:responsive-navigation",
    client: true,
  },
  { name: "Home launcher", script: "test:e2e:home-launcher", client: true },
  { name: "Home navigation", script: "test:e2e:home-navigation", client: true },
  {
    name: "Mobile board controller",
    script: "test:e2e:board-controller-mobile",
    client: true,
  },
  {
    name: "Mobile modal behavior",
    script: "test:e2e:modal-mobile-focus",
    client: true,
  },
  {
    name: "Scheduling quick-member workflow",
    script: "test:e2e:schedule-quick-member",
    client: true,
  },
  {
    name: "My Schedule cards",
    script: "test:e2e:my-schedule-cards",
    client: true,
  },
  {
    name: "Service-plan refresh",
    script: "test:e2e:service-plan-refresh",
    client: true,
  },
  {
    name: "Availability workspace",
    script: "test:e2e:availability-workspace",
    client: true,
  },
  {
    name: "Resources responsive",
    script: "test:e2e:resources-responsive",
    client: true,
  },
  {
    name: "Teams responsive navigation",
    script: "test:e2e:teams-responsive-navigation",
    client: true,
  },
  {
    name: "Teams responsive-navigation smoke",
    script: "test:e2e:responsive-navigation:smoke",
    client: true,
  },
  {
    name: "Schedules performance",
    script: "test:e2e:schedules-performance",
    client: true,
  },
];

const firebaseSchedulingEnv = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_DATABASE_URL",
];

export function redactText(value, secrets = []) {
  let safe = String(value);
  for (const secret of [...secrets]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, "https://[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]")
    .replace(
      /(["']?(?:authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|private[_-]?key|password|secret)["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^"'\s,}]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{6}\b/g, "[redacted-code]");
}

function outputSecrets() {
  const secrets = [...savedAuthSecrets];
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      (/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|COOKIE|CREDENTIAL)/i.test(
        name,
      ) ||
        name === "E2E_BASE_URL")
    ) {
      secrets.push(value);
    }
  }
  return secrets;
}

async function loadSavedAuthSecrets() {
  try {
    const state = JSON.parse(await readFile(authFile, "utf8"));
    savedAuthSecrets = [
      ...(state.cookies ?? []).map((cookie) => cookie.value),
      ...(state.origins ?? []).flatMap((origin) =>
        (origin.localStorage ?? [])
          .filter((item) =>
            /auth|token|session|firebase|credential/i.test(item.name),
          )
          .map((item) => item.value),
      ),
    ].filter((value) => typeof value === "string" && value.length > 8);
  } catch {
    savedAuthSecrets = [];
  }
}

export function npmInvocation(
  args,
  platform = process.platform,
  npmCli = process.env.npm_execpath,
) {
  if (npmCli && existsSync(npmCli)) {
    return { command: process.execPath, args: [npmCli, ...args], shell: false };
  }
  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    args,
    shell: platform === "win32",
  };
}

function splitNpmCommand(script, client = false) {
  return ["run", script, ...(client ? ["--prefix", "client"] : [])];
}

function safeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createLineWriter(stream, source, onLine) {
  let pending = "";
  const flush = (final = false) => {
    while (true) {
      const match = /\r\n|\r|\n/.exec(pending);
      if (!match) break;
      const line = pending.slice(0, match.index);
      onLine(source, `${line}${match[0]}`);
      pending = pending.slice(match.index + match[0].length);
    }
    if (final && pending) {
      onLine(source, pending);
      pending = "";
    }
  };
  stream.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    flush();
  });
  return () => flush(true);
}

async function runNpmTask(task, logDirectory, logIndex) {
  const startedAt = performance.now();
  const logName = `${String(logIndex).padStart(2, "0")}-${safeSlug(task.name)}.log`;
  const logPath = resolve(logDirectory, logName);
  const secrets = outputSecrets();
  const output = { stdout: [], stderr: [] };
  let liveOutputCharacters = 0;
  let liveOutputWasTruncated = false;
  const liveOutputLimit = 64_000;
  const invocation = npmInvocation(task.args);
  const displayCommand = `npm ${task.args.join(" ")}`;

  console.log(`\n[RUN] ${task.name} (${displayCommand})`);
  const result = await new Promise((resolveResult) => {
    let settled = false;
    let spawnError = "";
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      env: process.env,
      shell: invocation.shell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const emit = (source, text) => {
      const safe = redactText(text, secrets);
      output[source].push(safe);
      const visible = safe.slice(
        0,
        Math.max(0, liveOutputLimit - liveOutputCharacters),
      );
      if (visible) {
        (source === "stdout" ? process.stdout : process.stderr).write(visible);
        liveOutputCharacters += visible.length;
      }
      if (!liveOutputWasTruncated && safe.length > visible.length) {
        process.stderr.write(
          "\n[aggregate runner] Further output is saved in the per-suite log.\n",
        );
        liveOutputWasTruncated = true;
      }
    };
    const flushStdout = createLineWriter(child.stdout, "stdout", emit);
    const flushStderr = createLineWriter(child.stderr, "stderr", emit);
    child.once("error", (error) => {
      spawnError = redactText(error.message, secrets);
    });
    child.once("close", (code, signal) => {
      flushStdout();
      flushStderr();
      if (settled) return;
      settled = true;
      resolveResult({ exitCode: code ?? 1, signal, spawnError });
    });
  });

  const durationMs = Math.round(performance.now() - startedAt);
  const status = result.exitCode === 0 ? "PASS" : "FAIL";
  const failure =
    result.spawnError ||
    (result.signal ? `Process stopped by ${result.signal}.` : "");
  const details =
    failure ||
    (status === "FAIL" ? `Command exited with status ${result.exitCode}.` : "");
  await writeFile(
    logPath,
    `Command: ${displayCommand}\nStatus: ${status}\nDuration: ${durationMs}ms\n${details ? `Failure: ${details}\n` : ""}\n[stdout]\n${output.stdout.join("")}\n[stderr]\n${output.stderr.join("")}`,
    "utf8",
  );
  return {
    name: task.name,
    status,
    durationMs,
    details,
    logPath,
    exitCode: result.exitCode,
  };
}

export async function runSequential(tasks, execute) {
  const results = [];
  for (const [index, task] of tasks.entries()) {
    if (task.skipReason) {
      results.push({
        name: task.name,
        status: "SKIPPED",
        durationMs: 0,
        details: task.skipReason,
      });
      continue;
    }
    try {
      const result = await execute(task, index);
      results.push({
        name: task.name,
        status: result.exitCode === 0 ? "PASS" : "FAIL",
        durationMs: result.durationMs ?? 0,
        details: result.details ?? "",
        ...result,
      });
    } catch (error) {
      results.push({
        name: task.name,
        status: "FAIL",
        durationMs: 0,
        details: String(error),
      });
    }
  }
  return results;
}

export function aggregateExitCode(results) {
  return results.some((result) => result.status !== "PASS") ? 1 : 0;
}

export async function runAggregateGroups(mode, { runChecks, runE2E }) {
  let checks = [];
  let e2e = null;
  if (mode === "quick" || mode === "all") checks = await runChecks();
  if (mode === "e2e" || mode === "all") e2e = await runE2E();
  return { checks, e2e };
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function printRows(title, rows) {
  if (!rows.length) return;
  console.log(`\n${title}`);
  console.log("-".repeat(78));
  console.log(
    `${"Suite".padEnd(38)} ${"Status".padEnd(9)} ${"Time".padEnd(9)} Details`,
  );
  for (const row of rows) {
    console.log(
      `${row.name.slice(0, 37).padEnd(38)} ${row.status.padEnd(9)} ${formatDuration(row.durationMs).padEnd(9)} ${row.details || ""}`,
    );
  }
}

async function saveCheckLog(logDirectory, fileName, detail) {
  const path = resolve(logDirectory, fileName);
  await writeFile(path, `${detail}\n`, "utf8");
  return path;
}

function checkBaseUrl() {
  const raw = process.env.E2E_BASE_URL?.trim();
  if (!raw)
    return {
      ok: false,
      message:
        "E2E_BASE_URL is missing. Start the local renderer/API and set its URL; the aggregate will not launch a server.",
    };
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return { ok: true, url: parsed, message: "Configured HTTP(S) target." };
  } catch {
    return {
      ok: false,
      message: "E2E_BASE_URL must be a valid HTTP or HTTPS URL.",
    };
  }
}

async function checkSavedAuthFile() {
  if (!process.env.E2E_TEST_EMAIL?.trim()) {
    return {
      ok: false,
      message:
        "E2E_TEST_EMAIL is missing; authenticated suites need the configured saved test account.",
    };
  }
  try {
    const state = JSON.parse(await readFile(authFile, "utf8"));
    if (
      !Array.isArray(state.cookies) ||
      !Array.isArray(state.origins) ||
      state.cookies.length + state.origins.length === 0
    ) {
      throw new Error();
    }
    return { ok: true, message: "Saved Playwright state exists." };
  } catch {
    return {
      ok: false,
      message:
        "Saved authentication is missing or unreadable at playwright/.auth/worshipsync-user.json. Create it explicitly; the aggregate will not request a verification email.",
    };
  }
}

function checkDemoChurch() {
  const configured = process.env.E2E_DEMO_CHURCH_ID?.trim();
  if (configured && configured !== "demo") {
    return {
      ok: false,
      message:
        "E2E_DEMO_CHURCH_ID is deprecated and must be omitted or equal demo; the E2E fixtures always target demo.",
    };
  }
  return { ok: true, message: "Using the built-in demo church identity." };
}

function checkSchedulingEnvironment() {
  const missing = firebaseSchedulingEnv.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length) {
    return {
      ok: false,
      message: `Scheduling requires server Firebase configuration: ${missing.join(", ")}.`,
    };
  }
  return {
    ok: true,
    message: "Required server Firebase configuration is present.",
  };
}

async function runE2ESuites(logDirectory, logIndexStart) {
  const preflight = [];
  let browserAvailable = false;
  const baseUrl = checkBaseUrl();
  let targetReachable = baseUrl.ok;
  let targetMessage = baseUrl.message;
  const savedAuth = await checkSavedAuthFile();
  const demoChurch = checkDemoChurch();
  const scheduling = checkSchedulingEnvironment();
  let browser;

  const browserStartedAt = performance.now();
  try {
    const requireClient = createRequire(
      resolve(repoRoot, "client/e2e/run-browser-suite.mjs"),
    );
    const { chromium } = requireClient(
      process.env.PLAYWRIGHT_MODULE_PATH || "playwright",
    );
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath))
      throw new Error("Playwright Chromium is not installed.");
    browser = await chromium.launch({ headless: true });
    browserAvailable = true;
    preflight.push({
      name: "Chromium availability",
      status: "PASS",
      durationMs: Math.round(performance.now() - browserStartedAt),
      details: "Installed browser launched successfully.",
    });
  } catch (error) {
    preflight.push({
      name: "Chromium availability",
      status: "FAIL",
      durationMs: Math.round(performance.now() - browserStartedAt),
      details: redactText(error.message, outputSecrets()),
    });
  }

  if (baseUrl.ok && browser) {
    const startedAt = performance.now();
    try {
      const page = await browser.newPage({
        ignoreHTTPSErrors: localHosts.has(baseUrl.url.hostname),
      });
      page.setDefaultNavigationTimeout(15_000);
      const response = await page.goto(baseUrl.url.toString(), {
        waitUntil: "domcontentloaded",
      });
      if (!response || response.status() >= 400)
        throw new Error(
          `The configured E2E target returned HTTP ${response?.status() ?? "no response"}.`,
        );
      preflight.push({
        name: "E2E target reachable",
        status: "PASS",
        durationMs: Math.round(performance.now() - startedAt),
        details: "Configured renderer/API responded; no server was started.",
      });
    } catch {
      targetReachable = false;
      targetMessage =
        "Could not reach the configured E2E_BASE_URL. Start the local renderer/API, then retry.";
      preflight.push({
        name: "E2E target reachable",
        status: "FAIL",
        durationMs: Math.round(performance.now() - startedAt),
        details: targetMessage,
      });
    }
  } else if (!baseUrl.ok) {
    preflight.push({
      name: "E2E target reachable",
      status: "FAIL",
      durationMs: 0,
      details: baseUrl.message,
    });
  } else {
    preflight.push({
      name: "E2E target reachable",
      status: "SKIPPED",
      durationMs: 0,
      details: "Target check was not run because Chromium is unavailable.",
    });
  }
  await browser?.close().catch(() => undefined);

  preflight.push({
    name: "Saved auth file",
    status: savedAuth.ok ? "PASS" : "FAIL",
    durationMs: 0,
    details: savedAuth.message,
  });
  preflight.push({
    name: "Demo church",
    status: demoChurch.ok ? "PASS" : "FAIL",
    durationMs: 0,
    details: demoChurch.message,
  });
  preflight.push({
    name: "Scheduling configuration",
    status: scheduling.ok ? "PASS" : "FAIL",
    durationMs: 0,
    details: scheduling.message,
  });

  const canValidateSavedSession =
    browserAvailable && targetReachable && savedAuth.ok;
  let sessionResult;
  if (canValidateSavedSession) {
    sessionResult = await runNpmTask(
      {
        name: "Saved-session validation",
        args: splitNpmCommand("test:e2e:auth:validate"),
      },
      logDirectory,
      logIndexStart,
    );
    preflight.push(sessionResult);
  } else {
    const reasons = [
      !browserAvailable && "Chromium is unavailable",
      !targetReachable && targetMessage,
      !savedAuth.ok && savedAuth.message,
    ].filter(Boolean);
    const logPath = await saveCheckLog(
      logDirectory,
      `${String(logIndexStart).padStart(2, "0")}-saved-session-validation.log`,
      reasons.join("\n"),
    );
    sessionResult = {
      name: "Saved-session validation",
      status: "SKIPPED",
      durationMs: 0,
      details: reasons.join(" "),
      logPath,
    };
    preflight.push(sessionResult);
  }

  const tasks = E2E_SUITES.map((suite) => {
    let skipReason = "";
    if (!browserAvailable)
      skipReason = "Skipped because Chromium is unavailable.";
    else if (suite.auth && !targetReachable)
      skipReason = "Skipped because E2E_BASE_URL is unavailable.";
    else if (suite.auth && !savedAuth.ok)
      skipReason =
        "Skipped because saved authentication prerequisites are missing.";
    else if (suite.demoChurch && !demoChurch.ok)
      skipReason = "Skipped because the configured E2E church is not demo.";
    else if (suite.auth && sessionResult.status !== "PASS")
      skipReason =
        "Skipped because safe saved-session validation did not pass; no email was requested.";
    else if (suite.scheduling && !scheduling.ok)
      skipReason = `Skipped: ${scheduling.message}`;
    return {
      name: suite.name,
      script: suite.script,
      args: splitNpmCommand(suite.script, suite.client),
      skipReason,
    };
  });

  const results = await runSequential(tasks, (task, index) =>
    runNpmTask(task, logDirectory, logIndexStart + index + 1),
  );
  return { preflight, results };
}

function printFinalReport(mode, checks, preflight, suites, logDirectory) {
  const title =
    mode === "e2e"
      ? "WorshipSync E2E Results"
      : mode === "quick"
        ? "WorshipSync Quick Test Results"
        : "WorshipSync Complete Test Results";
  console.log(`\n${title}`);
  if (checks.length) printRows("Quick checks", checks);
  if (preflight.length) printRows("E2E prerequisites", preflight);
  if (suites.length) printRows("E2E suites", suites);

  const failed = [...checks, ...preflight, ...suites].filter(
    (result) => result.status === "FAIL",
  );
  const skipped = [...checks, ...suites].filter(
    (result) => result.status === "SKIPPED",
  );
  const suiteCounts = {
    passed: suites.filter((result) => result.status === "PASS").length,
    failed: suites.filter((result) => result.status === "FAIL").length,
    skipped: suites.filter((result) => result.status === "SKIPPED").length,
  };
  const allResults = [...checks, ...preflight, ...suites];
  const totalMs = allResults.reduce(
    (total, result) => total + result.durationMs,
    0,
  );
  const exitCode = aggregateExitCode(allResults);

  if (mode !== "quick") {
    console.log(
      `\nSuites: ${suiteCounts.passed} passed, ${suiteCounts.failed} failed, ${suiteCounts.skipped} skipped`,
    );
  }
  if (failed.length) {
    console.log("\nFailed checks/suites:");
    for (const result of failed)
      console.log(
        `- ${result.name}${result.details ? `: ${result.details}` : ""}`,
      );
  }
  if (skipped.length) {
    console.log("\nSkipped / not run:");
    for (const result of skipped)
      console.log(
        `- ${result.name}${result.details ? `: ${result.details}` : ""}`,
      );
  }
  console.log(`\nTotal recorded duration: ${formatDuration(totalMs)}`);
  console.log(`Detailed logs: ${logDirectory}`);
  console.log(`Overall result: ${exitCode === 0 ? "PASS" : "FAILED"}`);
  return { exitCode, suiteCounts, totalMs };
}

async function main() {
  const mode = process.argv[2];
  if (!["quick", "e2e", "all"].includes(mode)) {
    console.error("Usage: node scripts/run-test-aggregate.mjs <quick|e2e|all>");
    process.exitCode = 2;
    return;
  }

  const runId = `${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-${process.pid}`;
  const logDirectory = resolve(repoRoot, "artifacts", "test-aggregate", runId);
  await mkdir(logDirectory, { recursive: true });
  await loadSavedAuthSecrets();

  const groups = await runAggregateGroups(mode, {
    runChecks: () =>
      runSequential(
        [{ name: "Quick checks", args: splitNpmCommand("checks") }],
        (task, index) => runNpmTask(task, logDirectory, index + 1),
      ),
    runE2E: () => runE2ESuites(logDirectory, mode === "all" ? 2 : 1),
  });
  const checks = groups.checks;
  const preflight = groups.e2e?.preflight ?? [];
  const suites = groups.e2e?.results ?? [];

  const report = printFinalReport(
    mode,
    checks,
    preflight,
    suites,
    logDirectory,
  );
  await writeFile(
    resolve(logDirectory, "summary.json"),
    JSON.stringify(
      {
        runId,
        mode,
        exitCode: report.exitCode,
        suiteCounts: report.suiteCounts,
        checks,
        preflight,
        suites,
      },
      null,
      2,
    ),
    "utf8",
  );
  process.exitCode = report.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(
      redactText(error?.stack || error?.message || error, outputSecrets()),
    );
    process.exitCode = 1;
  });
}
