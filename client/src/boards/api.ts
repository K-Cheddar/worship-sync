import { getApiBasePath } from "../utils/environment";
import { DBBoard, DBBoardAlias, DBBoardPost } from "../types";
import { getWorkstationToken } from "../utils/authStorage";

type JsonRequestInit = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown> | string;
};

const BOARD_REQUEST_TIMEOUT_MS = 15000;

export const createBoardRequestHeaders = (initHeaders?: HeadersInit) => {
  const headers = new Headers(initHeaders ?? {});
  const workstationToken = getWorkstationToken();
  if (workstationToken) {
    headers.set("x-workstation-token", workstationToken);
  }
  return headers;
};

export type BoardAliasResponse = {
  alias: DBBoardAlias;
  board: DBBoard;
};

export type BoardPostsResponse = {
  aliasId: string;
  boardId: string;
  posts: DBBoardPost[];
};

const fetchJson = async <T>(
  path: string,
  init?: JsonRequestInit,
): Promise<T> => {
  const headers = createBoardRequestHeaders(init?.headers);
  let body = init?.body as BodyInit | undefined;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    BOARD_REQUEST_TIMEOUT_MS,
  );

  if (init?.body && typeof init.body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }

  let response: Response;

  try {
    response = await fetch(`${getApiBasePath()}${path}`, {
      ...init,
      credentials: "include",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TypeError")
    ) {
      throw new Error("Could not connect. Check the server and try again.");
    }
    throw error;
  }

  clearTimeout(timeoutId);

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Request failed.",
    );
  }

  return data as T;
};

export const getBoardAlias = (aliasId: string) =>
  fetchJson<BoardAliasResponse>(`api/boards/${encodeURIComponent(aliasId)}`);

export const getBoardPosts = (
  aliasId: string,
  options: {
    boardId?: string;
    includeHidden?: boolean;
    viewerAuthorId?: string;
  } = {},
) => {
  const params = new URLSearchParams();
  if (options.boardId) params.set("boardId", options.boardId);
  if (options.includeHidden) params.set("includeHidden", "true");
  if (options.viewerAuthorId) {
    params.set("viewerAuthorId", options.viewerAuthorId);
  }
  const suffix = params.toString();
  return fetchJson<BoardPostsResponse>(
    `api/boards/${encodeURIComponent(aliasId)}/posts${suffix ? `?${suffix}` : ""}`,
  );
};

export const createBoardPost = (
  aliasId: string,
  payload: { author: string; authorId: string; text: string },
) =>
  fetchJson<{ post: DBBoardPost }>(
    `api/boards/${encodeURIComponent(aliasId)}/posts`,
    {
      method: "POST",
      body: payload,
    },
  );

export const createBoardAlias = (payload: {
  aliasId: string;
  title: string;
  database: string;
}) =>
  fetchJson<BoardAliasResponse>("api/boards/admin/aliases", {
    method: "POST",
    body: payload,
  });

export const softResetBoardAlias = (aliasId: string) =>
  fetchJson<{ deletedCount: number }>(
    `api/boards/admin/aliases/${encodeURIComponent(aliasId)}/soft-reset`,
    { method: "POST" },
  );

export const hardResetBoardAlias = (aliasId: string) =>
  fetchJson<BoardAliasResponse>(
    `api/boards/admin/aliases/${encodeURIComponent(aliasId)}/hard-reset`,
    { method: "POST" },
  );

export const updateBoardAliasTitle = (aliasId: string, title: string) =>
  fetchJson<{ alias: DBBoardAlias }>(
    `api/boards/admin/aliases/${encodeURIComponent(aliasId)}/title`,
    {
      method: "POST",
      body: { title },
    },
  );

export const deleteBoardAlias = (aliasId: string) =>
  fetchJson<{ deletedAliasId: string }>(
    `api/boards/admin/aliases/${encodeURIComponent(aliasId)}`,
    {
      method: "DELETE",
    },
  );

export const updateBoardPresentationFontScale = (
  aliasId: string,
  value: number,
) =>
  fetchJson<{ alias: DBBoardAlias }>(
    `api/boards/admin/aliases/${encodeURIComponent(aliasId)}/presentation-font-scale`,
    {
      method: "POST",
      body: { value },
    },
  );

const updateBoardPostFlag = (
  postId: string,
  field: "hidden" | "highlighted",
  value?: boolean,
) =>
  fetchJson<{ post: DBBoardPost }>(
    `api/boards/admin/posts/${encodeURIComponent(postId)}/${field}`,
    {
      method: "POST",
      body: value === undefined ? {} : { value },
    },
  );

export const updateBoardPostHidden = (postId: string, value?: boolean) =>
  updateBoardPostFlag(postId, "hidden", value);

export const updateBoardPostHighlighted = (postId: string, value?: boolean) =>
  updateBoardPostFlag(postId, "highlighted", value);
