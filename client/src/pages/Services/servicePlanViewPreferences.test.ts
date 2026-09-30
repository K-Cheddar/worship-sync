import {
  readServicePlanTemplateHistory,
  rememberServicePlanTemplate,
} from "./servicePlanViewPreferences";

describe("service plan template history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps last-used templates isolated by church and service type", () => {
    rememberServicePlanTemplate("church-1", "service-a", "template-a");
    rememberServicePlanTemplate("church-1", "service-b", "template-b");
    rememberServicePlanTemplate("church-2", "service-a", "template-other-church");

    expect(readServicePlanTemplateHistory("church-1")).toEqual({
      "service-a": "template-a",
      "service-b": "template-b",
    });
    expect(readServicePlanTemplateHistory("church-2")).toEqual({
      "service-a": "template-other-church",
    });
  });

  it("ignores malformed or empty stored values", () => {
    localStorage.setItem(
      "worshipsyncServicePlanLastUsedTemplates:church-1",
      JSON.stringify({ "": "template", "service-a": "", "service-b": "template-b" }),
    );

    expect(readServicePlanTemplateHistory("church-1")).toEqual({
      "service-b": "template-b",
    });
  });
});
