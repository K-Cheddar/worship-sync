import type { TeamService } from "../../../api/authTypes";
import { calculateBulkTemplatePreview } from "./bulkTemplatePreview";

const service = (serviceId: string, defaultPlanTemplateId?: string): TeamService => ({
  serviceId,
  id: serviceId,
  churchId: "church-1",
  name: serviceId,
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
  ...(defaultPlanTemplateId ? { defaultPlanTemplateId } : {}),
});

const entries = [
  { planKey: "a@2026-10-04", serviceId: "a" },
  { planKey: "b@2026-10-04", serviceId: "b" },
];

const preview = (options: Partial<Parameters<typeof calculateBulkTemplatePreview>[0]> = {}) =>
  calculateBulkTemplatePreview({
    entries,
    existingPlanKeys: new Set(),
    services: [service("a", "template-a"), service("b", "template-b")],
    useServiceDefaults: true,
    availableTemplateIds: new Set(["template-a", "template-b"]),
    templatesLoaded: true,
    ...options,
  });

describe("calculateBulkTemplatePreview", () => {
  it("counts every service date with an available default", () => {
    expect(preview().willCreate).toBe(2);
  });

  it("excludes service dates without defaults", () => {
    expect(preview({ services: [service("a", "template-a"), service("b")] })).toMatchObject({
      total: 2,
      noDefault: 1,
      willCreate: 1,
    });
  });

  it("excludes existing plans and defaults that no longer resolve", () => {
    expect(preview({
      existingPlanKeys: new Set(["a@2026-10-04"]),
      availableTemplateIds: new Set(["template-a"]),
    })).toMatchObject({ total: 2, existing: 1, unavailableDefault: 1, willCreate: 0 });
  });

  it("returns no actionable targets when every plan exists or has no default", () => {
    expect(preview({
      existingPlanKeys: new Set(["a@2026-10-04"]),
      services: [service("a"), service("b")],
    }).willCreate).toBe(0);
  });

  it("keeps one shared explicit template eligible for each empty service date", () => {
    expect(preview({ useServiceDefaults: false })).toMatchObject({
      total: 2,
      noDefault: 0,
      unavailableDefault: 0,
      willCreate: 2,
    });
  });
});
