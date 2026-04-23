import { useEffect, useRef } from "react";
import { get, ref } from "firebase/database";
import { getSharedDataAuth, getSharedDataDatabase } from "../firebase/apps";
import { signInWithCustomToken } from "firebase/auth";

export function useRealtimeDatabaseHealthCheck({
  intervalMs = 30000, // how often to check
  timeoutMs = 5000, // how long before a ping is considered dead
  onReconnect, // callback to reattach listeners
}: {
  intervalMs?: number;
  timeoutMs?: number;
  onReconnect: () => void;
}) {
  const isChecking = useRef(false);
  const lastHealthy = useRef(Date.now());

  useEffect(() => {
    const db = getSharedDataDatabase();
    const auth = getSharedDataAuth();

    if (!db || !auth) return;

    const pingRef = ref(db, "/health/ping");

    const checkConnection = async () => {
      if (isChecking.current) return;
      isChecking.current = true;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const ping = get(pingRef);

        await Promise.race([
          ping,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs),
          ),
        ]);
        lastHealthy.current = Date.now();
      } catch {
        const timeSinceHealthy = Date.now() - lastHealthy.current;

        // If we haven't been healthy for > interval, assume zombie connection
        if (timeSinceHealthy > intervalMs) {
          console.warn("[RTDB Health] Connection stale. Reconnecting…");

          try {
            // Force refresh token
            await auth.currentUser?.getIdToken(true);

            // Force re-auth
            const token = await auth.currentUser?.getIdToken();
            if (token) {
              await signInWithCustomToken(auth, token);
            }

            // Reattach listeners
            onReconnect();
          } catch (err) {
            console.error("[RTDB Health] Reconnect failed:", err);
          }
        }
      } finally {
        clearTimeout(timeout);
        isChecking.current = false;
      }
    };

    const id = setInterval(checkConnection, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, timeoutMs, onReconnect]);
}
