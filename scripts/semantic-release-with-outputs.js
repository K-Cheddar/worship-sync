/**
 * Runs semantic-release through its JavaScript API so GitHub Actions can use
 * the actual release result to decide whether follow-up jobs should run.
 */
import fs from "fs";
import process from "process";
import semanticRelease from "semantic-release";

const outputFile = process.env.GITHUB_OUTPUT;

function setOutput(name, value) {
  if (!outputFile) return;
  fs.appendFileSync(outputFile, `${name}=${value ?? ""}\n`, "utf8");
}

function setNoReleaseOutputs() {
  setOutput("published", "false");
  setOutput("version", "");
  setOutput("tag", "");
}

try {
  const result = await semanticRelease(
    {},
    { cwd: process.cwd(), env: process.env }
  );

  const release = result?.nextRelease ?? result?.releases?.[0];
  const version = release?.version;
  const tag = release?.gitTag ?? (version ? `v${version}` : "");

  if (version) {
    setOutput("published", "true");
    setOutput("version", version);
    setOutput("tag", tag);
    console.log(`semantic-release published ${version} (${tag}).`);
  } else {
    setNoReleaseOutputs();
    console.log("semantic-release did not publish a new release.");
  }
} catch (error) {
  setNoReleaseOutputs();
  throw error;
}
