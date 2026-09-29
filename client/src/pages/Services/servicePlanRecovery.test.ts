import { clearServicePlanRecoveryDraft, flushServicePlanRecoveryDraftWrites, readServicePlanRecoveryDraft, saveServicePlanRecoveryDraft } from "./servicePlanRecovery";
import type { ServicePlan } from "../../types/servicePlan";

const plan = { planId: "p", churchId: "c", planKey: "k", serviceId: "s", date: "2026-09-27", name: "Service", sections: [] } as ServicePlan;

describe("service plan recovery draft", () => {
  beforeEach(() => {
    flushServicePlanRecoveryDraftWrites();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("recovers a draft in the same tab and isolates it by user, church, and plan", () => {
    saveServicePlanRecoveryDraft("user-1", "c", "k", { savedAt: Date.now(), base: plan, local: { name: "Local", sections: [] } });
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")?.local.name).toBe("Local");
    expect(readServicePlanRecoveryDraft("user-2", "c", "k")).toBeNull();
    expect(readServicePlanRecoveryDraft("user-1", "other-church", "k")).toBeNull();
    expect(readServicePlanRecoveryDraft("user-1", "c", "other-plan")).toBeNull();
  });

  it("does not expose an unowned legacy draft to an authenticated user", () => {
    localStorage.setItem(
      "worship-sync:service-plan-draft:c:k",
      JSON.stringify({ savedAt: Date.now(), base: plan, local: { name: "Legacy", sections: [] } }),
    );
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")).toBeNull();
    expect(localStorage.length).toBe(1);
  });

  it("restores a durable draft after reload and migrates a matching tab draft", () => {
    const draft = { savedAt: Date.now(), base: plan, local: { name: "Recovered", sections: [] } };
    const key = "worship-sync:service-plan-draft:user-1:c:k";
    sessionStorage.setItem(key, JSON.stringify(draft));

    expect(readServicePlanRecoveryDraft("user-1", "c", "k")?.local.name).toBe("Recovered");
    expect(localStorage.getItem(key)).toBe(JSON.stringify(draft));
    expect(sessionStorage.getItem(key)).toBeNull();
    sessionStorage.clear();
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")?.local.name).toBe("Recovered");
  });

  it("expires old drafts and removes them from the temporary store", () => {
    saveServicePlanRecoveryDraft("user-1", "c", "k", { savedAt: Date.now() - 25 * 60 * 60 * 1000, base: plan, local: { name: "Old", sections: [] } });
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")).toBeNull();
    clearServicePlanRecoveryDraft("user-1", "c", "k");
    expect(localStorage.length).toBe(0);
  });

  it("coalesces rapid edits and flushes the latest draft when a tab is interrupted", () => {
    jest.useFakeTimers();
    const first = { savedAt: Date.now(), base: plan, local: { name: "First", sections: [] } };
    const latest = { ...first, local: { name: "Latest", sections: [] } };
    saveServicePlanRecoveryDraft("user-1", "c", "k", first);
    saveServicePlanRecoveryDraft("user-1", "c", "k", latest);

    expect(localStorage.length).toBe(0);
    window.dispatchEvent(new Event("pagehide"));
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")?.local.name).toBe("Latest");

    clearServicePlanRecoveryDraft("user-1", "c", "k");
    expect(readServicePlanRecoveryDraft("user-1", "c", "k")).toBeNull();
    jest.useRealTimers();
  });
});
