import { buildServicePlanFlowSnapshot } from "./buildServicePlanFlowSnapshot";
import type { ServicePlan } from "../types/servicePlan";
import scriptureFixtures from "../../../shared/servicePlanScripture.fixtures.json";

describe("buildServicePlanFlowSnapshot resources", () => {
  it("matches server Scripture titles for legacy and explicit structured references", () => {
    const references = scriptureFixtures.map(({ reference }) => reference);
    const elements = [
      ...references.map((scriptureRef, index) => ({ id: `single-${index}`, scriptureRef })),
      { id: "multiple", scriptureRefs: references },
      ...["scripture", "scriptureRef", "flat"].map((shape) => ({
        id: shape,
        resources: references.map((reference, index) => ({
          id: `${shape}-${index}`, type: "scripture", title: reference.label,
          data: shape === "flat" ? reference : { [shape]: reference },
        })),
      })),
    ];
    const plan = {
      planKey: "scripture", sections: [{ id: "main", elements }],
    } as unknown as ServicePlan;
    const saved = JSON.stringify(plan);
    const snapshot = buildServicePlanFlowSnapshot({ plan, startsAt: "2026-10-18T10:00:00Z" });
    const titles = scriptureFixtures.map(({ title }) => title);
    expect(snapshot.service.sections[0].items.map((item) => item.resources?.map((r) => r.title))).toEqual([
      ...titles.map((title) => [title]), titles, titles, titles, titles,
    ]);
    expect(JSON.stringify(plan)).toBe(saved);
  });

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

  it("accepts explicit public branding for the authenticated fallback", () => {
    const snapshot = buildServicePlanFlowSnapshot({
      plan: {
        planKey: "plan-1",
        name: "Sunday Service",
        timezone: "UTC",
        sections: [],
      } as unknown as ServicePlan,
      startsAt: "2026-09-25T10:00:00Z",
      churchName: "Northside",
      branding: {
        churchLogoUrl: "https://res.cloudinary.com/example/image/upload/church.png",
        churchPrimaryColor: "#112233",
        churchSecondaryColor: "#AABBCC",
      },
    });

    expect(snapshot).toMatchObject({
      churchName: "Northside",
      churchLogoUrl: "https://res.cloudinary.com/example/image/upload/church.png",
      churchPrimaryColor: "#112233",
      churchSecondaryColor: "#AABBCC",
    });
  });
});
