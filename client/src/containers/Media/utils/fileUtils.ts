import { FileType } from "../MediaUploadInput.types";
import {
  getFileExtension,
  isRecognizedImageFile,
  isSupportedVideoFile,
  SUPPORTED_VIDEO_EXTENSIONS,
} from "../../../utils/mediaFileTypes";

export const detectFileType = (file: File): FileType => {
  if (isSupportedVideoFile(file)) {
    return "video";
  } else if (isRecognizedImageFile(file)) {
    return "image";
  }
  // Fallback: check extension
  const extension = getFileExtension(file.name);
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  } else if (isRecognizedImageFile(file)) {
    return "image";
  }
  
  // Default to image if uncertain
  return "image";
};

export const validateFiles = (files: File[]): { valid: File[]; invalid: File[] } => {
  const valid: File[] = [];
  const invalid: File[] = [];

  files.forEach((file) => {
    if (
      isSupportedVideoFile(file) ||
      isRecognizedImageFile(file)
    ) {
      valid.push(file);
    } else {
      invalid.push(file);
    }
  });

  return { valid, invalid };
};
