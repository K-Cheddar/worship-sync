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
  /** Temporary user-facing name; the source File.name remains immutable. */
  displayName: string;
  fileType: FileType;
  status: UploadStatus;
  progress: number;
  /** Local import succeeds before an optional cloud share. Keep its identity
   * so retrying a cloud failure does not create a second local media item. */
  localMedia?: MediaType;
  error?: string;
  canConvertForOfflinePlayback?: boolean;
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
  openModalWithFiles: (files: File[]) => void;
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
  /** Static H.264/AAC MP4 rendition used for offline conversion. */
  mp4Url?: string;
  thumbnailUrl: string;
  name: string;
  durationSeconds?: number;
  /** Stable identity for detecting an already-imported Canva page selection. */
  canvaImportKey?: string;
  canvaSource?: CanvaMediaSource;
};
