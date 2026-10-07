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

export type ExternalResourceSourceKind = "file" | "web" | "youtube" | "unavailable";

export type ExternalResourceResolution = {
  originalUrl: string;
  /** @deprecated Kept for existing external API consumers; use originalUrl. */
  externalUrl?: string;
  provider: ExternalResourceProvider;
  sourceKind: ExternalResourceSourceKind;
  title?: string;
  filename?: string;
  mimeType?: string;
  previewUrl: string | null;
  expiresAt?: string;
  /** @deprecated Use sourceKind and the client renderer selector. */
  mediaType?: "image" | "audio" | "video" | "document" | "web" | "unknown";
  /** @deprecated Use sourceKind and the client renderer selector. */
  previewType?: "docx" | "text" | "image" | "audio" | "video" | "document" | "youtube" | "web" | "unsupported";
  /** @deprecated Use sourceKind and the client renderer selector. */
  requiresProxy?: boolean;
  /** @deprecated Use sourceKind and the client renderer selector. */
  canPreview?: boolean;
  mediaId?: string;
  reason?: string;
};
