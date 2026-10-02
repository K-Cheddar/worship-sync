import { apiFetch, authenticatedApiFetch } from "./auth";
import type { mediaInfoType } from "../containers/Media/cloudinaryTypes";
import type { MuxUploadResult } from "../containers/Media/MediaUploadInput.types";
import { CanvaImportError } from "../utils/canvaImportError";

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
  editUrl: string;
  viewUrl: string;
};

export type CanvaImportedAsset =
  | { kind: "image"; data: mediaInfoType }
  | { kind: "video"; data: MuxUploadResult };

export type CanvaMp4ImportMode = "combined" | "separate";

export type CanvaPageImportStatus =
  | "idle"
  | "waiting"
  | "exporting"
  | "processing"
  | "saving"
  | "ready"
  | "error";

export type CanvaImportProgressEvent =
  | { type: "started"; total: number; pages?: number[] }
  | {
      type: "page-progress";
      page: number;
      status: Exclude<CanvaPageImportStatus, "idle">;
      exported?: boolean;
      skipped?: boolean;
      error?: string;
    }
  | { type: "finalizing" }
  | { type: "complete"; result: CanvaImportResult }
  | { type: "error"; error: string; code?: string };

export type CanvaImportResult = {
  assets: CanvaImportedAsset[];
  skippedCount: number;
  revision: number;
  failedPages?: Array<{ page: number; error: string }>;
};

type JsonInit = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

const fetchCanvaJson = async <T>(path: string, init: JsonInit = {}): Promise<T> => {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    init.timeoutMs ?? 20000,
  );
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const { timeoutMs: _timeoutMs, body, ...requestOptions } = init;
    return await apiFetch<T>(path.replace(/^\//, ""), {
      ...requestOptions,
      body: body ? JSON.stringify(body) : undefined,
      headers: Object.fromEntries(headers.entries()),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
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
  fetchCanvaJson<CanvaStatus>(`${base(churchId)}/status`);

export const startCanvaConnect = (
  churchId: string,
  options: { returnTo?: string; desktop?: boolean } = {},
) =>
  fetchCanvaJson<CanvaConnectResponse>(`${base(churchId)}/connect-url`, {
    method: "POST",
    body: options,
  });

export const getCanvaConnectStatus = (
  churchId: string,
  request: { connectRequestId: string; connectRequestSecret: string },
) =>
  fetchCanvaJson<CanvaConnectStatus>(`${base(churchId)}/connect-status`, {
    method: "POST",
    body: request,
  });

export const disconnectCanva = (churchId: string) =>
  fetchCanvaJson<{ success: true }>(`${base(churchId)}/disconnect`, {
    method: "POST",
    body: {},
  });

export const listCanvaDesigns = (churchId: string, query = "") => {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  return fetchCanvaJson<{ items: CanvaDesign[]; continuation: string }>(
    `${base(churchId)}/designs${params.size ? `?${params}` : ""}`,
  );
};

export const getCanvaDesign = (churchId: string, designId: string) =>
  fetchCanvaJson<CanvaDesign>(
    `${base(churchId)}/designs/${encodeURIComponent(designId)}`,
  );

export const resolveCanvaDesignLink = (churchId: string, url: string) =>
  fetchCanvaJson<{ designId: string }>(`${base(churchId)}/resolve-design-link`, {
    method: "POST",
    body: { url },
  });

export const importCanvaDesign = async (
  churchId: string,
  request: {
    designId: string;
    pages: number[];
    format: "png" | "mp4";
    mp4ImportMode?: CanvaMp4ImportMode;
    existingImportKeys: string[];
  },
  onProgress?: (event: CanvaImportProgressEvent) => void,
  options: { signal?: AbortSignal } = {},
): Promise<CanvaImportResult> => {
  const controller = new AbortController();
  const abortExternalRequest = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortExternalRequest, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 8 * 60 * 1000);
  try {
    const response = await authenticatedApiFetch(`${base(churchId)}/imports`, {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      throw new CanvaImportError(
        payload.error || "Canva could not complete that import. Try again.",
        {
          code: payload.code || (response.status === 429 ? "CANVA_RATE_LIMITED" : undefined),
          status: response.status,
        },
      );
    }
    if (!contentType.includes("application/x-ndjson") || !response.body) {
      const result = (await response.json()) as CanvaImportResult;
      return result;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: CanvaImportResult | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as CanvaImportProgressEvent;
      if (event.type === "complete") result = event.result;
      if (event.type === "error") {
        throw new CanvaImportError(event.error, { code: event.code });
      }
      onProgress?.(event);
    };
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), {
        stream: !chunk.done,
      });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(consume);
      if (chunk.done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!result) throw new Error("Canva did not finish the import. Try again.");
    return result;
  } catch (error) {
    if (options.signal?.aborted) {
      throw new Error("Canva import cancelled.");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Canva took too long to complete the import. Try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortExternalRequest);
  }
};
