import type { CanvaMediaSource, MediaType } from "../../types";

export type UploadStatus =
  | "idle"
  | "uploading"
  | "processing"
  | "ready"
  | "error";
export type FileType = "image" | "video";

export type FileUploadProgress = {
  file: File;
  fileType: FileType;
  status: UploadStatus;
  progress: number;
  error?: string;
};

export type MediaUploadInputProps = {
  onLocalMediaAdded: (media: MediaType) => void;
  onLocalMediaPatched?: (id: string, patch: Partial<MediaType>) => void;
  showButton?: boolean;
  uploadPreset?: string;
  /** Called when upload starts (true) or ends (false). Use to start/stop external progress polling. */
  onUploadActiveChange?: (active: boolean) => void;
  /** When true, the upload modal cannot be opened and file upload is disabled. */
  uploadDisabled?: boolean;
};

export type MediaUploadInputRef = {
  openModal: () => void;
  getUploadStatus: () => {
    isUploading: boolean;
    progress: number;
    status: UploadStatus;
  };
};

export type MuxUploadResult = {
  playbackId: string;
  assetId: string;
  playbackUrl: string;
  thumbnailUrl: string;
  name: string;
  /** Stable identity for detecting an already-imported Canva page selection. */
  canvaImportKey?: string;
  canvaSource?: CanvaMediaSource;
};
