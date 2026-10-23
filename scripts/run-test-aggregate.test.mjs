import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { aggregateExitCode, E2E_SUITES, npmInvocation, redactText, runAggregateGroups, runSequential } from "./run-test-aggregate.mjs";

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
    'Authorization: Bearer abc.def; cookie=session-secret; email user@example.org; code 123456',
    ["session-secret"],
  );

  assert.doesNotMatch(output, /abc\.def|session-secret|user@example\.org|123456/);
  assert.match(output, /Authorization: \[redacted\]/);
  assert.match(output, /\[redacted-email\]/);
  assert.match(output, /\[redacted-code\]/);
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
