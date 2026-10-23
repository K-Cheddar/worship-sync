import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { aggregateExitCode, E2E_SUITES, evaluateApplicationWorkflowAccess, getReservedSchedulingTeamId, npmInvocation, redactText, runAggregateGroups, runSequential } from "./run-test-aggregate.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("runs later suites after a failure and returns a failing aggregate result", async () => {
  const attempted = [];
  const results = await runSequential(
    [{ name: "first" }, { name: "second" }],
    async (suite) => {
      attempted.push(suite.name);
      return { exitCode: suite.name === "first" ? 1 : 0, durationMs: 12 };
    },
  );

  assert.deepEqual(attempted, ["first", "second"]);
  assert.deepEqual(results.map(({ status }) => status), ["FAIL", "PASS"]);
  assert.equal(aggregateExitCode(results), 1);
});

test("test:all attempts E2E after quick checks fail", async () => {
  const attempted = [];
  const result = await runAggregateGroups("all", {
    runChecks: async () => {
      attempted.push("quick");
      return [{ name: "Quick checks", status: "FAIL", durationMs: 10 }];
    },
    runE2E: async () => {
      attempted.push("e2e");
      return { preflight: [], results: [{ name: "Smoke", status: "PASS", durationMs: 20 }] };
    },
  });

  assert.deepEqual(attempted, ["quick", "e2e"]);
  assert.equal(aggregateExitCode([...result.checks, ...result.e2e.results]), 1);
});

test("records skipped suites distinctly and excludes them from execution", async () => {
  let called = false;
  const results = await runSequential(
    [{ name: "auth suite", skipReason: "Saved authentication is unavailable." }],
    async () => { called = true; return { exitCode: 0 }; },
  );

  assert.equal(called, false);
  assert.equal(results[0].status, "SKIPPED");
  assert.match(results[0].details, /Saved authentication/);
  assert.equal(aggregateExitCode(results), 1);
});

test("redacts credential fields, bearer values, emails, and one-time codes", () => {
  const output = redactText(
    'Authorization: Bearer abc.def; cookie=session-secret; email user@example.org; verification code: 123456',
    ["session-secret"],
  );

  assert.doesNotMatch(output, /abc\.def|session-secret|user@example\.org|123456/);
  assert.match(output, /Authorization: \[redacted\]/);
  assert.match(output, /\[redacted-email\]/);
  assert.match(output, /\[redacted-code\]/);
});

test("redacts recognizable authentication codes while preserving numeric measurements", () => {
  const output = redactText(
    "JS transfer 123456 bytes; duration 123456 ms; tests=123456; PID 123456; verification code: 654321; otp=789012",
  );

  for (const metric of ["123456 bytes", "123456 ms", "tests=123456", "PID 123456"]) {
    assert.ok(output.includes(metric), `preserves ${metric}`);
  }
  assert.doesNotMatch(output, /654321|789012/);
  assert.equal((output.match(/\[redacted-code\]/g) || []).length, 2);
});

test("redacts PEM private-key blocks without changing surrounding text", () => {
  const output = redactText(
    "before -----BEGIN PRIVATE KEY-----synthetic-key-----END PRIVATE KEY----- after",
  );
  assert.equal(output, "before [redacted-private-key] after");
  assert.doesNotMatch(output, /synthetic-key/);
});

test("redacts sensitive URL query strings and fragments", () => {
  const output = redactText("request https://example.test/auth?code=123456#id_token=secret-value");
  assert.doesNotMatch(output, /123456|secret-value/);
  assert.equal(output, "request https://example.test/auth?[redacted]#[redacted]");
});

test("application permission preflight distinguishes smoke, scheduling, and controller access", () => {
  const teamId = getReservedSchedulingTeamId({});
  const auth = {
    authenticated: true,
    sessionKind: "human",
    churchId: "demo",
    role: "member",
    controllerAccess: "full",
    permissions: {
      teams: "edit",
      services: "view",
      teamScopes: { [teamId]: "edit" },
    },
  };
  const home = {
    teamsAndServicesLinkRendered: true,
    workspaceNavigationLoaded: true,
    workspaceLinks: ["Services", "Teams", "Members", "Equipment", "Templates"],
    controllersSectionVisible: true,
    controllerProfilesLoaded: true,
    presentationControllerLinkRendered: true,
  };

  const permitted = evaluateApplicationWorkflowAccess(auth, home, teamId);
  assert.deepEqual(Object.values(permitted.workflows).map(({ ok }) => ok), [true, true, true]);
  assert.match(teamId, /^e2e-scheduling-[a-f0-9]{16}$/);

  const denied = evaluateApplicationWorkflowAccess(
    {
      ...auth,
      permissions: { teams: "view", services: "none", teamScopes: { unrelated: "edit" } },
    },
    { ...home, teamsAndServicesLinkRendered: false },
    teamId,
  );
  assert.equal(denied.workflows.smoke.ok, false);
  assert.equal(denied.workflows.scheduling.ok, false);
  assert.equal(denied.workflows.controller.ok, true);
  assert.match(denied.workflows.scheduling.details, new RegExp(teamId));

  const scopedSchedulingOnly = evaluateApplicationWorkflowAccess(
    {
      ...auth,
      permissions: {
        teams: "none",
        services: "view",
        teamScopes: { [teamId]: "edit" },
      },
    },
    { ...home, teamsAndServicesLinkRendered: false },
    teamId,
  );
  assert.equal(scopedSchedulingOnly.workflows.scheduling.ok, true);
  assert.equal(scopedSchedulingOnly.workflows.smoke.ok, false);
  assert.equal(scopedSchedulingOnly.workflows.controller.ok, true);

  const unresolved = evaluateApplicationWorkflowAccess(auth, { homeContentLoaded: false }, teamId);
  assert.equal(unresolved.flags.authStateTrusted, false);
  assert.equal(unresolved.flags.authenticated, null);
  assert.deepEqual(
    Object.values(unresolved.workflows).map(({ details }) => details),
    Array(3).fill("Home authentication/bootstrap did not finish; account identity and workflow permissions could not be evaluated."),
  );
});

test("maps each standalone client browser script exactly once and excludes auth workflows", async () => {
  const rootPackage = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
  const clientPackage = JSON.parse(await readFile(resolve(repoRoot, "client/package.json"), "utf8"));
  const clientScripts = Object.keys(clientPackage.scripts).filter((name) => name.startsWith("test:e2e:") && name !== "test:e2e:browser").sort();
  const mappedClientScripts = E2E_SUITES.filter((suite) => suite.client).map((suite) => suite.script).sort();
  const mappedRootScripts = E2E_SUITES.filter((suite) => !suite.client).map((suite) => suite.script).sort();

  assert.deepEqual(mappedClientScripts, clientScripts);
  assert.deepEqual(mappedRootScripts, ["test:e2e:controller", "test:e2e:scheduling", "test:e2e:smoke"]);
  assert.equal(new Set(E2E_SUITES.map((suite) => suite.script)).size, E2E_SUITES.length);
  assert.equal(E2E_SUITES.length, 16);
  assert.ok(!E2E_SUITES.some((suite) => ["test:e2e:auth", "test:e2e:auth:refresh"].includes(suite.script)));
  assert.ok(!E2E_SUITES.some((suite) => suite.script.startsWith("test:e2e:auth:")));
  assert.ok(!E2E_SUITES.some((suite) => suite.script === "test:e2e:browser"));
  assert.ok(rootPackage.scripts["test:e2e:auth:validate"]);
  assert.ok(rootPackage.scripts["test:e2e:auth:refresh"]);
});

test("uses the Node/npm CLI invocation that works from Windows shells", () => {
  const win32Invocation = npmInvocation(["run", "checks"], "win32", "");
  assert.equal(win32Invocation.command, "npm.cmd");
  assert.deepEqual(win32Invocation.args, ["run", "checks"]);
  assert.equal(win32Invocation.shell, true);

  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    const cliInvocation = npmInvocation(["run", "checks"], "win32", npmCli);
    assert.equal(cliInvocation.command, process.execPath);
    assert.deepEqual(cliInvocation.args, [npmCli, "run", "checks"]);
    assert.equal(cliInvocation.shell, false);
  }
});
