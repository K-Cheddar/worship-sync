import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [suite] = process.argv.slice(2);
const allowedSuites = new Set([
  "account-responsive-navigation.mjs",
  "home-launcher.mjs",
  "board-controller-mobile.mjs",
  "modal-mobile-focus.mjs",
  "schedule-quick-member.mjs",
  "service-plan-refresh.mjs",
]);
if (!allowedSuites.has(suite)) {
  throw new Error(`Unknown browser suite: ${suite || "(missing)"}`);
}

const clientDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootRequire = createRequire(new URL("../../package.json", import.meta.url));
const playwrightEntry = rootRequire.resolve("playwright");
const child = spawn(process.execPath, [resolve(clientDirectory, "e2e", suite)], {
  cwd: clientDirectory,
  env: { ...process.env, PLAYWRIGHT_MODULE_PATH: playwrightEntry },
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
