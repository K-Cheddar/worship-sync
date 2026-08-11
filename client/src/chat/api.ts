import {
  getApiBasePath,
  isPackagedElectronRenderer,
} from "../utils/environment";
import {
  getCsrfToken,
  getHumanApiToken,
  getWorkstationToken,
} from "../utils/authStorage";
import type { ChatContextInfo, ChatMessage, ChatStreamEvent } from "./types";

const CHAT_REQUEST_TIMEOUT_MS = 15_000;

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
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CHAT_REQUEST_TIMEOUT_MS,
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
      throw new Error(data.error || "Chat is unavailable. Try again.");
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
  body: { text: string; clientMessageId: string; timeZone: string },
) =>
  fetchChatJson<{ message: ChatMessage }>(`${chatPath(churchId)}/messages`, {
    method: "POST",
    body,
  });

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
    throw new Error("Live chat updates are unavailable.");
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
