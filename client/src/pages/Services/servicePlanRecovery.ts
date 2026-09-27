import type { ServicePlan } from "../../types/servicePlan";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export type RecoveredServicePlanDraft = {
  savedAt: number;
  base: ServicePlan;
  local: Pick<ServicePlan, "name" | "timezone" | "sourceImport" | "sections">;
};

const keyFor = (userId: string, churchId: string, planKey: string) =>
  `worship-sync:service-plan-draft:${encodeURIComponent(userId)}:${encodeURIComponent(churchId)}:${encodeURIComponent(planKey)}`;

export const saveServicePlanRecoveryDraft = (userId: string, churchId: string, planKey: string, value: RecoveredServicePlanDraft) => {
  if (!userId || !churchId || !planKey) return;
  try { window.sessionStorage.setItem(keyFor(userId, churchId, planKey), JSON.stringify(value)); } catch { /* storage may be disabled */ }
};

export const readServicePlanRecoveryDraft = (userId: string, churchId: string, planKey: string): RecoveredServicePlanDraft | null => {
  if (!userId || !churchId || !planKey) return null;
  try {
    const key = keyFor(userId, churchId, planKey);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as RecoveredServicePlanDraft;
    if (!value.savedAt || Date.now() - value.savedAt > DRAFT_TTL_MS || !value.base || !value.local?.sections) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch { return null; }
};

export const clearServicePlanRecoveryDraft = (userId: string, churchId: string, planKey: string) => {
  if (!userId || !churchId || !planKey) return;
  try { window.sessionStorage.removeItem(keyFor(userId, churchId, planKey)); } catch { /* storage may be disabled */ }
};
