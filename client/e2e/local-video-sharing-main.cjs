const { app, BrowserWindow, session, contentTracing } = require("electron");
const { createServer } = require("node:http");
const { readFileSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");

const directory = process.argv[2];
app.setPath("userData", path.join(directory, "profile"));
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("enable-logging", "file");
app.commandLine.appendSwitch("log-file", path.join(directory, "chromium.log"));
app.commandLine.appendSwitch("vmodule", "video_capture_manager=2,video_capture_controller=2");
const windows = [];
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(`<script>${readFileSync(path.join(directory, "renderer.js"), "utf8")}</script>`);
});
const execute = (window, code) => window.webContents.executeJavaScript(code);
const deadline = setTimeout(() => { console.error("Native capture test timed out"); app.exit(1); }, 30_000);

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // Same partition/origin, context isolation and non-throttled host/output as
  // createAppWindowWebPreferences. No real devices or signed-in profile used.
  const partition = "persist:capture-test";
  session.fromPartition(partition).setPermissionRequestHandler((_webContents, _permission, callback) => callback(true));
  const open = async (host = false) => {
    const window = new BrowserWindow({ show: false, webPreferences: {
      partition, contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required",
    } });
    windows.push(window);
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error("Capture fixture renderer exited", details);
    });
    await window.loadURL(`http://127.0.0.1:${server.address().port}/${host ? "#/local-video-capture-host" : ""}`);
    return window;
  };
  const host = await open(true);
  const projector = await open();
  const controller = await open();
  const aux = await open();
  await contentTracing.startRecording({ included_categories: ["disabled-by-default-video_and_image_capture"] });
  console.log("Native capture trace started");
  await execute(host, "configureHighResolutionHost()");
  const hostSettings = await execute(host, 'startCapture("host", true)');
  assert.equal(hostSettings.width, 3_840);
  console.log("Native host ready");
  assert.equal(await execute(controller, 'startCapture("preflight", true).then(() => "unexpected", error => error.name)'),
    "LocalVideoCaptureOwnedError", "Controller preflights must delegate publishing to the continuity host");
  const clients = await Promise.all([projector, controller, aux].map((window) => execute(window, 'startCapture("view")')));
  console.log("Native direct clients ready");
  assert.equal(clients.length, 3);
  assert.ok(clients.every((settings) => settings.width === hostSettings.width && settings.height === hostSettings.height));
  assert.deepEqual(await execute(projector, 'captureSize("view")'), { width: hostSettings.width, height: hostSettings.height });
  for (const window of windows) {
    assert.deepEqual(await execute(window, "relayWork"), { VideoEncoder: 0, VideoDecoder: 0, MediaRecorder: 0 });
  }
  await contentTracing.stopRecording(path.join(directory, "capture-trace.json"));
  const before = await execute(projector, 'nextFrame("view")');
  controller.webContents.reload();
  await new Promise((resolve) => controller.webContents.once("did-finish-load", resolve));
  await execute(controller, 'startCapture("view")');
  console.log("Native controller rejoined after reload");
  assert.ok(await execute(projector, 'nextFrame("view")') > before, "Projector must keep delivering frames through controller reload");
  await execute(aux, 'releaseCapture("view")');
  await execute(aux, `void (navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("forced", "NotReadableError"); })`);
  const failure = await execute(aux, 'startCapture("view").then(() => "unexpected", error => error.name)');
  assert.equal(failure, "NotReadableError");
  await execute(projector, 'nextFrame("view")');
  await execute(host, 'nextFrame("host")');
  writeFileSync(path.join(directory, "result.json"), JSON.stringify({
    versions: process.versions, hostSettings, clients, controllerReload: "pass", failedJoinIsolation: "pass",
  }, null, 2));
  console.log("PASS native Electron multi-window capture sharing, controller reload, failed join isolation");
  clearTimeout(deadline);
  windows.forEach((window) => window.destroy());
  server.close();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
