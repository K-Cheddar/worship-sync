import { buildServicePlanFlowSnapshot } from "./buildServicePlanFlowSnapshot";
import type { ServicePlan } from "../types/servicePlan";

describe("buildServicePlanFlowSnapshot resources", () => {
  it("preserves rich notes and normalizes legacy generic resource text", () => {
    const richText = {
      blocks: [
        { type: "paragraph" as const, spans: [{ text: "First paragraph." }] },
        { type: "paragraph" as const, spans: [{ text: "Second paragraph." }] },
        {
          type: "list-item" as const,
          listStyle: "ordered" as const,
          listStart: 3,
          spans: [{ text: "Checklist item." }],
        },
      ],
    };
    const plan = {
      planKey: "plan-1",
      name: "Sunday Service",
      timezone: "UTC",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "item-1",
          title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }] },
          type: "item",
          resources: [
            { id: "text-1", type: "text", title: "Text", data: { text: richText } },
            { id: "generic-1", type: "generic", title: "Generic", data: { notes: richText } },
            { id: "legacy-1", type: "generic", title: "Legacy", data: { notes: "First line.\nSecond line." } },
          ],
        }],
      }],
    } as unknown as ServicePlan;

    const snapshot = buildServicePlanFlowSnapshot({ plan, startsAt: "2026-09-25T10:00:00Z", serverNowMs: 1 });
    const resources = snapshot.service.sections[0].items[0].resources;
    expect(resources?.map((resource) => resource.richTextContent)).toEqual([
      richText,
      richText,
      { blocks: [
        { type: "paragraph", spans: [{ text: "First line." }] },
        { type: "paragraph", spans: [{ text: "Second line." }] },
      ] },
    ]);
    expect(resources?.map((resource) => resource.detail)).toEqual([
      "First paragraph.\nSecond paragraph.\n3. Checklist item.",
      "First paragraph.\nSecond paragraph.\n3. Checklist item.",
      "First line.\nSecond line.",
    ]);
  });
});
