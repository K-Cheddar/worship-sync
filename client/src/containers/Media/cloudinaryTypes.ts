export type mediaInfoType = {
  // Common properties
  id: string;
  batchId: string;
  asset_id: string;
  public_id: string;
  version: number;
  version_id: string;
  signature: string;
  width: number;
  height: number;
  format: string;
  resource_type: "image" | "video";
  created_at: string;
  tags: string[];
  pages: number;
  bytes: number;
  type: string;
  etag: string;
  placeholder: boolean;
  url: string;
  secure_url: string;
  folder: string;
  access_mode: string;
  existing: boolean;
  original_filename: string;
  path: string;
  thumbnail_url: string;
  done: boolean;

  // Video-specific properties (optional)
  playback_url?: string;
  audio?: {
    codec: string;
    bit_rate: string;
    frequency: number;
    channels: number;
    channel_layout: string;
  };
  video?: {
    pix_format: string;
    codec: string;
    level: number;
    profile: string;
    bit_rate: string;
    dar: string;
    time_base: string;
  };
  is_audio?: boolean;
  frame_rate?: number;
  bit_rate?: number;
  duration?: number;
  rotation?: number;
  nb_frames?: number;

  // Image-specific properties (optional)
  colors?: Array<[string, number]>;
  predominant?: {
    google: Array<[string, number]>;
    cloudinary: Array<[string, number]>;
  };
};
