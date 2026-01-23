import { mediaInfoType } from "./cloudinaryTypes";

export type UploadStatus = "idle" | "uploading" | "processing" | "ready" | "error";
export type FileType = "image" | "video";

export type FileUploadProgress = {
  file: File;
  fileType: FileType;
  status: UploadStatus;
  progress: number;
  error?: string;
};

export type MediaUploadInputProps = {
  onImageComplete: (info: mediaInfoType) => void;
  onVideoComplete: (muxData: {
    playbackId: string;
    assetId: string;
    playbackUrl: string;
    thumbnailUrl: string;
    name: string;
  }) => void;
  showButton?: boolean;
  uploadPreset?: string;
  cloudName?: string;
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
};
