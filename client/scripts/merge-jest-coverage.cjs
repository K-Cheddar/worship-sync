const fs = require("node:fs");
const path = require("node:path");
const { createCoverageMap } = require("istanbul-lib-coverage");
const jestConfig = require("../jest.config.cjs");

const artifactRoot = path.resolve(process.argv[2] || "coverage-artifacts");
const outputDirectory = path.resolve(process.argv[3] || "coverage/merged");
const shards = ["1", "2", "3", "4"];
const coverageMap = createCoverageMap({});

for (const shard of shards) {
  const coveragePath = path.join(
    artifactRoot,
    `client-coverage-shard-${shard}`,
    "coverage-final.json",
  );

  if (!fs.existsSync(coveragePath)) {
    throw new Error(`Missing coverage artifact for shard ${shard}: ${coveragePath}`);
  }

  coverageMap.merge(JSON.parse(fs.readFileSync(coveragePath, "utf8")));
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(
  path.join(outputDirectory, "coverage-final.json"),
  `${JSON.stringify(coverageMap.toJSON())}\n`,
);

const summary = coverageMap.getCoverageSummary().toJSON();
fs.writeFileSync(
  path.join(outputDirectory, "coverage-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

let failed = false;
for (const [metric, minimum] of Object.entries(jestConfig.coverageThreshold.global)) {
  const actual = summary[metric]?.pct;
  if (typeof actual !== "number") {
    throw new Error(`Merged coverage does not include the ${metric} metric.`);
  }

  console.log(`${metric}: ${actual.toFixed(2)}% (required: ${minimum}%)`);
  if (actual < minimum) failed = true;
}

if (failed) {
  process.exitCode = 1;
}
