import {
  pickServicePlanCollisions,
  resolveServicePlanDropAction,
  SERVICE_PLAN_ELEMENT_DND_PREFIX,
  SERVICE_PLAN_SECTION_DND_PREFIX,
} from "./servicePlanDnd";

describe("pickServicePlanCollisions", () => {
  const sectionA = { id: `${SERVICE_PLAN_SECTION_DND_PREFIX}a` };
  const sectionB = { id: `${SERVICE_PLAN_SECTION_DND_PREFIX}b` };
  const elementOne = { id: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}one` };
  const elementTwo = { id: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}two` };

  it("keeps only section collisions when dragging a section", () => {
    expect(
      pickServicePlanCollisions(`${SERVICE_PLAN_SECTION_DND_PREFIX}a`, [
        elementOne,
        sectionB,
        sectionA,
      ]),
    ).toEqual([sectionB, sectionA]);
  });

  it("prefers element collisions when dragging an element", () => {
    expect(
      pickServicePlanCollisions(`${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`, [
        sectionA,
        elementTwo,
        sectionB,
      ]),
    ).toEqual([elementTwo]);
  });

  it("falls back to section collisions when no element is hit", () => {
    expect(
      pickServicePlanCollisions(`${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`, [
        sectionA,
        sectionB,
      ]),
    ).toEqual([sectionA, sectionB]);
  });
});

describe("resolveServicePlanDropAction", () => {
  it("no-ops when active and over are the same id", () => {
    expect(
      resolveServicePlanDropAction({
        activeId: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`,
        overId: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`,
        activeElementOwningSectionId: "a",
      }),
    ).toEqual({ type: "noop" });
  });

  it("reorders sections when both ids are sections", () => {
    expect(
      resolveServicePlanDropAction({
        activeId: `${SERVICE_PLAN_SECTION_DND_PREFIX}a`,
        overId: `${SERVICE_PLAN_SECTION_DND_PREFIX}b`,
        activeElementOwningSectionId: null,
      }),
    ).toEqual({ type: "reorder-sections" });
  });

  it("moves an element onto another element", () => {
    expect(
      resolveServicePlanDropAction({
        activeId: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`,
        overId: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}two`,
        activeElementOwningSectionId: "a",
      }),
    ).toEqual({ type: "move-element-to-element" });
  });

  it("no-ops when an element is dropped on its own section", () => {
    expect(
      resolveServicePlanDropAction({
        activeId: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`,
        overId: `${SERVICE_PLAN_SECTION_DND_PREFIX}a`,
        activeElementOwningSectionId: "a",
      }),
    ).toEqual({ type: "noop" });
  });

  it("appends to another section when an element is dropped on that section", () => {
    expect(
      resolveServicePlanDropAction({
        activeId: `${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`,
        overId: `${SERVICE_PLAN_SECTION_DND_PREFIX}b`,
        activeElementOwningSectionId: "a",
      }),
    ).toEqual({ type: "move-element-to-section" });
  });
});
