export type ExternalResourceProvider =
  | "worshipsync"
  | "youtube"
  | "dropbox"
  | "google-drive"
  | "onedrive"
  | "sharepoint"
  | "box"
  | "direct"
  | "web"
  | "unknown";

export type ExternalResourceMediaType =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "web"
  | "unknown";

export type ExternalResourcePreviewType =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "youtube"
  | "web"
  | "unsupported";

export type ExternalResourceResolution = {
  originalUrl: string;
  externalUrl: string;
  provider: ExternalResourceProvider;
  title?: string;
  filename?: string;
  mimeType?: string;
  mediaType: ExternalResourceMediaType;
  previewType: ExternalResourcePreviewType;
  previewUrl: string | null;
  requiresProxy: boolean;
  canPreview: boolean;
  mediaId?: string;
  reason?: string;
};
