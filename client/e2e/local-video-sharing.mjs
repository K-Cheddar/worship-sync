import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const artifacts = await mkdtemp(path.join(tmpdir(), "worshipsync-capture-sharing-"));
await build({
  entryPoints: [path.join(fixtureDirectory, "local-video-sharing-renderer.ts")],
  outfile: path.join(artifacts, "renderer.js"), bundle: true, platform: "browser", format: "iife",
  define: { "import.meta.env.DEV": "false" },
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [path.join(fixtureDirectory, "local-video-sharing-main.cjs"), artifacts], {
  stdio: "inherit", env: environment, windowsHide: true,
});
const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
assert.equal(code, 0, `Native capture test failed. Artifacts: ${artifacts}`);
const trace = JSON.parse(await readFile(path.join(artifacts, "capture-trace.json"), "utf8"));
const deviceStarts = trace.traceEvents.filter((event) => event.name === "VideoCaptureController::CreateAndStartDeviceAsync");
const deviceStops = trace.traceEvents.filter((event) => event.name === "VideoCaptureController::ReleaseDeviceAsync");
assert.equal(deviceStarts.length, 1, `All clients must share one underlying Chromium device start. Artifacts: ${artifacts}`);
assert.equal(deviceStops.length, 0, "Joining clients must not restart the device");
console.log("PASS one Chromium device start for host and all clients");
const result = JSON.parse(await readFile(path.join(artifacts, "result.json"), "utf8"));
console.log({ electron: result.versions.electron, chromium: result.versions.chrome,
  width: result.hostSettings.width, height: result.hostSettings.height, fps: result.hostSettings.frameRate,
});
console.log(`Artifacts: ${artifacts}`);
