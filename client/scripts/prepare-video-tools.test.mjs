import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { prepareVideoTools } from "./prepare-video-tools.mjs";

const workspaces = new Set();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all([...workspaces].map((workspace) => rm(workspace, { recursive: true, force: true })));
  workspaces.clear();
});

const workspace = async () => {
  const directory = await mkdtemp(join(tmpdir(), "worshipsync-video-tools-test-"));
  workspaces.add(directory);
  return directory;
};

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// A small stored ZIP fixture keeps these tests independent of archive packages.
const createZip = (files) => {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(files)) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    localRecords.push(local, fileName, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(central, fileName);
    localOffset += local.length + fileName.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
};

const denoBytes = Buffer.from("fixture deno executable");
const ytDlpBytes = Buffer.from("fixture yt-dlp executable");
const ffmpegBytes = Buffer.from("fixture ffmpeg executable");
const ffprobeBytes = Buffer.from("fixture ffprobe executable");
const licenseText = "Pinned license fixture text\n";
const licenseNames = [
  "yt-dlp-LICENSE.txt",
  "yt-dlp-THIRD_PARTY_LICENSES.txt",
  "Deno-LICENSE.md",
  "FFmpeg-COPYING.GPLv3.txt",
];

const fixture = ({ denoFiles = { "deno.exe": denoBytes }, denoArchive, ytdlp = ytDlpBytes } = {}) => {
  const denoZip = denoArchive || createZip(denoFiles);
  const ffmpegZip = createZip({
    "ffmpeg/bin/ffmpeg.exe": ffmpegBytes,
    "ffmpeg/bin/ffprobe.exe": ffprobeBytes,
  });
  const pins = {
    ytDlp: {
      url: "https://github.com/test/yt-dlp.exe",
      sha256: digest(ytdlp),
      fileName: "yt-dlp.exe",
      maxBytes: 1024,
    },
    deno: {
      url: "https://github.com/test/deno.zip",
      sha256: digest(denoZip),
      fileName: "deno.exe",
      version: "2.9.8",
      maxBytes: 1024 * 1024,
    },
    ffmpeg: {
      url: "https://www.gyan.dev/test/ffmpeg.zip",
      sha256: digest(ffmpegZip),
      files: {
        "ffmpeg.exe": digest(ffmpegBytes),
        "ffprobe.exe": digest(ffprobeBytes),
      },
      maxBytes: 1024 * 1024,
    },
    licenses: licenseNames.map((fileName, index) => ({
      url: `https://raw.githubusercontent.com/test/license-${index}.txt`,
      fileName,
    })),
  };
  const downloads = new Map([
    [pins.ytDlp.url, ytdlp],
    [pins.deno.url, denoZip],
    [pins.ffmpeg.url, ffmpegZip],
    ...pins.licenses.map(({ url }) => [url, Buffer.from(licenseText)]),
  ]);
  const calls = { fetch: 0, extract: [], execute: 0 };
  const fetcher = async (url) => {
    calls.fetch += 1;
    const bytes = downloads.get(url);
    if (!bytes) throw new Error(`Unexpected fixture download: ${url}`);
    return {
      ok: true,
      status: 200,
      url,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => bytes.toString("utf8"),
    };
  };
  const runExecutable = async (executable, args) => {
    calls.execute += 1;
    assert.equal(basename(executable), "deno.exe");
    assert.deepEqual(args, ["--version"]);
    return { stdout: "deno 2.9.8 (fixture, release, x86_64-pc-windows-msvc)\nv8 0\ntypescript 0", stderr: "" };
  };
  const extractArchive = async (archive, destination, description) => {
    calls.extract.push(description);
    const bytes = await readFile(archive);
    if (process.platform !== "win32") {
      // This keeps the orchestration tests portable; dedicated Windows CI runs
      // the valid ZIP fixture through the real Expand-Archive implementation.
      if (bytes.length < 22 || bytes.readUInt32LE(bytes.length - 22) !== 0x06054b50) throw new Error(`${description} ZIP is corrupt.`);
      const entries = description === "Deno" ? denoFiles : {
        "ffmpeg/bin/ffmpeg.exe": ffmpegBytes,
        "ffmpeg/bin/ffprobe.exe": ffprobeBytes,
      };
      for (const [name, value] of Object.entries(entries)) {
        const target = join(destination, name);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, value);
      }
      return;
    }
    const { extractArchiveWithPowerShell } = await import("./prepare-video-tools.mjs");
    await extractArchiveWithPowerShell(archive, destination, description);
  };
  return { pins, fetcher, runExecutable, extractArchive, calls, denoFiles, downloads };
};

const prepare = (clientRoot, tools, overrides = {}) => prepareVideoTools("win32", "x64", {
  clientRoot,
  pins: tools.pins,
  fetcher: tools.fetcher,
  runExecutable: tools.runExecutable,
  extractArchive: tools.extractArchive,
  ...overrides,
});

test("extracts a valid Deno ZIP, verifies the executable, and prepares the full bundle", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  const result = await prepare(clientRoot, tools);
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");

  assert.equal(result.status, "prepared");
  assert.deepEqual(await readFile(join(output, "deno.exe")), denoBytes);
  assert.deepEqual(tools.calls.extract, ["Deno", "FFmpeg"]);
  assert.equal(tools.calls.execute, 3);
  assert.deepEqual((await readdir(output)).sort(), [
    ".video-tools-manifest.json",
    "Deno-LICENSE.md",
    "FFmpeg-COPYING.GPLv3.txt",
    "THIRD_PARTY_NOTICES.txt",
    "deno.exe",
    "ffmpeg.exe",
    "ffprobe.exe",
    "yt-dlp-LICENSE.txt",
    "yt-dlp-THIRD_PARTY_LICENSES.txt",
    "yt-dlp.exe",
  ].sort());
});

test("fails with an actionable message when the extracted Deno ZIP omits deno.exe", async () => {
  const clientRoot = await workspace();
  const tools = fixture({ denoFiles: { "README.txt": "no executable" } });

  await assert.rejects(prepare(clientRoot, tools), /no deno\.exe was found/i);
  assert.equal(tools.calls.extract[0], "Deno");
  assert.equal(tools.calls.extract.includes("FFmpeg"), false);
});

test("fails closed when PowerShell archive extraction fails", async () => {
  const clientRoot = await workspace();
  const tools = fixture({ denoArchive: Buffer.from("not a ZIP archive") });

  await assert.rejects(prepare(clientRoot, tools), /Deno.*(?:archive extraction failed|ZIP is corrupt)/i);
  assert.equal(tools.calls.extract.length, 1);
  assert.equal(tools.calls.fetch, 1);
});

test("rejects corrupted archives by checksum before attempting extraction", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  tools.pins.deno.sha256 = "0".repeat(64);

  await assert.rejects(prepare(clientRoot, tools), /checksum validation failed for deno\.zip/i);
  assert.equal(tools.calls.extract.length, 0);
  assert.equal(tools.calls.fetch, 1);
});

test("does not publish a Deno executable that cannot run or reports the wrong version", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  tools.runExecutable = async () => { throw new Error("Could not run extracted Deno executable: Access is denied."); };

  await assert.rejects(prepare(clientRoot, tools), /Could not run extracted Deno executable: Access is denied/i);
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");
  await assert.rejects(readFile(join(output, "deno.exe")), { code: "ENOENT" });
});

test("reuses a prepared bundle without downloading or extracting again", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  const first = await prepare(clientRoot, tools);
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");
  const before = await Promise.all(["deno.exe", "yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe"].map((name) => readFile(join(output, name))));
  const fetchCount = tools.calls.fetch;
  const extractionCount = tools.calls.extract.length;

  const second = await prepare(clientRoot, tools);
  const after = await Promise.all(["deno.exe", "yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe"].map((name) => readFile(join(output, name))));

  assert.equal(first.status, "prepared");
  assert.equal(second.status, "reused");
  assert.equal(tools.calls.fetch, fetchCount);
  assert.equal(tools.calls.extract.length, extractionCount);
  assert.deepEqual(after, before);
});

test("rebuilds instead of reusing a bundle when a prepared executable was changed", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");
  await prepare(clientRoot, tools);
  await writeFile(join(output, "deno.exe"), "modified executable");
  const fetchCount = tools.calls.fetch;
  const extractionCount = tools.calls.extract.length;

  const result = await prepare(clientRoot, tools);

  assert.equal(result.status, "prepared");
  assert.deepEqual(await readFile(join(output, "deno.exe")), denoBytes);
  assert.equal(tools.calls.fetch, fetchCount);
  assert.equal(tools.calls.extract.length, extractionCount + 1);
});

test("rebuilds a partial bundle left by interrupted preparation", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "deno.exe"), "partial write");
  await writeFile(join(output, "yt-dlp.exe"), ytDlpBytes);

  const result = await prepare(clientRoot, tools);
  const installedYtDlp = await readFile(join(output, "yt-dlp.exe"));

  assert.equal(result.status, "prepared");
  assert.deepEqual(installedYtDlp, ytDlpBytes);
  assert.deepEqual(await readFile(join(output, "deno.exe")), denoBytes);
  assert.equal(await readFile(join(output, ".video-tools-manifest.json"), "utf8").then((value) => value.includes(digest(denoBytes))), true);
});

test("recovers the previous verified bundle after interruption during directory publication", async () => {
  const clientRoot = await workspace();
  const tools = fixture();
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");
  const backup = join(clientRoot, "buildResources", "video-tools", ".win32-x64-previous");
  await prepare(clientRoot, tools);
  await rename(output, backup);
  const fetchCount = tools.calls.fetch;
  const extractionCount = tools.calls.extract.length;

  const recovered = await prepare(clientRoot, tools);

  assert.equal(recovered.status, "reused");
  assert.deepEqual(await readFile(join(output, "deno.exe")), denoBytes);
  assert.equal(tools.calls.fetch, fetchCount);
  assert.equal(tools.calls.extract.length, extractionCount);
});

test("does not accept an executable whose bytes fail the pinned checksum", async () => {
  const clientRoot = await workspace();
  const tools = fixture({ ytdlp: Buffer.from("wrong yt-dlp bytes") });
  tools.pins.ytDlp.sha256 = digest(ytDlpBytes);

  await assert.rejects(prepare(clientRoot, tools), /checksum validation failed for yt-dlp\.exe/i);
  const output = join(clientRoot, "buildResources", "video-tools", "win32-x64");
  await assert.rejects(readFile(join(output, "yt-dlp.exe")), { code: "ENOENT" });
});

test("keeps Windows x64 as the only preparation target", async () => {
  assert.deepEqual(await prepareVideoTools("darwin", "arm64"), { status: "unsupported" });
  assert.deepEqual(await prepareVideoTools("win32", "arm64"), { status: "unsupported" });
});
