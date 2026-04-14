import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_INITIAL_SESSION_RETRIES } from "../constants";
import { DBBoardAlias, DBBoardPost } from "../types";
import { getBoardAlias, getBoardPosts } from "./api";

export type BoardConnectionStatus = {
  status: "connecting" | "retrying" | "failed" | "connected";
  retryCount: number;
};

const getRetryDelay = (attempt: number) => Math.min(30000, 5000 * 2 ** attempt);

type UseBoardDataOptions = {
  includeHidden?: boolean;
  viewerAuthorId?: string;
};

export const useBoardData = (
  aliasId: string,
  options: UseBoardDataOptions = {},
) => {
  const { includeHidden = false, viewerAuthorId } = options;
  const [alias, setAlias] = useState<DBBoardAlias | null>(null);
  const [churchLogoUrl, setChurchLogoUrl] = useState("");
  const [posts, setPosts] = useState<DBBoardPost[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<BoardConnectionStatus>({
      status: "connecting",
      retryCount: 0,
    });

  const isMountedRef = useRef(true);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const requestIdRef = useRef(0);
  const aliasRef = useRef<DBBoardAlias | null>(null);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const runLoad = useCallback(
    async ({
      includeAlias,
      boardId,
    }: {
      includeAlias: boolean;
      boardId?: string;
    }) => {
      if (!aliasId) return;

      clearRetryTimeout();
      const requestId = ++requestIdRef.current;

      try {
        if (!hasLoadedOnceRef.current) {
          setConnectionStatus({
            status: retryCountRef.current > 0 ? "retrying" : "connecting",
            retryCount: retryCountRef.current,
          });
        }

        if (includeAlias) {
          const [aliasResponse, postsResponse] = await Promise.all([
            getBoardAlias(aliasId),
            getBoardPosts(aliasId, { includeHidden, viewerAuthorId }),
          ]);

          if (!isMountedRef.current || requestId !== requestIdRef.current) {
            return;
          }

          aliasRef.current = aliasResponse.alias;
          setAlias(aliasResponse.alias);
          setChurchLogoUrl(
            typeof aliasResponse.churchLogoUrl === "string"
              ? aliasResponse.churchLogoUrl.trim()
              : "",
          );
          setPosts(postsResponse.posts);
        } else {
          const currentAlias = aliasRef.current;
          const resolvedBoardId = boardId || currentAlias?.currentBoardId;

          if (!currentAlias || !resolvedBoardId) {
            await runLoad({ includeAlias: true });
            return;
          }

          const postsResponse = await getBoardPosts(aliasId, {
            includeHidden,
            boardId: resolvedBoardId,
            viewerAuthorId,
          });

          if (!isMountedRef.current || requestId !== requestIdRef.current) {
            return;
          }

          setPosts(postsResponse.posts);
        }

        retryCountRef.current = 0;
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
        setError("");
        setConnectionStatus({ status: "connected", retryCount: 0 });
      } catch (nextError) {
        if (!isMountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        const nextMessage =
          nextError instanceof Error
            ? nextError.message
            : "Could not load discussion board.";

        setError(nextMessage);

        const nextRetryCount = retryCountRef.current + 1;
        retryCountRef.current = nextRetryCount;

        if (nextRetryCount > MAX_INITIAL_SESSION_RETRIES) {
          setConnectionStatus({
            status: "failed",
            retryCount: MAX_INITIAL_SESSION_RETRIES,
          });
          return;
        }

        setConnectionStatus({
          status: "retrying",
          retryCount: nextRetryCount,
        });

        retryTimeoutRef.current = setTimeout(() => {
          void runLoad({ includeAlias, boardId });
        }, getRetryDelay(nextRetryCount));
      }
    },
    [aliasId, clearRetryTimeout, includeHidden, viewerAuthorId],
  );

  const loadBoard = useCallback(async () => {
    await runLoad({ includeAlias: true });
  }, [runLoad]);

  const loadPosts = useCallback(async () => {
    await runLoad({
      includeAlias: false,
      boardId: aliasRef.current?.currentBoardId,
    });
  }, [runLoad]);

  const retryNow = useCallback(() => {
    clearRetryTimeout();
    retryCountRef.current = 0;
    setError("");
    setConnectionStatus({ status: "connecting", retryCount: 0 });
    void loadBoard();
  }, [clearRetryTimeout, loadBoard]);

  const updateAlias = useCallback(
    (
      updater:
        | Partial<DBBoardAlias>
        | ((current: DBBoardAlias | null) => DBBoardAlias | null),
    ) => {
      setAlias((currentAlias) => {
        if (typeof updater === "function") {
          const nextAlias = updater(currentAlias);
          aliasRef.current = nextAlias;
          return nextAlias;
        }

        if (!currentAlias) {
          return currentAlias;
        }

        const nextAlias = {
          ...currentAlias,
          ...updater,
        };
        aliasRef.current = nextAlias;
        return nextAlias;
      });
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearRetryTimeout();
    };
  }, [clearRetryTimeout]);

  useEffect(() => {
    clearRetryTimeout();
    retryCountRef.current = 0;
    hasLoadedOnceRef.current = false;
    requestIdRef.current = 0;
    aliasRef.current = null;
    setAlias(null);
    setChurchLogoUrl("");
    setPosts([]);
    setHasLoadedOnce(false);
    setError("");
    setConnectionStatus({ status: "connecting", retryCount: 0 });

    if (aliasId) {
      void loadBoard();
    }
  }, [aliasId, clearRetryTimeout, loadBoard]);

  return {
    alias,
    churchLogoUrl,
    posts,
    hasLoadedOnce,
    error,
    connectionStatus,
    loadBoard,
    loadPosts,
    retryNow,
    updateAlias,
  };
};
