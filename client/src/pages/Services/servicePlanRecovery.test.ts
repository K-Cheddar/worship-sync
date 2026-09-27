import { clearServicePlanRecoveryDraft, readServicePlanRecoveryDraft, saveServicePlanRecoveryDraft } from "./servicePlanRecovery";
import type { ServicePlan } from "../../types/servicePlan";

const plan = { planId: "p", churchId: "c", planKey: "k", serviceId: "s", date: "2026-09-27", name: "Service", sections: [] } as ServicePlan;

describe("service plan recovery draft", () => {
  beforeEach(() => sessionStorage.clear());

  it("recovers a draft in the same tab and isolates it by user, church, and plan", () => {
    saveServicePlanRecoveryDraft("user-1", "c", "k", { savedAt: Date.now(), base: plan, local: { name: "Local", sections: [] } });
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")?.local.name).toBe("Local");
    expect(readServicePlanRecoveryDraft("user-2", "c", "k")).toBeNull();
    expect(readServicePlanRecoveryDraft("user-1", "other-church", "k")).toBeNull();
    expect(readServicePlanRecoveryDraft("user-1", "c", "other-plan")).toBeNull();
  });

  it("does not expose an unowned legacy draft to an authenticated user", () => {
    sessionStorage.setItem(
      "worship-sync:service-plan-draft:c:k",
      JSON.stringify({ savedAt: Date.now(), base: plan, local: { name: "Legacy", sections: [] } }),
    );
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")).toBeNull();
    expect(sessionStorage.length).toBe(1);
  });

  it("expires old drafts and removes them from the temporary store", () => {
    saveServicePlanRecoveryDraft("user-1", "c", "k", { savedAt: Date.now() - 25 * 60 * 60 * 1000, base: plan, local: { name: "Old", sections: [] } });
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")).toBeNull();
    clearServicePlanRecoveryDraft("user-1", "c", "k");
    expect(sessionStorage.length).toBe(0);
  });
});
