const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/checks.yml"), "utf8").replace(/\r\n/g, "\n");
const checker = path.join(__dirname, "verify-checks-status.cjs");
const jobs = ["client_tests", "heroku_build", "electron_build", "server_tests", "lint_typecheck"];
const concurrencyBlock = workflow.match(/^concurrency:\n((?:[ \t].+\n)+)/m)?.[1] || "";
const concurrencyGroup = concurrencyBlock.match(/^  group: (.+)$/m)?.[1];
const cancelInProgress = concurrencyBlock.match(/^  cancel-in-progress: (.+)$/m)?.[1];
const concurrency = concurrencyGroup && cancelInProgress
  ? [concurrencyBlock, concurrencyGroup, cancelInProgress]
  : null;

function evaluateGithubExpression(expression, github) {
  const alternatives = expression.split(/\s*\|\|\s*/);
  const value = alternatives
    .map((path) => path.trim().split(".").reduce((current, key) => current?.[key], { github }))
    .find(Boolean);
  return value ?? "";
}

function evaluateConcurrencyGroup(github) {
  assert.ok(concurrency, "the Checks workflow must define group and cancel-in-progress together");
  return concurrency[1].replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression) => (
    String(evaluateGithubExpression(expression, github))
  ));
}

function githubRun({ eventName, repository = "K-Cheddar/worship-sync", ref, sha, pullRequestNumber }) {
  const event = {};
  if (pullRequestNumber !== undefined) event.pull_request = { number: pullRequestNumber };
  return { workflow: "Checks", repository, event_name: eventName, ref, sha, event };
}

const runChecker = (results, extraEnv = {}) => spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, CHECK_RESULTS: JSON.stringify(results), ...extraEnv },
});

test("Checks runs on PR updates and manual dispatch with four Jest shards and the stable aggregate job", () => {
  const triggerBlock = workflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1] || "";
  const triggers = [...triggerBlock.matchAll(/^  ([\w-]+):/gm)].map((match) => match[1]);
  assert.deepEqual(triggers, ["pull_request", "workflow_dispatch"], "PRs and manual runs are the only workflow triggers");
  assert.doesNotMatch(triggerBlock, /^  push:/m, "push events must not launch a duplicate full Checks run");
  const pullRequestTrigger = triggerBlock.match(/^  pull_request:\n((?: {4}.+\n)*)/m)?.[1] || "";
  assert.match(pullRequestTrigger, /^    types:\n/m);
  for (const eventType of ["opened", "synchronize", "reopened"]) {
    assert.match(pullRequestTrigger, new RegExp(`^      - ${eventType}$`, "m"));
  }
  assert.doesNotMatch(pullRequestTrigger, /branches(?:-ignore)?:/, "all PR target branches remain eligible");
  assert.doesNotMatch(workflow, /^\s+ref:/m, "default PR checkout must validate GitHub's prospective merge result");
  assert.ok(concurrency, "the Checks workflow must define concurrency");
  assert.equal(concurrency[2], "true", "a newer run supersedes an older run in the same group");
  assert.doesNotMatch(workflow, /inputs:\s*\n\s+coverage:|coverage:\s*\n|test:coverage|coverage-artifact|coverageDirectory|COVERAGE_REQUIRED/);
  assert.match(workflow, /shard:\s*\[1, 2, 3, 4\]/);
  assert.match(workflow, /npm test --prefix client/);
  assert.match(workflow, /name: npm run checks/);
  assert.doesNotMatch(workflow, /github\.base_ref\s*==\s*'master'/);
  const aggregate = workflow.split("  checks:\n")[1];
  assert.match(aggregate, /^    if: always\(\)$/m, "the aggregate must run after failed, skipped, or cancelled dependencies");
  assert.match(aggregate, /CHECK_RESULTS:\s*\$\{\{\s*toJSON\(needs\)\s*\}\}/);
  const required = aggregate?.match(/needs:\s*\[([\s\S]*?)\]/)?.[1] || "";
  for (const job of jobs) assert.match(required, new RegExp(`^\\s*${job},?$`, "m"));
});

test("concurrency groups isolate PRs, manual runs, workflows, and repositories", () => {
  const pullRequest = (number, sha, headRef) => evaluateConcurrencyGroup({
    ...githubRun({ eventName: "pull_request", ref: `refs/pull/${number}/merge`, sha, pullRequestNumber: number }),
    event: { pull_request: { number, head: { ref: headRef } } },
  });

  assert.equal(
    pullRequest(42, "older-commit", "in-progress"),
    pullRequest(42, "newer-commit", "in-progress"),
    "updates to one PR supersede one another",
  );
  assert.notEqual(
    pullRequest(42, "commit", "in-progress"),
    pullRequest(43, "commit", "in-progress"),
    "different PRs remain independent even when they share a head branch",
  );
  assert.notEqual(
    pullRequest(42, "commit", "staging"),
    pullRequest(43, "commit", "in-progress"),
    "PRs from staging and in-progress remain independent",
  );

  const manual = evaluateConcurrencyGroup(githubRun({
    eventName: "workflow_dispatch",
    ref: "refs/heads/in-progress",
    sha: "manual-commit",
  }));
  assert.equal(
    manual,
    evaluateConcurrencyGroup(githubRun({
      eventName: "workflow_dispatch",
      ref: "refs/heads/in-progress",
      sha: "manual-rerun",
    })),
    "same-ref manual reruns supersede one another",
  );
  assert.notEqual(
    manual,
    evaluateConcurrencyGroup(githubRun({ eventName: "workflow_dispatch", ref: "refs/heads/staging", sha: "manual-commit" })),
    "manual runs on different refs remain independent",
  );
  assert.notEqual(
    manual,
    pullRequest(42, "manual-commit", "in-progress"),
    "manual validation does not cancel automated PR validation",
  );
  const otherWorkflowRun = githubRun({ eventName: "workflow_dispatch", ref: "refs/heads/in-progress", sha: "manual-commit" });
  otherWorkflowRun.workflow = "Focused Client Browser Checks";
  assert.notEqual(manual, evaluateConcurrencyGroup(otherWorkflowRun), "other workflows remain independent");
  assert.notEqual(
    evaluateConcurrencyGroup(githubRun({
      eventName: "workflow_dispatch",
      repository: "contributor/worship-sync",
      ref: "refs/heads/in-progress",
      sha: "manual-commit",
    })),
    manual,
    "similarly named branches in separate repositories remain independent",
  );
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

test("aggregate checker rejects a failed, missing, skipped, or cancelled required job", () => {
  for (const status of ["failure", "missing", "skipped", "cancelled"]) {
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
