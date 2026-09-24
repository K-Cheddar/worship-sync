import { useCallback, useEffect, useState } from "react";
import { getChurchStorageQuota } from "../../api/auth";
import type { ChurchStorageQuotaUsage } from "../../api/authTypes";

type QuotaState =
  | { churchId: string; retryKey: number; status: "loading" }
  | { churchId: string; retryKey: number; status: "error" }
  | { churchId: string; retryKey: number; status: "ready"; quotas: ChurchStorageQuotaUsage };

const inFlightRequests = new Map<string, Promise<ChurchStorageQuotaUsage>>();

const loadChurchStorageQuota = (churchId: string, force = false) => {
  const existing = inFlightRequests.get(churchId);
  if (existing && !force) return existing;
  const request = getChurchStorageQuota(churchId).then(({ quotas }) => quotas);
  inFlightRequests.set(churchId, request);
  void request.finally(() => {
    if (inFlightRequests.get(churchId) === request) inFlightRequests.delete(churchId);
  }).catch(() => undefined);
  return request;
};

export function useChurchStorageQuota(churchId: string | undefined, enabled = true) {
  const [state, setState] = useState<QuotaState | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!enabled || !churchId) return;
    let active = true;
    setState({ churchId, retryKey, status: "loading" });
    void loadChurchStorageQuota(churchId, retryKey > 0)
      .then((quotas) => {
        if (active) setState({ churchId, retryKey, status: "ready", quotas });
      })
      .catch(() => {
        if (active) setState({ churchId, retryKey, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [churchId, enabled, retryKey]);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);
  const matchingState = churchId && state?.churchId === churchId && state.retryKey === retryKey ? state : null;
  return {
    status: !enabled || !churchId ? "loading" as const : matchingState?.status || "loading" as const,
    quotas: matchingState?.status === "ready" ? matchingState.quotas : undefined,
    refresh: retry,
  };
}
