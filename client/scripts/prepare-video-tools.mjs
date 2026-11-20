import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRelativePath = join("buildResources", "video-tools", "win32-x64");
const cacheRelativePath = join(".cache", "video-tools");

const PINNED_TOOLS = {
  ytDlp: {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe",
    sha256: "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d",
    fileName: "yt-dlp.exe",
    maxBytes: 30 * 1024 * 1024,
  },
  deno: {
    url: "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip",
    sha256: "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
    fileName: "deno.exe",
    version: "2.9.8",
    maxBytes: 60 * 1024 * 1024,
  },
  ffmpeg: {
    url: "https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip",
    sha256: "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec",
    files: {
      "ffmpeg.exe": "1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e",
      "ffprobe.exe": "b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07",
    },
    maxBytes: 180 * 1024 * 1024,
  },
  licenses: [
    {
      url: "https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/LICENSE",
      fileName: "yt-dlp-LICENSE.txt",
    },
    {
      url: "https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/THIRD_PARTY_LICENSES.txt",
      fileName: "yt-dlp-THIRD_PARTY_LICENSES.txt",
    },
    {
      url: "https://raw.githubusercontent.com/denoland/deno/v2.9.8/LICENSE.md",
      fileName: "Deno-LICENSE.md",
    },
    {
      url: "https://raw.githubusercontent.com/FFmpeg/FFmpeg/38b88335f9/COPYING.GPLv3",
      fileName: "FFmpeg-COPYING.GPLv3.txt",
    },
  ],
};

const MANIFEST_NAME = ".video-tools-manifest.json";
const ALLOWED_DOWNLOAD_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "www.gyan.dev"]);
const ALLOWED_LICENSE_HOSTS = new Set(["raw.githubusercontent.com"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
const errorMessage = (error) => error instanceof Error ? error.message : String(error);

const runPowerShell = (source, description) => new Promise((resolvePromise, reject) => {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errorText = "";
  child.stderr.on("data", (chunk) => {
    if (errorText.length < 16 * 1024) errorText += chunk.toString("utf8").slice(0, 16 * 1024 - errorText.length);
  });
  child.once("error", (error) => reject(new Error(`Could not start PowerShell to extract the ${description} archive: ${error.message}`)));
  child.once("close", (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error(errorText.trim() || `PowerShell exited with code ${code ?? "unknown"}.`));
  });
});

export const extractArchiveWithPowerShell = async (archive, destination, description = "pinned video tool") => {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "try {",
    "  [void][System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')",
    `  [System.IO.Compression.ZipFile]::ExtractToDirectory(${quotePowerShell(archive)}, ${quotePowerShell(destination)})`,
    "} catch {",
    "  [Console]::Error.WriteLine($_.Exception.Message)",
    "  exit 1",
    "}",
  ].join("\n");

  try {
    await runPowerShell(script, description);
  } catch (error) {
    throw new Error(`${description} archive extraction failed: ${errorMessage(error)}`);
  }
};

const writeAtomically = async (destination, bytes, mode = 0o600) => {
  const temporary = join(dirname(destination), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode });
    try {
      await rename(temporary, destination);
    } catch (error) {
      // Replacing a known-invalid cache file is safe; it cannot be reused unless
      // its checksum matches, and the replacement is complete before rename.
      await rm(destination, { force: true });
      await rename(temporary, destination).catch(() => { throw error; });
    }
  } finally {
    await rm(temporary, { force: true });
  }
};

const downloadVerified = async (url, expectedHash, destination, maxBytes, fetcher) => {
  const existing = await readFile(destination).catch(() => null);
  if (existing && existing.length > 0 && existing.length <= maxBytes && sha256(existing) === expectedHash) return existing;

  let response;
  try {
    response = await fetcher(url, { redirect: "follow" });
  } catch (error) {
    throw new Error(`Could not download pinned video tool ${new URL(url).pathname.split("/").at(-1)}: ${errorMessage(error)}`);
  }
  let finalUrl;
  try {
    finalUrl = new URL(response.url || url);
  } catch {
    throw new Error("Pinned tool download returned an invalid URL.");
  }
  if (!response.ok || !ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
    throw new Error(`Pinned tool download failed (${response.status || "invalid response"}) from ${finalUrl.hostname}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes || sha256(bytes) !== expectedHash) {
    throw new Error(`Pinned video tool checksum validation failed for ${new URL(url).pathname.split("/").at(-1)}.`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeAtomically(destination, bytes);
  return bytes;
};

const fetchLicense = async ({ url, fileName }, destination, fetcher) => {
  let response;
  try {
    response = await fetcher(url, { redirect: "follow" });
  } catch (error) {
    throw new Error(`Could not retrieve pinned video tool license ${fileName}: ${errorMessage(error)}`);
  }
  let finalUrl;
  try {
    finalUrl = new URL(response.url || url);
  } catch {
    throw new Error(`Pinned license URL is invalid for ${fileName}.`);
  }
  if (!response.ok || !ALLOWED_LICENSE_HOSTS.has(finalUrl.hostname)) {
    throw new Error(`Could not retrieve pinned video tool license ${fileName} (${response.status || "invalid response"}).`);
  }
  const text = await response.text();
  if (!text || text.length > 256 * 1024) throw new Error(`Pinned video tool license ${fileName} is invalid.`);
  await writeFile(destination, text, "utf8");
};

const findFilesNamed = async (directory, expectedName) => {
  const matches = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) matches.push(candidate);
      else if (entry.isDirectory()) await visit(candidate);
    }
  };
  await visit(directory);
  return matches;
};

const copyExtractedExecutable = async (directory, fileName, destination, description) => {
  const matches = await findFilesNamed(directory, fileName);
  if (matches.length === 0) {
    throw new Error(`The pinned ${description} archive extracted, but no ${fileName} was found. Check the archive layout and extraction output.`);
  }
  if (matches.length > 1) {
    throw new Error(`The pinned ${description} archive contained multiple ${fileName} files; refusing an ambiguous executable.`);
  }
  if ((await stat(matches[0])).size === 0) throw new Error(`The extracted ${description} executable ${fileName} is empty.`);
  await copyFile(matches[0], destination);
};

const runExecutable = (executablePath, args, description) => new Promise((resolvePromise, reject) => {
  const child = spawn(executablePath, args, {
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  const timeout = setTimeout(() => {
    child.kill();
    finish(new Error(`${description} did not exit within 15 seconds.`));
  }, 15_000);
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) reject(error);
    else resolvePromise(result);
  };
  child.stdout.on("data", (chunk) => { if (stdout.length < 16 * 1024) stdout += chunk.toString("utf8").slice(0, 16 * 1024 - stdout.length); });
  child.stderr.on("data", (chunk) => { if (stderr.length < 16 * 1024) stderr += chunk.toString("utf8").slice(0, 16 * 1024 - stderr.length); });
  child.once("error", (error) => finish(new Error(`Could not run the ${description}: ${error.message}`)));
  child.once("close", (code) => code === 0
    ? finish(null, { stdout, stderr })
    : finish(new Error(`${description} exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : "."}`)));
});

const pinFingerprint = (pins) => ({
  ytDlp: { url: pins.ytDlp.url, sha256: pins.ytDlp.sha256 },
  deno: { url: pins.deno.url, sha256: pins.deno.sha256, version: pins.deno.version },
  ffmpeg: { url: pins.ffmpeg.url, sha256: pins.ffmpeg.sha256, files: pins.ffmpeg.files },
  licenses: pins.licenses.map(({ url, fileName }) => ({ url, fileName })),
});

const expectedArtifactNames = (pins) => [
  pins.ytDlp.fileName,
  pins.deno.fileName,
  ...Object.keys(pins.ffmpeg.files),
  ...pins.licenses.map(({ fileName }) => fileName),
  "THIRD_PARTY_NOTICES.txt",
];

const readBundleManifest = async (directory, pins) => {
  try {
    const manifest = JSON.parse(await readFile(join(directory, MANIFEST_NAME), "utf8"));
    const names = expectedArtifactNames(pins);
    if (
      manifest.format !== 1 ||
      JSON.stringify(manifest.pins) !== JSON.stringify(pinFingerprint(pins)) ||
      !manifest.files ||
      Object.keys(manifest.files).length !== names.length ||
      names.some((name) => typeof manifest.files[name] !== "string")
    ) return null;
    return manifest;
  } catch {
    return null;
  }
};

const copyIfVerified = async (sourceDirectory, destinationDirectory, fileName, expectedHash) => {
  if (!expectedHash) return false;
  try {
    const source = join(sourceDirectory, fileName);
    if ((await stat(source)).size === 0 || await sha256File(source) !== expectedHash) return false;
    await copyFile(source, join(destinationDirectory, fileName));
    return true;
  } catch {
    return false;
  }
};

const verifyDenoExecutable = async (path, pins, execute, description) => {
  const deno = await execute(path, ["--version"], description);
  if (!new RegExp(`\\bdeno\\s+${pins.deno.version.replaceAll(".", "\\.")}\\b`, "i").test(`${deno.stdout}\n${deno.stderr}`)) {
    throw new Error(`The ${description} did not report the pinned version ${pins.deno.version}.`);
  }
};

const isBundleReady = async (directory, pins, execute) => {
  try {
    const manifest = await readBundleManifest(directory, pins);
    if (!manifest) return false;
    const names = expectedArtifactNames(pins);
    for (const fileName of names) {
      const path = join(directory, fileName);
      if ((await stat(path)).size === 0) return false;
      const fileHash = await sha256File(path);
      if (manifest.files[fileName] !== fileHash) return false;
      if (fileName === pins.ytDlp.fileName && fileHash !== pins.ytDlp.sha256) return false;
      if (pins.ffmpeg.files[fileName] && fileHash !== pins.ffmpeg.files[fileName]) return false;
    }
    await verifyDenoExecutable(join(directory, pins.deno.fileName), pins, execute, "Deno");
    return true;
  } catch {
    return false;
  }
};

const recoverInterruptedPublish = async (output, backup, pins, execute) => {
  const backupExists = await stat(backup).then(() => true).catch((error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (!backupExists) return;

  if (await isBundleReady(output, pins, execute)) {
    await rm(backup, { recursive: true, force: true });
    return;
  }

  await rm(output, { recursive: true, force: true });
  await rename(backup, output);
};

const createNotices = (pins) => [
  "WorshipSync desktop video tool notices",
  "",
  "yt-dlp 2026.10.26 Windows x64 standalone executable (GPLv3+ combined binary).",
  "Source and matching release: https://github.com/yt-dlp/yt-dlp/tree/2026.10.26",
  "Third-party license notices are in yt-dlp-THIRD_PARTY_LICENSES.txt.",
  "",
  `Deno ${pins.deno.version} Windows x64 JavaScript runtime (MIT).`,
  `Source and matching release: https://github.com/denoland/deno/tree/v${pins.deno.version}`,
  "The license is in Deno-LICENSE.md.",
  "",
  "FFmpeg 8.1.2 Essentials Windows x64 static build (GPLv3).",
  "Build distribution and corresponding source: https://www.gyan.dev/ffmpeg/builds/",
  "Upstream source revision: https://github.com/FFmpeg/FFmpeg/commit/38b88335f9",
  `The FFmpeg distribution archive SHA-256 is ${pins.ffmpeg.sha256}.`,
  "",
  "yt-dlp's license and bundled third-party license texts are included beside the binaries.",
  "FFmpeg's GPLv3 license text and source revision are included beside the binaries. The Gyan static distribution is GPLv3; maintainers must keep the matching source/build materials available with releases as required by the applicable license terms.",
  "WorshipSync invokes these command-line programs as separate processes.",
].join("\n");

/**
 * Prepare the pinned native tools for Windows x64 Electron builds.
 * Optional dependencies are injection points for fixture-backed unit tests.
 */
export const prepareVideoTools = async (platform = process.platform, arch = process.arch, dependencies = {}) => {
  if (platform !== "win32" || arch !== "x64") return { status: "unsupported" };

  const clientRoot = dependencies.clientRoot || root;
  const pins = dependencies.pins || PINNED_TOOLS;
  const fetcher = dependencies.fetcher || fetch;
  const extractArchive = dependencies.extractArchive || extractArchiveWithPowerShell;
  const execute = dependencies.runExecutable || runExecutable;
  const output = join(clientRoot, outputRelativePath);
  const cache = join(clientRoot, cacheRelativePath);
  const parent = dirname(output);
  const backup = join(parent, ".win32-x64-previous");

  await mkdir(parent, { recursive: true });
  await mkdir(cache, { recursive: true });
  await recoverInterruptedPublish(output, backup, pins, execute);
  if (await isBundleReady(output, pins, execute)) return { status: "reused" };

  const staging = await mkdtemp(join(parent, ".win32-x64-staging-"));
  try {
    const denoArchive = join(cache, "deno.zip");
    const ffmpegArchive = join(cache, "ffmpeg.zip");
    const ytDlpDownload = join(staging, pins.ytDlp.fileName);
    const denoDirectory = join(staging, "deno-extracted");
    const ffmpegDirectory = join(staging, "ffmpeg-extracted");
    const existingManifest = await readBundleManifest(output, pins);

    const denoPath = join(staging, pins.deno.fileName);
    let reusedDeno = await copyIfVerified(output, staging, pins.deno.fileName, existingManifest?.files[pins.deno.fileName]);
    if (reusedDeno) {
      try {
        await verifyDenoExecutable(denoPath, pins, execute, "existing Deno executable");
      } catch {
        reusedDeno = false;
        await rm(denoPath, { force: true });
      }
    }
    if (!reusedDeno) {
      await downloadVerified(pins.deno.url, pins.deno.sha256, denoArchive, pins.deno.maxBytes, fetcher);
      await mkdir(denoDirectory);
      await extractArchive(denoArchive, denoDirectory, "Deno");
      await copyExtractedExecutable(denoDirectory, pins.deno.fileName, denoPath, "Deno");
      await verifyDenoExecutable(denoPath, pins, execute, "extracted Deno executable");
    }

    if (!await copyIfVerified(output, staging, pins.ytDlp.fileName, pins.ytDlp.sha256)) {
      await downloadVerified(pins.ytDlp.url, pins.ytDlp.sha256, ytDlpDownload, pins.ytDlp.maxBytes, fetcher);
    }
    const reusedFfmpeg = new Set();
    for (const [fileName, expectedHash] of Object.entries(pins.ffmpeg.files)) {
      if (await copyIfVerified(output, staging, fileName, expectedHash)) reusedFfmpeg.add(fileName);
    }
    if (reusedFfmpeg.size !== Object.keys(pins.ffmpeg.files).length) {
      await downloadVerified(pins.ffmpeg.url, pins.ffmpeg.sha256, ffmpegArchive, pins.ffmpeg.maxBytes, fetcher);
      await mkdir(ffmpegDirectory);
      await extractArchive(ffmpegArchive, ffmpegDirectory, "FFmpeg");
    }
    for (const [fileName, expectedHash] of Object.entries(pins.ffmpeg.files)) {
      if (reusedFfmpeg.has(fileName)) continue;
      const executablePath = join(staging, fileName);
      await copyExtractedExecutable(ffmpegDirectory, fileName, executablePath, "FFmpeg");
      if (await sha256File(executablePath) !== expectedHash) throw new Error(`The extracted ${fileName} failed its pinned checksum validation.`);
    }
    await rm(denoDirectory, { recursive: true, force: true });
    await rm(ffmpegDirectory, { recursive: true, force: true });

    for (const license of pins.licenses) {
      const expectedHash = existingManifest?.files[license.fileName];
      if (!await copyIfVerified(output, staging, license.fileName, expectedHash)) {
        await fetchLicense(license, join(staging, license.fileName), fetcher);
      }
    }
    if (!await copyIfVerified(output, staging, "THIRD_PARTY_NOTICES.txt", existingManifest?.files["THIRD_PARTY_NOTICES.txt"])) {
      await writeFile(join(staging, "THIRD_PARTY_NOTICES.txt"), createNotices(pins), "utf8");
    }

    const files = {};
    for (const fileName of expectedArtifactNames(pins)) {
      const path = join(staging, fileName);
      if ((await stat(path)).size === 0) throw new Error(`Prepared video tool file ${fileName} is empty.`);
      files[fileName] = await sha256File(path);
    }
    await writeFile(join(staging, MANIFEST_NAME), JSON.stringify({
      format: 1,
      pins: pinFingerprint(pins),
      files,
    }, null, 2), "utf8");

    if (!await isBundleReady(staging, pins, execute)) {
      throw new Error("The staged Windows video tools failed their readiness checks; the existing package was left untouched.");
    }

    await rm(backup, { recursive: true, force: true });
    const outputExists = await stat(output).then(() => true).catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (outputExists) await rename(output, backup);
    try {
      await rename(staging, output);
    } catch (error) {
      if (outputExists) await rename(backup, output).catch(() => {});
      throw new Error(`Could not publish the prepared Windows video tools: ${errorMessage(error)}`);
    }
    if (!await isBundleReady(output, pins, execute)) {
      throw new Error("The published Windows video tools failed their readiness checks.");
    }
    await rm(backup, { recursive: true, force: true });
    return { status: "prepared" };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareVideoTools().catch((error) => {
    console.error(error instanceof Error ? error.message : "Video tools could not be prepared.");
    process.exitCode = 1;
  });
}
