import { useEffect, useState } from "react";
import type { DBBoardAlias, DBBoardPost } from "../types";
import type { BoardSyncChange } from "./BoardSyncContext";
import { useBoardSync } from "./BoardSyncContext";
import { getAliasDocId, sortBoardPostsAscending } from "./boardUtils";
import { debugBoardSync } from "./boardSyncDebug";
import { getLocalBoardPosts } from "./boardSyncData";

export type UseSyncedBoardPostsOptions = {
  /** An archived board id may be selected by an authenticated moderator. */
  boardId?: string;
};

const getPostBoardId = (changeId: string): string | null => {
  if (!changeId.startsWith("post:")) return null;
  const remainder = changeId.slice("post:".length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0) return null;
  return remainder.slice(0, separatorIndex);
};

const resolveBoardId = (
  alias: DBBoardAlias,
  requestedBoardId: string | undefined,
): string => {
  const boardIds = new Set([alias.currentBoardId, ...alias.history]);
  return requestedBoardId && boardIds.has(requestedBoardId)
    ? requestedBoardId
    : alias.currentBoardId;
};

const applyPostChange = (
  posts: DBBoardPost[],
  change: BoardSyncChange,
  boardId: string,
): DBBoardPost[] => {
  if (typeof change.id !== "string") return posts;

  if (change.deleted) {
    return posts.filter((post) => post._id !== change.id);
  }

  if (!change.doc || typeof change.doc !== "object") return posts;
  const updated = change.doc as Partial<DBBoardPost>;
  if (updated.type !== "post" || updated.boardId !== boardId) return posts;

  const post = updated as DBBoardPost;
  return sortBoardPostsAscending([
    ...posts.filter((current) => current._id !== change.id),
    post,
  ]);
};

export const useSyncedBoardPosts = (
  aliasId: string,
  { boardId: requestedBoardId }: UseSyncedBoardPostsOptions = {},
) => {
  const sync = useBoardSync();
  const db = sync?.db;
  const subscribeToChanges = sync?.subscribeToChanges;
  const [alias, setAlias] = useState<DBBoardAlias | null>(null);
  const [posts, setPosts] = useState<DBBoardPost[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const state = {
      aliasChangeVersion: 0,
      currentBoardId: "",
      boardVersion: 0,
      loadVersion: 0,
      initialLoadComplete: false,
    };
    const pendingPostChanges = new Map<string, BoardSyncChange>();

    setAlias(null);
    setPosts([]);
    setHasLoadedOnce(false);
    setError("");

    const isCurrent = () => active && Boolean(db) && Boolean(aliasId);

    const applyPendingChanges = (
      initialPosts: DBBoardPost[],
      targetBoardId: string,
    ): DBBoardPost[] => {
      let nextPosts = initialPosts;
      for (const change of pendingPostChanges.values()) {
        if (getPostBoardId(change.id ?? "") === targetBoardId) {
          nextPosts = applyPostChange(nextPosts, change, targetBoardId);
        }
      }
      for (const [changeId, change] of pendingPostChanges) {
        if (getPostBoardId(change.id ?? "") === targetBoardId) {
          pendingPostChanges.delete(changeId);
        }
      }
      return nextPosts;
    };

    const loadPostsForBoard = async (
      targetBoardId: string,
      targetBoardVersion: number,
    ): Promise<void> => {
      const loadVersion = ++state.loadVersion;
      try {
        const nextPosts = await getLocalBoardPosts(db!, targetBoardId);
        if (
          !isCurrent() ||
          state.boardVersion !== targetBoardVersion ||
          state.currentBoardId !== targetBoardId ||
          state.loadVersion !== loadVersion
        ) {
          return;
        }

        setPosts(applyPendingChanges(nextPosts, targetBoardId));
        state.initialLoadComplete = true;
        setHasLoadedOnce(true);
        setError("");
      } catch (nextError) {
        if (
          !isCurrent() ||
          state.boardVersion !== targetBoardVersion ||
          state.loadVersion !== loadVersion
        ) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Could not load discussion board.",
        );
      }
    };

    const handleChange = (change: BoardSyncChange) => {
      if (!isCurrent() || typeof change.id !== "string") return;

      if (change.id === getAliasDocId(aliasId)) {
        if (change.deleted || !change.doc || typeof change.doc !== "object") {
          state.aliasChangeVersion += 1;
          state.boardVersion += 1;
          state.currentBoardId = "";
          state.initialLoadComplete = true;
          setAlias(null);
          setPosts([]);
          setHasLoadedOnce(true);
          return;
        }

        const updatedAlias = change.doc as DBBoardAlias;
        if (updatedAlias.type !== "alias" || updatedAlias.aliasId !== aliasId) {
          return;
        }

        const nextBoardId = resolveBoardId(updatedAlias, requestedBoardId);
        const boardChanged = state.currentBoardId !== nextBoardId;
        state.aliasChangeVersion += 1;
        state.boardVersion += 1;
        state.currentBoardId = nextBoardId;
        setAlias(updatedAlias);

        if (boardChanged) {
          state.initialLoadComplete = false;
          setPosts([]);
          setHasLoadedOnce(false);
          void loadPostsForBoard(nextBoardId, state.boardVersion);
        }
        return;
      }

      const changedBoardId = getPostBoardId(change.id);
      if (!changedBoardId) return;
      if (state.currentBoardId && changedBoardId !== state.currentBoardId) {
        return;
      }
      debugBoardSync("local-post-change-observed", {
        aliasId,
        changedBoardId,
        activeBoardId: state.currentBoardId,
        postId: change.id,
        deleted: Boolean(change.deleted),
      });

      if (!state.initialLoadComplete) {
        pendingPostChanges.set(change.id, change);
        return;
      }

      const changeBoardVersion = state.boardVersion;
      setPosts((currentPosts) =>
        state.boardVersion === changeBoardVersion &&
        state.currentBoardId === changedBoardId
          ? applyPostChange(currentPosts, change, changedBoardId)
          : currentPosts,
      );
    };

    const unsubscribe = subscribeToChanges?.(handleChange);

    if (!db || !aliasId) {
      return () => {
        active = false;
        unsubscribe?.();
      };
    }

    const initialAliasChangeVersion = state.aliasChangeVersion;
    void (async () => {
      try {
        const localAlias = (await db.get(
          getAliasDocId(aliasId),
        )) as DBBoardAlias;
        if (!isCurrent()) return;

        if (state.aliasChangeVersion === initialAliasChangeVersion) {
          state.currentBoardId = resolveBoardId(localAlias, requestedBoardId);
          state.boardVersion += 1;
          setAlias(localAlias);
        }

        if (!state.currentBoardId) return;
        const targetBoardId = state.currentBoardId;
        const targetBoardVersion = state.boardVersion;
        await loadPostsForBoard(targetBoardId, targetBoardVersion);

        if (
          isCurrent() &&
          (state.currentBoardId !== targetBoardId ||
            state.boardVersion !== targetBoardVersion)
        ) {
          await loadPostsForBoard(state.currentBoardId, state.boardVersion);
        }
      } catch (nextError) {
        if (!isCurrent()) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Could not load discussion board.",
        );
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [aliasId, db, requestedBoardId, subscribeToChanges]);

  return {
    alias,
    posts,
    hasLoadedOnce,
    error,
    connectionStatus: sync?.connectionStatus ?? {
      status: "connecting" as const,
      retryCount: 0,
    },
    retryNow: sync?.retryNow ?? (() => undefined),
  };
};
