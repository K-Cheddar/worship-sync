import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(repositoryRoot, "server");

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const discovered = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return findTests(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".test.js") ? [entryPath] : [];
  }));

  return discovered.flat();
}

let testFiles;
try {
  testFiles = (await findTests(serverRoot)).sort();
} catch (error) {
  console.error(`Unable to discover server tests under ${serverRoot}: ${error.message}`);
  process.exitCode = 1;
}

if (testFiles?.length === 0) {
  console.error(`No server test files ending in .test.js were found under ${serverRoot}.`);
  process.exitCode = 1;
}

if (testFiles?.length) {
  // A local run at concurrency 4 exceeded 11 minutes without finishing, so higher concurrency is unverified.
  console.log(`Discovered ${testFiles.length} server test files; running sequentially.`);
  const relativeTestFiles = testFiles.map((testFile) =>
    path.relative(repositoryRoot, testFile).split(path.sep).join("/"),
  );

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", ...relativeTestFiles],
    { cwd: repositoryRoot, shell: false, stdio: "inherit" },
  );

  child.once("error", (error) => {
    console.error(`Unable to start the server test runner: ${error.message}`);
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    if (signal) {
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exitCode = 1;
      }
      return;
    }

    process.exitCode = code ?? 1;
  });
}
