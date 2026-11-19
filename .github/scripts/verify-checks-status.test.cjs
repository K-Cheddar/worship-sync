const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/checks.yml"), "utf8").replace(/\r\n/g, "\n");
const checker = path.join(__dirname, "verify-checks-status.cjs");
const jobs = ["client_tests", "heroku_build", "electron_build", "server_tests", "lint_typecheck"];

const runChecker = (results, extraEnv = {}) => spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, CHECK_RESULTS: JSON.stringify(results), ...extraEnv },
});

test("all PRs and manual runs use four ordinary Jest shards and the stable aggregate job", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /inputs:\s*\n\s+coverage:|coverage:\s*\n|test:coverage|coverage-artifact|coverageDirectory|COVERAGE_REQUIRED/);
  assert.match(workflow, /shard:\s*\[1, 2, 3, 4\]/);
  assert.match(workflow, /npm test --prefix client/);
  assert.match(workflow, /name: npm run checks/);
  assert.doesNotMatch(workflow, /github\.base_ref\s*==\s*'master'/);
  const aggregate = workflow.split("  checks:\n")[1];
  const required = aggregate?.match(/needs:\s*\[([\s\S]*?)\]/)?.[1] || "";
  for (const job of jobs) assert.match(required, new RegExp(`^\\s*${job},?$`, "m"));
});

test("the unauthenticated schedule browser fixture runs in a required Chromium job and failures reach the aggregate", () => {
  const serverJobStart = workflow.indexOf("  server_tests:\n");
  const serverJobEnd = workflow.indexOf("\n  lint_typecheck:", serverJobStart);
  assert.ok(serverJobStart >= 0 && serverJobEnd > serverJobStart, "the existing Server tests job must remain present");
  const serverJob = workflow.slice(serverJobStart, serverJobEnd);
  const chromiumStep = serverJob.indexOf("name: Install Chromium for browser integration");
  const fixtureStep = serverJob.indexOf("name: Run unauthenticated schedule quick-member browser fixture");
  assert.ok(chromiumStep >= 0 && fixtureStep > chromiumStep, "the fixture must reuse the required job Chromium setup");
  assert.ok(serverJob.includes("run: npm run test:e2e:schedule-quick-member --prefix client"));

  const aggregate = workflow.split("  checks:\n")[1];
  const required = aggregate?.split("needs:")[1]?.split("runs-on:")[0] || "";
  assert.ok(required.includes("server_tests,"), "the fixture job must feed the stable required aggregate");

  const results = Object.fromEntries(jobs.map((job) => [job, { result: "success" }]));
  results.server_tests.result = "failure";
  const failure = runChecker(results);
  assert.equal(failure.status, 1, failure.stdout);
  assert.match(failure.stderr, /server_tests: failure/);
});

test("aggregate checker passes every required job without coverage", () => {
  const result = runChecker(Object.fromEntries(jobs.map((job) => [job, { result: "success" }])));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All required checks succeeded/);
});

test("aggregate checker rejects a failed, missing, or skipped required job", () => {
  for (const status of ["failure", "missing", "skipped"]) {
    const results = Object.fromEntries(jobs.map((job) => [job, { result: "success" }]));
    if (status === "missing") delete results.server_tests;
    else results.server_tests.result = status;
    const result = runChecker(results);
    assert.equal(result.status, 1, `${status}: ${result.stdout}`);
    assert.match(result.stderr, /server_tests:/);
  }
});

test("legacy coverage environment variables do not change required checks", () => {
  const results = Object.fromEntries(jobs.map((job) => [job, { result: "success" }]));
  const result = runChecker(results, { COVERAGE_REQUIRED: "true" });
  assert.equal(result.status, 0, result.stderr);
});
