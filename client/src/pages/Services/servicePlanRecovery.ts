import type { ServicePlan } from "../../types/servicePlan";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const RECOVERY_WRITE_DELAY_MS = 200;
export type RecoveredServicePlanDraft = {
  savedAt: number;
  base: ServicePlan;
  local: Pick<ServicePlan, "name" | "timezone" | "sourceImport" | "sections">;
};

const keyFor = (userId: string, churchId: string, planKey: string) =>
  `worship-sync:service-plan-draft:${encodeURIComponent(userId)}:${encodeURIComponent(churchId)}:${encodeURIComponent(planKey)}`;

const pendingWrites = new Map<string, RecoveredServicePlanDraft>();
let writeTimer: number | null = null;

export const flushServicePlanRecoveryDraftWrites = () => {
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  writeTimer = null;
  for (const [key, value] of pendingWrites) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be disabled */ }
  }
  pendingWrites.clear();
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushServicePlanRecoveryDraftWrites);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushServicePlanRecoveryDraftWrites();
  });
}

export const saveServicePlanRecoveryDraft = (userId: string, churchId: string, planKey: string, value: RecoveredServicePlanDraft) => {
  if (!userId || !churchId || !planKey) return;
  pendingWrites.set(keyFor(userId, churchId, planKey), value);
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(flushServicePlanRecoveryDraftWrites, RECOVERY_WRITE_DELAY_MS);
};

export const readServicePlanRecoveryDraft = (userId: string, churchId: string, planKey: string): RecoveredServicePlanDraft | null => {
  if (!userId || !churchId || !planKey) return null;
  try {
    const key = keyFor(userId, churchId, planKey);
    flushServicePlanRecoveryDraftWrites();
    const raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as RecoveredServicePlanDraft;
    if (!value.savedAt || Date.now() - value.savedAt > DRAFT_TTL_MS || !value.base || !value.local?.sections) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (!window.localStorage.getItem(key)) {
      window.localStorage.setItem(key, raw);
      window.sessionStorage.removeItem(key);
    }
    return value;
  } catch { return null; }
};

export const clearServicePlanRecoveryDraft = (userId: string, churchId: string, planKey: string) => {
  if (!userId || !churchId || !planKey) return;
  const key = keyFor(userId, churchId, planKey);
  pendingWrites.delete(key);
  if (pendingWrites.size === 0 && writeTimer !== null) {
    window.clearTimeout(writeTimer);
    writeTimer = null;
  }
  try { window.localStorage.removeItem(key); } catch { /* storage may be disabled */ }
};
