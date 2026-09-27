import type { ServicePlan } from "../../types/servicePlan";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export type RecoveredServicePlanDraft = {
  savedAt: number;
  base: ServicePlan;
  local: Pick<ServicePlan, "name" | "timezone" | "sourceImport" | "sections">;
};

const keyFor = (churchId: string, planKey: string) => `worship-sync:service-plan-draft:${encodeURIComponent(churchId)}:${encodeURIComponent(planKey)}`;

export const saveServicePlanRecoveryDraft = (churchId: string, planKey: string, value: RecoveredServicePlanDraft) => {
  try { window.sessionStorage.setItem(keyFor(churchId, planKey), JSON.stringify(value)); } catch { /* storage may be disabled */ }
};

export const readServicePlanRecoveryDraft = (churchId: string, planKey: string): RecoveredServicePlanDraft | null => {
  try {
    const key = keyFor(churchId, planKey);
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

export const clearServicePlanRecoveryDraft = (churchId: string, planKey: string) => {
  try { window.sessionStorage.removeItem(keyFor(churchId, planKey)); } catch { /* storage may be disabled */ }
};
