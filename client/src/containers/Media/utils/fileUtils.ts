import { FileType } from "../MediaUploadInput.types";
import {
  getFileExtension,
  isSupportedVideoFile,
  SUPPORTED_VIDEO_EXTENSIONS,
} from "../../../utils/mediaFileTypes";

export const detectFileType = (file: File): FileType => {
  if (isSupportedVideoFile(file)) {
    return "video";
  } else if (file.type.startsWith("image/")) {
    return "image";
  }
  // Fallback: check extension
  const extension = getFileExtension(file.name);
  const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"];
  
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  } else if (imageExtensions.includes(extension || "")) {
    return "image";
  }
  
  // Default to image if uncertain
  return "image";
};

export const validateFiles = (files: File[]): { valid: File[]; invalid: File[] } => {
  const valid: File[] = [];
  const invalid: File[] = [];

  files.forEach((file) => {
    if (isSupportedVideoFile(file) || file.type.startsWith("image/")) {
      valid.push(file);
    } else {
      invalid.push(file);
    }
  });

  return { valid, invalid };
};
