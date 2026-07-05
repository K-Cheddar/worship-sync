import { useEffect, useRef, useState } from "react";
import { MAX_INITIAL_SESSION_RETRIES } from "../constants";
import { getBoardAliases } from "./api";
import { useStoredBoardDisplayAlias } from "./useStoredBoardDisplayAlias";

type UseResolvedBoardDisplayAliasOptions = {
  /**
   * Skip the board fetch (e.g. for viewers/guests who can't open a board, or a
   * surface that isn't currently showing board controls). While disabled the
   * resolver just trusts the stored id. Defaults to true.
   */
  enabled?: boolean;
};

/**
 * Resolve which discussion board this device should target for display.
 *
 * The device-local stored alias (localStorage, kept in step across tabs by
 * {@link useStoredBoardDisplayAlias}) is only written when the operator
 * explicitly opens a board, so a device that has never done so has none — even
 * when the church has boards. This fetches the church's boards and resolves a
 * default so any operator surface (menu, transmit panel) can offer the board
 * without a prior open: the remembered board if it still exists, otherwise the
 * first one.
 *
 * Resolution is pure — it never writes storage. Persisting stays the caller's
 * job at the moment of an explicit open/enable, so resolving on mount can never
 * silently re-point an already-open board display.
 */
export const useResolvedBoardDisplayAlias = ({
  enabled = true,
}: UseResolvedBoardDisplayAliasOptions = {}): string => {
  const storedBoardAliasId = useStoredBoardDisplayAlias();
  const [boardAliases, setBoardAliases] = useState<
    { aliasId: string }[] | null
  >(null);
  const boardAliasesLoadedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const { aliases } = await getBoardAliases();
        if (cancelled) return;
        attempt = 0;
        boardAliasesLoadedRef.current = true;
        setBoardAliases(aliases);
      } catch (error) {
        if (cancelled) return;
        // Transient failures (flaky booth network) shouldn't permanently wedge
        // the resolver; retry with backoff. A known-good stored alias stays
        // usable meanwhile because resolution falls back to it until we load.
        console.error("Could not load discussion boards:", error);
        if (attempt >= MAX_INITIAL_SESSION_RETRIES) return;
        const delay = Math.min(30000, 5000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(() => void load(), delay);
      }
    };

    const handleFocus = () => {
      // If we never managed to learn the church's boards, try again when the
      // operator returns to the window (covers exhausted retries).
      if (boardAliasesLoadedRef.current) return;
      attempt = 0;
      if (retryTimer) clearTimeout(retryTimer);
      void load();
    };

    void load();
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled]);

  // Until the church's boards have loaded, trust the stored id (it was validated
  // when written). Once loaded, keep it only if it still exists, else fall back
  // to the first board. Empty means there is nothing to show.
  return boardAliases === null
    ? storedBoardAliasId
    : storedBoardAliasId &&
        boardAliases.some((alias) => alias.aliasId === storedBoardAliasId)
      ? storedBoardAliasId
      : boardAliases[0]?.aliasId ?? "";
};
