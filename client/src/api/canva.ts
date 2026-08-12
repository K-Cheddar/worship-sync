import { getApiBasePath, isPackagedElectronRenderer } from "../utils/environment";
import { getCsrfToken, getHumanApiToken } from "../utils/authStorage";
import type { mediaInfoType } from "../containers/Media/cloudinaryTypes";
import type { MuxUploadResult } from "../containers/Media/MediaUploadInput.types";

export type CanvaStatus = {
  oauthConfigured: boolean;
  connected: boolean;
  accountLabel: string;
};

export type CanvaConnectResponse = {
  authorizeUrl: string;
  connectRequestId: string;
  connectRequestSecret: string;
  expiresAt: number;
  pollIntervalMs: number;
};

export type CanvaConnectStatus = {
  status: "pending" | "completed" | "failed" | "expired";
  errorMessage: string;
  accountLabel?: string;
};

export type CanvaDesign = {
  id: string;
  title: string;
  thumbnailUrl: string;
  pageCount: number;
  updatedAt: number | string;
};

export type CanvaImportedAsset =
  | { kind: "image"; data: mediaInfoType }
  | { kind: "video"; data: MuxUploadResult };

type JsonInit = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

const fetchJson = async <T>(path: string, init: JsonInit = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? 20000,
  );
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const csrf = getCsrfToken();
  if (csrf) headers.set("x-csrf-token", csrf);
  const humanToken = getHumanApiToken();
  if (isPackagedElectronRenderer() && humanToken) {
    headers.set("Authorization", `Bearer ${humanToken}`);
  }
  try {
    const response = await fetch(`${getApiBasePath()}${path.replace(/^\//, "")}`, {
      ...init,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "Canva could not complete that request. Try again.");
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Canva took too long to respond. Try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

const base = (churchId: string) =>
  `api/churches/${encodeURIComponent(churchId)}/canva`;

export const getCanvaStatus = (churchId: string) =>
  fetchJson<CanvaStatus>(`${base(churchId)}/status`);

export const startCanvaConnect = (
  churchId: string,
  options: { returnTo?: string; desktop?: boolean } = {},
) =>
  fetchJson<CanvaConnectResponse>(`${base(churchId)}/connect-url`, {
    method: "POST",
    body: options,
  });

export const getCanvaConnectStatus = (
  churchId: string,
  request: { connectRequestId: string; connectRequestSecret: string },
) =>
  fetchJson<CanvaConnectStatus>(`${base(churchId)}/connect-status`, {
    method: "POST",
    body: request,
  });

export const disconnectCanva = (churchId: string) =>
  fetchJson<{ success: true }>(`${base(churchId)}/disconnect`, {
    method: "POST",
    body: {},
  });

export const listCanvaDesigns = (churchId: string, query = "") => {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  return fetchJson<{ items: CanvaDesign[]; continuation: string }>(
    `${base(churchId)}/designs${params.size ? `?${params}` : ""}`,
  );
};

export const importCanvaDesign = (
  churchId: string,
  request: {
    designId: string;
    pages: number[];
    format: "png" | "mp4";
    existingImportKeys: string[];
  },
) =>
  fetchJson<{
    assets: CanvaImportedAsset[];
    skippedCount: number;
    revision: number;
  }>(`${base(churchId)}/imports`, {
    method: "POST",
    body: request,
    timeoutMs: 4 * 60 * 1000,
  });
