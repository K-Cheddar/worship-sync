import { clearServicePlanRecoveryDraft, readServicePlanRecoveryDraft, saveServicePlanRecoveryDraft } from "./servicePlanRecovery";
import type { ServicePlan } from "../../types/servicePlan";

const plan = { planId: "p", churchId: "c", planKey: "k", serviceId: "s", date: "2026-09-27", name: "Service", sections: [] } as ServicePlan;

describe("service plan recovery draft", () => {
  beforeEach(() => sessionStorage.clear());

  it("recovers a draft after a reload within the same tab and isolates plan keys", () => {
    saveServicePlanRecoveryDraft("c", "k", { savedAt: Date.now(), base: plan, local: { name: "Local", sections: [] } });
    expect(readServicePlanRecoveryDraft("c", "k")?.local.name).toBe("Local");
    expect(readServicePlanRecoveryDraft("c", "other")).toBeNull();
  });

  it("expires old drafts and removes them from the temporary store", () => {
    saveServicePlanRecoveryDraft("c", "k", { savedAt: Date.now() - 25 * 60 * 60 * 1000, base: plan, local: { name: "Old", sections: [] } });
    expect(readServicePlanRecoveryDraft("c", "k")).toBeNull();
    clearServicePlanRecoveryDraft("c", "k");
    expect(sessionStorage.length).toBe(0);
  });
});
