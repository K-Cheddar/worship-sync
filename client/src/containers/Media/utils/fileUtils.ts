import { FileType } from "../MediaUploadInput.types";

export const detectFileType = (file: File): FileType => {
  if (file.type.startsWith("video/")) {
    return "video";
  } else if (file.type.startsWith("image/")) {
    return "image";
  }
  // Fallback: check extension
  const extension = file.name.split(".").pop()?.toLowerCase();
  const videoExtensions = ["mp4", "mov", "avi", "webm", "mkv", "m4v"];
  const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"];
  
  if (videoExtensions.includes(extension || "")) {
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
    if (file.type.startsWith("video/") || file.type.startsWith("image/")) {
      valid.push(file);
    } else {
      invalid.push(file);
    }
  });

  return { valid, invalid };
};
