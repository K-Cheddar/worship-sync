import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const playwrightCLI = resolve(repositoryRoot, "node_modules/@playwright/test/cli.js");
const child = spawn(
  process.execPath,
  [playwrightCLI, "test", "--project=auth-refresh"],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  process.stderr.write(`Could not start Playwright: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
