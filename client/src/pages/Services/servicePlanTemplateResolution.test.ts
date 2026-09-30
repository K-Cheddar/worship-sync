import type { ServicePlanTemplate } from "../../types/servicePlan";
import { resolvePrimaryServicePlanTemplate } from "./servicePlanTemplateResolution";

const template = (
  templateId: string,
  serviceId?: string,
): ServicePlanTemplate => ({
  templateId,
  churchId: "church-1",
  name: templateId,
  ...(serviceId ? { serviceId } : {}),
  sections: [],
});

describe("resolvePrimaryServicePlanTemplate", () => {
  it("uses an explicit service default before last-used history", () => {
    const result = resolvePrimaryServicePlanTemplate({
      templates: [template("default", "service-1"), template("last-used")],
      serviceId: "service-1",
      defaultTemplateId: "default",
      lastUsedTemplateId: "last-used",
    });

    expect(result?.templateId).toBe("default");
  });

  it("uses last-used history when there is no explicit default", () => {
    const result = resolvePrimaryServicePlanTemplate({
      templates: [template("first"), template("last-used")],
      serviceId: "service-1",
      lastUsedTemplateId: "last-used",
    });

    expect(result?.templateId).toBe("last-used");
  });

  it("ignores missing history and falls back to the only applicable template", () => {
    const result = resolvePrimaryServicePlanTemplate({
      templates: [template("only", "service-1"), template("other", "service-2")],
      serviceId: "service-1",
      lastUsedTemplateId: "deleted",
    });

    expect(result?.templateId).toBe("only");
  });

  it("returns no primary when multiple applicable templates remain", () => {
    const result = resolvePrimaryServicePlanTemplate({
      templates: [template("one"), template("two")],
      serviceId: "service-1",
    });

    expect(result).toBeNull();
  });

  it("does not resolve another service's template", () => {
    const result = resolvePrimaryServicePlanTemplate({
      templates: [template("other", "service-2")],
      serviceId: "service-1",
      defaultTemplateId: "other",
      lastUsedTemplateId: "other",
    });

    expect(result).toBeNull();
  });
});
