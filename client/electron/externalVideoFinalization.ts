import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createWriteStream } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { LocalAssetDescriptor, LocalAssetStore } from "./localAssetStore";

const WINDOWS_INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

export const normalizeExternalVideoFileName = (displayName: string) => {
  const normalized = displayName
    .normalize("NFKC")
    .replace(WINDOWS_INVALID_FILENAME_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 140)
    .replace(/[. ]+$/g, "");
  const safeName = normalized || "Downloaded video";
  const extensionSafeName = safeName.toLowerCase().endsWith(".mp4")
    ? safeName
    : `${safeName}.mp4`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(extensionSafeName)
    ? `_${extensionSafeName}`
    : extensionSafeName;
};

const hashFile = async (path: string) => {
  const hash = createHash("sha256");
  const pathStat = await lstat(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new Error("Choose a regular video file.");
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(path, fsConstants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() || openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino || openedStat.size !== pathStat.size ||
      openedStat.mtimeMs !== pathStat.mtimeMs
    ) throw new Error("The video file changed while it was being checked.");
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk as Buffer);
    }
    const finalStat = await handle.stat();
    if (
      finalStat.size !== openedStat.size || finalStat.mtimeMs !== openedStat.mtimeMs
    ) throw new Error("The video file changed while it was being checked.");
    return hash.digest("hex");
  } finally {
    await handle.close().catch(() => undefined);
  }
};

const fileHashMatches = async (
  candidate: string,
  sourceSize: number,
  sourceHash: string,
) => {
  try {
    const candidateStat = await lstat(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size !== sourceSize) {
      return false;
    }
    return (await hashFile(candidate)) === sourceHash;
  } catch {
    return false;
  }
};

const chooseDestination = async (
  directory: string,
  fileName: string,
  sourceSize: number,
  sourceHash: string,
) => {
  const extension = ".mp4";
  const stem = fileName.slice(0, -extension.length);
  for (let number = 1; number <= 1000; number += 1) {
    const candidateName = number === 1 ? fileName : `${stem} (${number}).mp4`;
    const candidate = join(directory, candidateName);
    try {
      await lstat(candidate);
      if (await fileHashMatches(candidate, sourceSize, sourceHash)) {
        return { path: candidate, fileName: candidateName, alreadyPresent: true };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: candidate, fileName: candidateName, alreadyPresent: false };
      }
      throw error;
    }
  }
  throw new Error("A safe filename could not be selected in that folder.");
};

const copyToTemporaryFile = async (
  sourcePath: string,
  directory: string,
  expectedSize: number,
  expectedHash: string,
) => {
  const temporaryPath = join(directory, `.worshipsync-${randomUUID()}.partial`);
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const pathStat = await lstat(sourcePath);
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size !== expectedSize) {
      throw new Error("The completed video changed before it could be saved.");
    }
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    sourceHandle = await open(sourcePath, fsConstants.O_RDONLY | noFollow);
    const openedStat = await sourceHandle.stat();
    if (
      !openedStat.isFile() || openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino || openedStat.size !== expectedSize ||
      openedStat.mtimeMs !== pathStat.mtimeMs
    ) throw new Error("The completed video changed before it could be saved.");
    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
    const handle = await open(temporaryPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const [sourceStat, temporaryStat] = await Promise.all([
      sourceHandle.stat(),
      lstat(temporaryPath),
    ]);
    if (
      !sourceStat.isFile() || !temporaryStat.isFile() ||
      temporaryStat.isSymbolicLink() || sourceStat.size <= 0 ||
      temporaryStat.size !== sourceStat.size || temporaryStat.size !== expectedSize ||
      (await hashFile(temporaryPath)) !== expectedHash
    ) {
      throw new Error("The downloaded video could not be saved completely.");
    }
    return { path: temporaryPath, size: sourceStat.size };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await sourceHandle?.close().catch(() => undefined);
  }
};

const moveWithoutReplacing = async (temporaryPath: string, destination: string) => {
  try {
    // Same-directory hard-link creation is atomic and fails if the name exists.
    await link(temporaryPath, destination);
    await rm(temporaryPath, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw error;
    // Some removable filesystems do not support hard links. COPYFILE_EXCL keeps
    // the no-overwrite guarantee; the temporary file is never a .mp4 item.
    await copyFile(temporaryPath, destination, fsConstants.COPYFILE_EXCL);
    await rm(temporaryPath, { force: true });
  }
};

export const finalizeExternalVideo = async (args: {
  sourcePath: string;
  sourceDirectory: string;
  destinationDirectory: string;
  displayName: string;
  assetId: string;
  workspaceId: string;
  width: number;
  height: number;
  store: LocalAssetStore;
}, retry = 0): Promise<{ asset: LocalAssetDescriptor; fileName: string }> => {
  if (retry > 12) throw new Error("A safe filename could not be selected in that folder.");
  const registered = await args.store.getRegisteredDescriptor(args.assetId);
  if (registered?.storageMode === "linked") {
    const available = await args.store.get(args.assetId);
    if (available) return { asset: available, fileName: available.fileName };
    throw new Error("The video is already linked, but its saved file is unavailable. Relink it from the Media Library.");
  }
  if (registered) throw new Error("This video is already registered in managed local storage.");
  const directory = await realpath(args.destinationDirectory);
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Choose an available folder for the downloaded video.");
  }
  const sourceDirectoryStat = await lstat(args.sourceDirectory);
  if (!sourceDirectoryStat.isDirectory() || sourceDirectoryStat.isSymbolicLink()) {
    throw new Error("The temporary download is no longer available.");
  }
  const sourceDirectory = await realpath(args.sourceDirectory);
  if (!isAbsolute(args.sourcePath)) throw new Error("The completed video path is invalid.");
  const sourcePath = resolve(args.sourcePath);
  const relativeSourcePath = relative(sourceDirectory, sourcePath);
  if (
    relativeSourcePath === ".." ||
    relativeSourcePath.startsWith(`..${sep}`) ||
    isAbsolute(relativeSourcePath)
  ) throw new Error("The completed video path is invalid.");
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size <= 0) {
    throw new Error("The completed video is no longer available to save.");
  }
  const sourceHash = await hashFile(sourcePath);
  const safeName = normalizeExternalVideoFileName(args.displayName);
  const selected = await chooseDestination(
    directory,
    safeName,
    sourceStat.size,
    sourceHash,
  );
  if (!selected.alreadyPresent) {
    let temporary: { path: string; size: number } | undefined;
    try {
      temporary = await copyToTemporaryFile(sourcePath, directory, sourceStat.size, sourceHash);
      if (temporary.size !== sourceStat.size) {
        throw new Error("The downloaded video could not be saved completely.");
      }
      await moveWithoutReplacing(temporary.path, selected.path);
      temporary = undefined;
    } catch (error) {
      if (temporary) await rm(temporary.path, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return finalizeExternalVideo(args, retry + 1);
      }
      throw error;
    }
  }
  const linked = await args.store.linkFile({
    assetId: args.assetId,
    workspaceId: args.workspaceId,
    kind: "video",
    sourcePath: selected.path,
    fileName: basename(selected.path),
    contentType: "video/mp4",
    width: args.width,
    height: args.height,
  });
  if (linked.contentHash !== sourceHash) {
    await args.store.delete(args.assetId).catch(() => false);
    throw new Error("The saved video changed while it was being registered.");
  }
  return { asset: linked, fileName: selected.fileName };
};
