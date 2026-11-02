import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
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
    workflow: "smoke",
  },
  {
    name: "Scheduling workflows",
    script: "test:e2e:scheduling",
    auth: true,
    demoChurch: true,
    scheduling: true,
    workflow: "scheduling",
  },
  {
    name: "Presentation Controller",
    script: "test:e2e:controller",
    auth: true,
    workflow: "controller",
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
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
      "[redacted-private-key]",
    )
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, "https://[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]")
    .replace(
      /(["']?(?:authorization|cookie|set-cookie|x-api-key|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|private[_ -]?key|password|secret)["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^"'\s,}]+/gi,
      "$1[redacted]",
    )
    .replace(
      /(["']?(?:otp|passcode|(?:one[_-]?time|verification|authentication|auth|email|sms)[_-]?code)["']?\s*[:=]\s*["']?)(\d{4,8})(["']?)/gi,
      "$1[redacted-code]$3",
    )
    .replace(
      /\b((?:one[- ]time|verification|authentication|auth|login|sign[- ]?in|email|sms|text)\s+(?:verification\s+)?(?:code|passcode))\s*(?::|=|#|\bis\b)?\s*(\d{4,8})\b/gi,
      "$1 [redacted-code]",
    )
    .replace(/\b(OTP|2FA|MFA)\s*(?::|=|#)?\s*(\d{4,8})\b/gi, "$1 [redacted-code]")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[redacted]")
    .replace(/(https?:\/\/[^\s#]*)#[^\s]*/gi, "$1#[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted-email]");
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

export function getReservedSchedulingTeamId(env = process.env) {
  return (
    env.E2E_SCHEDULING_TEAM_ID?.trim() ||
    `e2e-scheduling-${createHash("sha256").update("demo").digest("hex").slice(0, 16)}`
  );
}

export function evaluateApplicationWorkflowAccess(
  auth,
  home = {},
  schedulingTeamId = getReservedSchedulingTeamId(),
) {
  if (home.homeContentLoaded === false) {
    const flags = {
      bootstrapStatus: auth?.__e2eBootstrapStatus ?? null,
      authStateTrusted: false,
      authenticated: null,
      sessionKind: null,
      churchId: null,
      role: null,
      controllerAccess: null,
      teamsPermission: null,
      servicesPermission: null,
      teamScopeCount: null,
      canViewTeams: null,
      canEditTeams: null,
      canViewServices: null,
      reservedTeamScope: null,
      home: {
        homeContentLoaded: false,
        teamsAndServicesLinkRendered: null,
        workspaceNavigationLoaded: null,
        workspaceLinks: [],
        controllersSectionVisible: null,
        controllerProfilesLoaded: null,
        presentationControllerLinkRendered: null,
      },
    };
    const result = {
      ok: false,
      details:
        "Home authentication/bootstrap did not finish; account identity and workflow permissions could not be evaluated.",
    };
    return {
      schedulingTeamId,
      flags,
      workflows: {
        smoke: result,
        scheduling: result,
        controller: result,
      },
    };
  }

  const permissions = auth?.permissions ?? {};
  const teamScopes = permissions.teamScopes ?? {};
  const role = auth?.role ?? null;
  const isAdmin = role === "admin";
  const teamsPermission = permissions.teams ?? "none";
  const servicesPermission = permissions.services ?? "none";
  const controllerAccess = auth?.controllerAccess ?? auth?.appAccess ?? null;
  const canViewTeams =
    isAdmin ||
    teamsPermission === "view" ||
    teamsPermission === "edit" ||
    Object.keys(teamScopes).length > 0;
  const canEditTeams = isAdmin || teamsPermission === "edit";
  const canViewServices =
    isAdmin ||
    servicesPermission === "view" ||
    servicesPermission === "edit";
  const validHumanDemo =
    auth?.authenticated === true &&
    auth?.sessionKind === "human" &&
    auth?.churchId === "demo";
  const hasOperatorControllerAccess = ["view", "music", "full"].includes(
    controllerAccess,
  );
  const canEditReservedTeam =
    isAdmin ||
    teamsPermission === "edit" ||
    teamScopes[schedulingTeamId] === "edit";

  const smokeReasons = [];
  if (!validHumanDemo)
    smokeReasons.push("requires an authenticated human session for church demo");
  if (!canViewTeams)
    smokeReasons.push("requires canViewTeams (Global Teams access or a team scope)");
  if (!canEditTeams)
    smokeReasons.push(
      "requires Global Teams access: Edit because the smoke flow edits member details from Members",
    );
  if (!canViewServices)
    smokeReasons.push("requires Service access: View or Edit for Services, Equipment, and Templates");
  if (home.teamsAndServicesLinkRendered !== true) {
    smokeReasons.push(
      canViewTeams
        ? "Home did not render the Teams and Services route after the authenticated permissions loaded"
        : "the smoke workflow requires canViewTeams; Home correctly hides its route without that permission",
    );
  } else if (!canViewTeams && !isAdmin) {
    smokeReasons.push(
      "Home rendered the Teams and Services route while canViewTeams is false; verify the permission boundary",
    );
  }
  if (home.workspaceNavigationLoaded !== true) {
    smokeReasons.push("Teams and Services navigation did not finish loading through the Home link");
  } else {
    for (const destination of ["Services", "Teams", "Members", "Equipment", "Templates"]) {
      if (!home.workspaceLinks?.includes(destination))
        smokeReasons.push(`the loaded workspace navigation does not expose ${destination}`);
    }
  }
  if (!hasOperatorControllerAccess)
    smokeReasons.push("core navigation also requires operator-controller access");
  if (home.controllerProfilesLoaded !== true)
    smokeReasons.push("core navigation could not verify a loaded Presentation Controller profile");
  else if (home.presentationControllerLinkRendered !== true)
    smokeReasons.push("Home has no enabled Presentation Controller link at #/controller");

  const schedulingReasons = [];
  if (!validHumanDemo)
    schedulingReasons.push("requires an authenticated human session for church demo");
  if (!canEditReservedTeam)
    schedulingReasons.push(
      `requires edit access to reserved E2E team ${schedulingTeamId}; use Global Teams access: Edit or a scoped Edit checkbox for that team. No scheduling fixtures were changed`,
    );

  const controllerReasons = [];
  if (auth?.authenticated !== true || auth?.sessionKind !== "human")
    controllerReasons.push("requires an authenticated human session");
  if (!hasOperatorControllerAccess)
    controllerReasons.push("requires operator-controller access");
  else if (controllerAccess !== "full")
    controllerReasons.push(
      `requires Controller access: Full to edit the outline and songs (current level: ${controllerAccess})`,
    );
  if (home.controllersSectionVisible !== true)
    controllerReasons.push("Home did not render the Controllers section for this account");
  else if (home.controllerProfilesLoaded !== true)
    controllerReasons.push("controller profile loading did not complete on Home");
  else if (home.presentationControllerLinkRendered !== true)
    controllerReasons.push(
      "the Presentation Controller profile is missing or disabled; Home rendered no link to #/controller",
    );

  const flags = {
    bootstrapStatus: auth?.__e2eBootstrapStatus ?? null,
    authStateTrusted: true,
    authenticated: auth?.authenticated === true,
    sessionKind: auth?.sessionKind ?? null,
    churchId: auth?.churchId ?? null,
    role,
    controllerAccess,
    teamsPermission,
    servicesPermission,
    teamScopeCount: Object.keys(teamScopes).length,
    canViewTeams,
    canEditTeams,
    canViewServices,
    reservedTeamScope: teamScopes[schedulingTeamId] ?? "none",
    home: {
      homeContentLoaded: home.homeContentLoaded ?? null,
      teamsAndServicesLinkRendered: home.teamsAndServicesLinkRendered ?? null,
      workspaceNavigationLoaded: home.workspaceNavigationLoaded ?? null,
      workspaceLinks: home.workspaceLinks ?? [],
      controllersSectionVisible: home.controllersSectionVisible ?? null,
      controllerProfilesLoaded: home.controllerProfilesLoaded ?? null,
      presentationControllerLinkRendered:
        home.presentationControllerLinkRendered ?? null,
    },
  };
  const result = (reasons) => ({
    ok: reasons.length === 0,
    details:
      reasons.length > 0
        ? reasons.join("; ")
        : "Authenticated access and the visible application navigation satisfy this workflow's prerequisites.",
  });

  return {
    schedulingTeamId,
    flags,
    workflows: {
      smoke: result(smokeReasons),
      scheduling: result(schedulingReasons),
      controller: result(controllerReasons),
    },
  };
}

async function inspectApplicationPermissionState(browser, baseUrl, schedulingTeamId) {
  let context;
  let auth = null;
  let homeSnapshot = "(unavailable)";
  let inspectionError = "";
  const home = {
    homeContentLoaded: null,
    teamsAndServicesLinkRendered: null,
    workspaceNavigationLoaded: null,
    workspaceLinks: [],
    controllersSectionVisible: null,
    controllerProfilesLoaded: null,
    presentationControllerLinkRendered: null,
  };
  try {
    context = await browser.newContext({
      storageState: authFile,
      ignoreHTTPSErrors: localHosts.has(baseUrl.url.hostname),
    });
    await context.route("**/api/**", async (route) => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(20_000);
    const authResponsePromise = page
      .waitForResponse((response) => {
        try {
          return new URL(response.url()).pathname.endsWith("/api/auth/me");
        } catch {
          return false;
        }
      }, { timeout: 20_000 })
      .catch(() => null);
    await page.goto(new URL("/#/home", baseUrl.url).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("home-content").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    home.homeContentLoaded = true;
    const authResponse = await authResponsePromise;
    if (authResponse?.ok()) {
      try {
        auth = await authResponse.json();
        auth.__e2eBootstrapStatus = authResponse.status();
      } catch {
        auth = { __e2eBootstrapStatus: authResponse.status() };
      }
    } else {
      auth = { __e2eBootstrapStatus: authResponse?.status() ?? null };
    }

    const initial = evaluateApplicationWorkflowAccess(auth, home, schedulingTeamId);
    const teamsAndServicesLink = page
      .getByRole("link")
      .and(page.locator('main a[href="#/teams-and-services"]'));
    if (initial.flags.canViewTeams) {
      try {
        await expect(teamsAndServicesLink).toBeVisible({ timeout: 15_000 });
        home.teamsAndServicesLinkRendered = true;
      } catch {
        home.teamsAndServicesLinkRendered = false;
      }
    } else {
      home.teamsAndServicesLinkRendered = (await teamsAndServicesLink.count()) > 0;
    }
    homeSnapshot = await page
      .getByRole("main")
      .ariaSnapshot()
      .catch(() => "(Home accessibility snapshot unavailable)");

    const operatorAccess = ["view", "music", "full"].includes(
      initial.flags.controllerAccess || "",
    );
    const controllersRegion = page.getByRole("region", {
      name: "Controllers",
      exact: true,
    });
    if (operatorAccess) {
      try {
        await expect(controllersRegion).toBeVisible({ timeout: 15_000 });
        home.controllersSectionVisible = true;
        await expect(controllersRegion).not.toHaveAttribute("aria-busy", "true", {
          timeout: 30_000,
        });
        home.controllerProfilesLoaded = true;
        const controllerLink = page
          .getByRole("link")
          .and(page.locator('main a[href="#/controller"]'));
        home.presentationControllerLinkRendered =
          (await controllerLink.count()) === 1 && await controllerLink.isVisible();
      } catch {
        home.controllersSectionVisible = (await controllersRegion.count()) > 0;
        home.controllerProfilesLoaded = false;
        home.presentationControllerLinkRendered = false;
      }
    } else {
      home.controllersSectionVisible = (await controllersRegion.count()) > 0;
    }

    if (home.teamsAndServicesLinkRendered === true) {
      try {
        await teamsAndServicesLink.click();
        const workspaceNav = page.getByRole("navigation", {
          name: "Teams and Services sections",
        });
        await expect(workspaceNav).toBeVisible({ timeout: 15_000 });
        home.workspaceNavigationLoaded = true;
        home.workspaceLinks = (await workspaceNav.getByRole("link").allTextContents())
          .map((label) => label.replace(/\s+/g, " ").trim())
          .filter(Boolean);
      } catch {
        home.workspaceNavigationLoaded = false;
      }
    } else {
      home.workspaceNavigationLoaded = false;
    }
  } catch (error) {
    home.homeContentLoaded = false;
    inspectionError = redactText(error?.message || error, outputSecrets());
    const inspectionPage = context?.pages()[0];
    homeSnapshot = inspectionPage
      ? await inspectionPage
          .getByRole("main")
          .ariaSnapshot()
          .catch(() => "(Home accessibility snapshot unavailable)")
      : "(Home accessibility snapshot unavailable)";
  } finally {
    if (context) await context.close().catch(() => undefined);
  }

  const evaluation = evaluateApplicationWorkflowAccess(auth, home, schedulingTeamId);
  return {
    ...evaluation,
    homeSnapshot: redactText(homeSnapshot, outputSecrets()),
    ...(inspectionError ? { inspectionError } : {}),
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

  let workflowAccess = null;
  const shouldInspectApplicationAccess =
    browserAvailable && targetReachable && savedAuth.ok && sessionResult.status === "PASS";
  if (shouldInspectApplicationAccess) {
    const schedulingTeamId = getReservedSchedulingTeamId();
    workflowAccess = await inspectApplicationPermissionState(
      browser,
      baseUrl,
      schedulingTeamId,
    );
    const workflowResults = Object.entries(workflowAccess.workflows);
    const hasWorkflowFailure = workflowResults.some(([, result]) => !result.ok);
    const stateReadable =
      workflowAccess.flags.bootstrapStatus === 200 &&
      workflowAccess.flags.authenticated === true &&
      workflowAccess.flags.authStateTrusted === true &&
      workflowAccess.flags.home?.homeContentLoaded === true;
    const stateDetails = [
      stateReadable
        ? "The application auth bootstrap returned an authenticated session; workflow permissions were read from the real Home session."
        : "The application auth bootstrap did not confirm an authenticated session; workflow permissions could not be established.",
      `Flags: ${JSON.stringify(workflowAccess.flags)}`,
      workflowAccess.inspectionError
        ? `Inspection detail: ${workflowAccess.inspectionError}`
        : "",
      hasWorkflowFailure
        ? `Sanitized Home accessibility snapshot:\n${workflowAccess.homeSnapshot}`
        : "",
    ].filter(Boolean).join("\n");
    preflight.push({
      name: "Application permission state",
      status: stateReadable ? "PASS" : "FAIL",
      durationMs: 0,
      details: redactText(stateDetails, outputSecrets()),
    });
    const workflowLabels = {
      smoke: "Smoke / navigation permissions",
      scheduling: "Scheduling team authorization",
      controller: "Presentation Controller access",
    };
    const workflowPrerequisiteUnavailable =
      workflowAccess.flags.authStateTrusted !== true ||
      workflowAccess.flags.authenticated !== true ||
      workflowAccess.flags.sessionKind !== "human";
    for (const [workflow, result] of workflowResults) {
      preflight.push({
        name: workflowLabels[workflow],
        status: result.ok
          ? "PASS"
          : workflowPrerequisiteUnavailable
            ? "SKIPPED"
            : "FAIL",
        durationMs: 0,
        details: redactText(
          workflowPrerequisiteUnavailable && !result.ok
            ? "Not evaluated because Home did not establish an authenticated human session; see Application permission state."
            : result.details,
          outputSecrets(),
        ),
      });
    }
  } else if (browserAvailable && targetReachable && savedAuth.ok) {
    preflight.push({
      name: "Application permission state",
      status: "SKIPPED",
      durationMs: 0,
      details: "Not checked because saved-session validation did not pass; no permissions were changed.",
    });
  }
  await browser?.close().catch(() => undefined);

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
    else if (suite.workflow && workflowAccess && !workflowAccess.workflows[suite.workflow]?.ok)
      skipReason =
        "Skipped because its application permission preflight failed; see the matching E2E prerequisite row. No permissions were changed.";
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
