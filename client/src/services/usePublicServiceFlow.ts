import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPublicServiceFlow,
  getPublicServiceFlowStreamUrl,
  PublicServiceAccessRevokedError,
} from "./serviceFlowApi";
import type { PublicServiceFlowSnapshot } from "./serviceFlowTypes";

export type PublicServiceConnection = "connecting" | "connected" | "reconnecting" | "failed";

const FALLBACK_REFRESH_MS = 60_000;
const FOCUS_REFRESH_MIN_MS = 30_000;

export const usePublicServiceFlow = (shareId: string) => {
  const [snapshot, setSnapshot] = useState<PublicServiceFlowSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<PublicServiceConnection>("connecting");
  /** The link itself stopped working — show "no longer available", not stale content. */
  const [revoked, setRevoked] = useState(false);
  const lastFocusRefreshRef = useRef(0);
  const requestIdRef = useRef(0);
  const snapshotRef = useRef<PublicServiceFlowSnapshot | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refresh = useCallback(async (initial = false) => {
    if (!shareId) {
      setError("This service link is incomplete.");
      setLoading(false);
      setConnection("failed");
      return;
    }
    const requestId = ++requestIdRef.current;
    if (initial) setLoading(true);
    try {
      const next = await getPublicServiceFlow(shareId);
      if (requestId !== requestIdRef.current) return;
      setSnapshot(next);
      setError("");
      setRevoked(false);
      setConnection("connected");
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load this service.");
      if (loadError instanceof PublicServiceAccessRevokedError) {
        // The link no longer grants access (unpublished, deleted, or revoked).
        // Drop what we already rendered — keeping a stale snapshot would leave
        // team notes and assignments visible in tabs that are already open.
        setSnapshot(null);
        setRevoked(true);
        setConnection("failed");
        return;
      }
      setConnection(snapshotRef.current ? "reconnecting" : "failed");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [shareId]);

  useEffect(() => {
    setSnapshot(null);
    setError("");
    setRevoked(false);
    setLoading(true);
    setConnection("connecting");
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!shareId || typeof EventSource === "undefined") return;
    // A revoked link's stream 404s too, and EventSource retries every few
    // seconds — stop it. The slower fallback poll still lets the page recover
    // if the plan is published again.
    if (revoked) return;
    const source = new EventSource(getPublicServiceFlowStreamUrl(shareId));
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        if (payload.type === "service-updated") void refresh();
        if (payload.type === "connected") setConnection("connected");
      } catch {
        // Native EventSource retries malformed or interrupted updates naturally.
      }
    };
    source.onerror = () => setConnection((current) => current === "failed" ? current : "reconnecting");
    return () => source.close();
  }, [refresh, shareId, revoked]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, FALLBACK_REFRESH_MS);
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_MIN_MS) return;
      lastFocusRefreshRef.current = now;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { snapshot, error, loading, connection, revoked, refresh };
};
