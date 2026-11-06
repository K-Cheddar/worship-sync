import { normalizeChurchIntegrations } from "./churchIntegrations";

describe("normalizeChurchIntegrations", () => {
  it("keeps the Planning Center connection revision and defaults it for legacy data", () => {
    const current = normalizeChurchIntegrations({
      planningCenter: {
        enabled: true,
        connected: true,
        accountLabel: "Shared Church",
        accountId: "",
        connectionRevision: "connect-revision-1",
      },
    });
    const legacy = normalizeChurchIntegrations({
      planningCenter: {
        enabled: true,
        connected: true,
        accountLabel: "Shared Church",
        accountId: "",
      },
    });

    expect(current.planningCenter).toMatchObject({
      accountLabel: "Shared Church",
      accountId: "",
      connectionRevision: "connect-revision-1",
    });
    expect(legacy.planningCenter.connectionRevision).toBe("");
  });
});
