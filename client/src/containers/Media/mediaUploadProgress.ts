import type { FileUploadProgress } from "./MediaUploadInput.types";
import { normalizeProgress } from "../../context/transferModel";

/** File progress follows the actual work: 40% local import and 60% cloud share. */
export const getMediaFileProgress = (progress: FileUploadProgress) =>
  progress.status === "ready" ? 100 : normalizeProgress(progress.progress) ?? 0;

/** Every file contributes equally, including files already completed. */
export const getMediaBatchProgress = (files: FileUploadProgress[]) =>
  files.length
    ? files.reduce((sum, file) => sum + getMediaFileProgress(file), 0) / files.length
    : null;

export const getMediaCloudFileProgress = (cloudProgress: number) =>
  40 + (normalizeProgress(cloudProgress) ?? 0) * 0.6;
