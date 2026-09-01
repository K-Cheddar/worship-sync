import {
  getApiBasePath,
  isPackagedElectronRenderer,
} from "../utils/environment";
import {
  getCsrfToken,
  getHumanApiToken,
  getWorkstationToken,
} from "../utils/authStorage";
import { requestAuthRecovery } from "../api/authErrorBus";
import type { ChatContextInfo, ChatMessage, ChatStreamEvent } from "./types";
import type { ChatImageUpload } from "./types";

const CHAT_REQUEST_TIMEOUT_MS = 15_000;
const CHAT_IMAGE_REQUEST_TIMEOUT_MS = 4 * 60_000;

const createChatHeaders = ({ mutation = false } = {}) => {
  const headers = new Headers();
  const workstationToken = getWorkstationToken();
  const humanApiToken = getHumanApiToken();
  if (workstationToken) headers.set("x-workstation-token", workstationToken);
  if (isPackagedElectronRenderer() && humanApiToken) {
    headers.set("Authorization", `Bearer ${humanApiToken}`);
  }
  if (mutation && getCsrfToken()) {
    headers.set("x-csrf-token", getCsrfToken());
  }
  return headers;
};

const fetchChatJson = async <T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: Record<string, unknown> } = {},
  timeoutMs = CHAT_REQUEST_TIMEOUT_MS,
  allowCsrfRecovery = true,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );
  const method = String(init.method || "GET").toUpperCase();
  const headers = createChatHeaders({ mutation: method !== "GET" });
  if (init.body) headers.set("Content-Type", "application/json");
  try {
    const response = await fetch(`${getApiBasePath()}${path}`, {
      ...init,
      credentials: "include",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok) {
      if (
        allowCsrfRecovery &&
        method !== "GET" &&
        response.status === 403 &&
        data.error === "Could not verify this request."
      ) {
        const recovered = await requestAuthRecovery();
        if (recovered) {
          return fetchChatJson(path, init, timeoutMs, false);
        }
      }
      throw new Error(data.error || "Could not reach team chat. Try again.");
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Chat took too long to respond. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const chatPath = (churchId: string) =>
  `api/churches/${encodeURIComponent(churchId)}/chat`;

export const getChatContext = (churchId: string, timeZone: string) =>
  fetchChatJson<{ context: ChatContextInfo }>(
    `${chatPath(churchId)}/context?${new URLSearchParams({ timeZone })}`,
  );

export const getChatMessages = (
  churchId: string,
  options: {
    dayKey: string;
    timeZone: string;
    limit?: number;
    before?: number;
  },
) => {
  const params = new URLSearchParams({
    dayKey: options.dayKey,
    timeZone: options.timeZone,
    limit: String(options.limit ?? 50),
  });
  if (options.before) params.set("before", String(options.before));
  return fetchChatJson<{
    context: ChatContextInfo;
    dayKey: string;
    messages: ChatMessage[];
    hasMore: boolean;
  }>(`${chatPath(churchId)}/messages?${params}`);
};

export const sendChatMessage = (
  churchId: string,
  body: {
    text: string;
    clientMessageId: string;
    timeZone: string;
    imageUpload?: ChatImageUpload;
  },
) =>
  fetchChatJson<{ message: ChatMessage }>(
    `${chatPath(churchId)}/messages`,
    {
      method: "POST",
      body,
    },
    body.imageUpload
      ? CHAT_IMAGE_REQUEST_TIMEOUT_MS
      : CHAT_REQUEST_TIMEOUT_MS,
  );

const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const validateChatImageFile = (file: File) => {
  if (!CHAT_IMAGE_CONTENT_TYPES.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size < 1) throw new Error("That image is empty. Choose another image.");
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error("Images must be 10 MB or smaller.");
  }
};

const uploadToSignedUrl = (
  url: string,
  file: File,
  contentType: string,
  onProgress?: (progress: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error("The photo upload was not accepted. Try again."));
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Could not upload the photo. Check the connection and try again.")),
    );
    xhr.addEventListener("abort", () =>
      reject(new Error("The photo upload was cancelled.")),
    );
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);
  });

export const uploadChatImage = async (
  churchId: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ChatImageUpload> => {
  validateChatImageFile(file);
  if (isPackagedElectronRenderer()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CHAT_IMAGE_REQUEST_TIMEOUT_MS,
    );
    const headers = createChatHeaders({ mutation: true });
    headers.set("Content-Type", file.type);
    try {
      onProgress?.(0);
      const response = await fetch(
        `${getApiBasePath()}${chatPath(churchId)}/images/upload-from-app?${new URLSearchParams({ fileName: file.name })}`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: file,
          signal: controller.signal,
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        imageUpload?: ChatImageUpload;
        error?: string;
      };
      if (!response.ok || !data.imageUpload) {
        throw new Error(data.error || "The photo upload was not accepted. Try again.");
      }
      onProgress?.(100);
      return data.imageUpload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("The photo upload took too long. Try again.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const intent = await fetchChatJson<{
    imageUpload: ChatImageUpload;
    uploadUrl: string;
    expiresAt: string;
  }>(`${chatPath(churchId)}/images/upload`, {
    method: "POST",
    body: {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    },
  });
  await uploadToSignedUrl(
    intent.uploadUrl,
    file,
    intent.imageUpload.contentType,
    onProgress,
  );
  return intent.imageUpload;
};

export const getChatImageUrl = (
  churchId: string,
  messageId: string,
  variant: "full" | "thumbnail",
) =>
  fetchChatJson<{ url: string; expiresAt: string }>(
    `${chatPath(churchId)}/messages/${encodeURIComponent(messageId)}/image/${variant}`,
  );

export const editChatMessage = (
  churchId: string,
  messageId: string,
  text: string,
) =>
  fetchChatJson<{ message: ChatMessage }>(
    `${chatPath(churchId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: { text } },
  );

export const removeChatMessage = (churchId: string, messageId: string) =>
  fetchChatJson<{ message: ChatMessage }>(
    `${chatPath(churchId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );

export const toggleChatReaction = (
  churchId: string,
  messageId: string,
  emoji: string,
) =>
  fetchChatJson<{ message: ChatMessage }>(
    `${chatPath(churchId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    { method: "POST", body: { emoji } },
  );

export const setChatTyping = (
  churchId: string,
  body: { isTyping: boolean; timeZone: string },
) =>
  fetchChatJson<{ typing: { active: boolean; expiresAt?: number } }>(
    `${chatPath(churchId)}/typing`,
    { method: "POST", body },
  );

const parseSseFrames = (
  chunkBuffer: string,
  onEvent: (event: ChatStreamEvent) => void,
) => {
  const frames = chunkBuffer.split(/\r?\n\r?\n/);
  const remainder = frames.pop() || "";
  frames.forEach((frame) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as ChatStreamEvent);
    } catch {
      onEvent({ type: "unknown" });
    }
  });
  return remainder;
};

export const streamChatEvents = async ({
  churchId,
  dayKey,
  signal,
  onEvent,
}: {
  churchId: string;
  dayKey: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}) => {
  const headers = createChatHeaders();
  headers.set("Accept", "text/event-stream");
  const response = await fetch(
    `${getApiBasePath()}${chatPath(churchId)}/stream?${new URLSearchParams({ dayKey })}`,
    { credentials: "include", headers, signal },
  );
  if (!response.ok || !response.body) {
    throw new Error("Live updates paused. Messages still send.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseFrames(buffer, onEvent);
  }
};
