import { apiFetch } from "./auth";

export type ProviderAssetAccounting = {
  provider: "cloudinary" | "mux";
  assetId: string;
  churchId: string;
  permanent: true;
  publicId?: string;
  bytes?: number;
  durationSeconds?: number;
};

export type MuxUploadIntent = { uploadId: string; url: string };

export type MuxProviderAsset = {
  status: string;
  assetId?: string;
  playbackId?: string;
  duration?: number;
  temporary?: boolean;
  aspectRatio?: string;
  staticRenditions?: Array<{ resolution: string; status: string; name?: string }>;
  staticRenditionReady?: boolean;
};

const base = (churchId: string) =>
  `api/churches/${encodeURIComponent(churchId)}`;

export const commitCloudinaryMediaAsset = (churchId: string, publicId: string) =>
  apiFetch<{ asset: ProviderAssetAccounting }>(
    `${base(churchId)}/media-storage/cloudinary/commit`,
    { method: "POST", body: JSON.stringify({ publicId }) },
  );

export const deleteCloudinaryMediaAsset = (churchId: string, publicId: string) =>
  apiFetch<{ success: boolean }>(
    `${base(churchId)}/media-storage/cloudinary/delete`,
    { method: "POST", body: JSON.stringify({ publicId }) },
  );

export const createChurchMuxUpload = (
  churchId: string,
  input: { mediaId: string; title: string; temporary?: boolean },
) =>
  apiFetch<MuxUploadIntent>(`${base(churchId)}/mux/uploads`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getChurchMuxUpload = (churchId: string, uploadId: string) =>
  apiFetch<{ status: string; assetId?: string }>(
    `${base(churchId)}/mux/uploads/${encodeURIComponent(uploadId)}`,
  );

export const getChurchMuxAsset = (churchId: string, assetId: string) =>
  apiFetch<MuxProviderAsset>(
    `${base(churchId)}/mux/assets/${encodeURIComponent(assetId)}`,
  );

export const deleteChurchMuxAsset = (churchId: string, assetId: string) =>
  apiFetch<{ success: boolean }>(
    `${base(churchId)}/mux/assets/${encodeURIComponent(assetId)}/delete`,
    { method: "POST", body: JSON.stringify({}) },
  );
