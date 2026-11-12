// Run with: npx tsx scripts/smoke-linked-video.mts [packaged-video-tools-directory]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { LocalAssetStore } from "../electron/localAssetStore";
import { finalizeExternalVideo } from "../electron/externalVideoFinalization";

const tools = resolve(process.argv[2] ?? "buildResources/video-tools/win32-x64");
const root = await mkdtemp(join(tmpdir(), "worshipsync-linked-video-smoke-"));
const run = promisify(execFile);
const originalLink = fs.link;
try {
  const videos = [join(root, "original.mp4"), join(root, "replacement.mp4")];
  for (const [index, path] of videos.entries()) {
    await run(join(tools, "ffmpeg.exe"), ["-v", "error", "-f", "lavfi", "-i",
      `color=c=${index ? "red" : "blue"}:s=${index ? "1280x720" : "640x360"}:r=24`,
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path], { windowsHide: true });
  }
  const store = new LocalAssetStore(join(root, "registry"));
  const original = await store.linkFile({ assetId: "saved-playback-id", workspaceId: "smoke", kind: "video",
    sourcePath: videos[0], fileName: "original.mp4", contentType: "video/mp4" });
  const candidate = await store.relinkFile(original.assetId, { kind: "video", sourcePath: videos[1],
    fileName: "replacement.mp4", contentType: "video/mp4" });
  assert.equal((await store.resolvePath(original.assetId))?.path, videos[0]);
  const adopted = await store.commitRelinkFile(original.assetId, candidate.assetId);
  assert.equal(adopted.assetId, original.assetId);
  assert.notEqual(adopted.contentHash, original.contentHash);
  assert.equal((await store.resolvePath(original.assetId))?.path, videos[1]);
  const destinationDirectory = join(root, "external");
  await mkdir(destinationDirectory);
  await copyFile(videos[0], join(destinationDirectory, "Download.mp4"));
  // Exercise the actual exclusive Windows fallback, using valid H.264/AAC bytes.
  fs.link = async () => { throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" }); };
  syncBuiltinESMExports();
  const saved = await finalizeExternalVideo({ sourcePath: videos[1], sourceDirectory: root,
    destinationDirectory, displayName: "Download", assetId: "downloaded-smoke", workspaceId: "smoke",
    width: 1280, height: 720, store });
  assert.equal(saved.fileName, "Download (2).mp4");
  const finalPath = (await store.resolvePath(saved.asset.assetId))!.path;
  const { stdout } = await run(join(tools, "ffprobe.exe"), ["-v", "error", "-show_entries",
    "stream=codec_name,width,height", "-show_entries", "format=duration", "-of", "json", finalPath], { windowsHide: true });
  const metadata = JSON.parse(stdout);
  assert(metadata.streams.some((stream: { codec_name: string; width?: number }) => stream.codec_name === "h264" && stream.width === 1280));
  assert(metadata.streams.some((stream: { codec_name: string }) => stream.codec_name === "aac"));
  await store.delete(saved.asset.assetId);
  assert.deepEqual(await readFile(finalPath), await readFile(videos[1]));
  assert.deepEqual(await readFile(join(destinationDirectory, "Download.mp4")), await readFile(videos[0]));
  console.log(JSON.stringify({ stableSavedPlaybackId: true, atomicFallback: true,
    conflictFilePreserved: true, linkedDeletionPreservedFile: true, metadata }, null, 2));
} finally {
  fs.link = originalLink;
  syncBuiltinESMExports();
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected smoke directory.");
  await rm(root, { recursive: true, force: true });
}
