import {
  commitServicePlanElementDrag,
  elementDropEdgeFromPointer,
  pickServicePlanCollisions,
  previewServicePlanSections,
  resolveServicePlanElementPlacement,
  SERVICE_PLAN_ELEMENT_DND_PREFIX,
  SERVICE_PLAN_SECTION_DND_PREFIX,
} from "./servicePlanDnd";
import { plainTextToRichText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";

const element = (id: string): ServicePlanElement => ({
  id,
  type: "free",
  title: plainTextToRichText(id),
});

const sectionsForElementDrop = (): ServicePlanSection[] => [
  {
    id: "a",
    name: "Section A",
    elements: [element("a1"), element("a2"), element("a3")],
  },
  {
    id: "b",
    name: "Section B",
    elements: [element("b1"), element("b2"), element("b3"), element("b4")],
  },
  {
    id: "empty",
    name: "Empty section",
    elements: [],
  },
];

const elementIdsIn = (sections: ServicePlanSection[], sectionId: string) =>
  sections
    .find((section) => section.id === sectionId)
    ?.elements.map((item) => item.id);

const elementOver = (id: string) => `${SERVICE_PLAN_ELEMENT_DND_PREFIX}${id}`;
const sectionOver = (id: string) => `${SERVICE_PLAN_SECTION_DND_PREFIX}${id}`;
const rowRect = { top: 100, height: 40 };
const upperHalfY = 110;
const lowerHalfY = 130;

const previewFromOver = (
  overId: string,
  pointerY: number,
  previousPlacement: ReturnType<
    typeof resolveServicePlanElementPlacement
  > = null,
  sections = sectionsForElementDrop(),
) => {
  const placement = resolveServicePlanElementPlacement({
    sections,
    activeElementId: "a1",
    overId,
    pointerY,
    overRect: rowRect,
    previousPlacement,
  });
  return {
    placement,
    sections: previewServicePlanSections(sections, "a1", placement),
  };
};

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

  it("ignores the dragged element so it cannot steal the destination", () => {
    expect(
      pickServicePlanCollisions(`${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`, [
        elementOne,
        sectionA,
        elementTwo,
      ]),
    ).toEqual([elementTwo]);
  });

  it("falls back to section collisions when no other element is hit", () => {
    expect(
      pickServicePlanCollisions(`${SERVICE_PLAN_ELEMENT_DND_PREFIX}one`, [
        elementOne,
        sectionA,
        sectionB,
      ]),
    ).toEqual([sectionA, sectionB]);
  });
});

describe("elementDropEdgeFromPointer", () => {
  it("inserts before in the upper half and after in the lower half", () => {
    expect(elementDropEdgeFromPointer(upperHalfY, rowRect)).toBe("before");
    expect(elementDropEdgeFromPointer(lowerHalfY, rowRect)).toBe("after");
  });
});

describe("resolveServicePlanElementPlacement", () => {
  it("places a cross-section drop in the upper half before the target", () => {
    const { placement, sections } = previewFromOver(
      elementOver("b4"),
      upperHalfY,
    );

    expect(placement).toEqual({
      type: "before",
      destinationSectionId: "b",
      targetElementId: "b4",
    });
    expect(elementIdsIn(sections, "b")).toEqual(["b1", "b2", "b3", "a1", "b4"]);
    expect(elementIdsIn(sections, "a")).toEqual(["a2", "a3"]);
  });

  it("places a cross-section drop in the lower half after the target", () => {
    const { placement, sections } = previewFromOver(
      elementOver("b3"),
      lowerHalfY,
    );

    expect(placement).toEqual({
      type: "after",
      destinationSectionId: "b",
      targetElementId: "b3",
    });
    expect(elementIdsIn(sections, "b")).toEqual(["b1", "b2", "b3", "a1", "b4"]);
  });

  it("updates before to after while hovering the same target", () => {
    const first = previewFromOver(elementOver("b3"), upperHalfY);
    expect(elementIdsIn(first.sections, "b")).toEqual([
      "b1",
      "b2",
      "a1",
      "b3",
      "b4",
    ]);

    const second = previewFromOver(
      elementOver("b3"),
      lowerHalfY,
      first.placement,
    );

    expect(first.placement?.type).toBe("before");
    expect(second.placement?.type).toBe("after");
    expect(
      second.placement?.type === "after" && second.placement.targetElementId,
    ).toBe("b3");
    expect(elementIdsIn(second.sections, "b")).toEqual([
      "b1",
      "b2",
      "b3",
      "a1",
      "b4",
    ]);
  });

  it("keeps a precise preview when the last collision is the dragged row", () => {
    const first = previewFromOver(elementOver("b3"), lowerHalfY);
    const leftover = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a1",
      overId: elementOver("a1"),
      previousPlacement: first.placement,
    });

    expect(leftover).toEqual(first.placement);
  });

  it("keeps a precise preview when the last collision is the destination section card", () => {
    const first = previewFromOver(elementOver("b3"), upperHalfY);
    const leftover = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a1",
      overId: sectionOver("b"),
      previousPlacement: first.placement,
    });

    expect(leftover).toEqual(first.placement);
    expect(
      elementIdsIn(
        previewServicePlanSections(sectionsForElementDrop(), "a1", leftover),
        "b",
      ),
    ).toEqual(["b1", "b2", "a1", "b3", "b4"]);
  });

  it("keeps a cross-section preview when the last collision is the source section card", () => {
    const first = previewFromOver(elementOver("b2"), lowerHalfY);
    const leftover = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a1",
      overId: sectionOver("a"),
      previousPlacement: first.placement,
    });

    expect(leftover).toEqual(first.placement);
  });

  it("reorders an item upward within its section", () => {
    const placement = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a3",
      overId: elementOver("a1"),
      pointerY: upperHalfY,
      overRect: rowRect,
    });

    expect(
      elementIdsIn(
        previewServicePlanSections(sectionsForElementDrop(), "a3", placement),
        "a",
      ),
    ).toEqual(["a3", "a1", "a2"]);
  });

  it("reorders an item downward within its section", () => {
    const placement = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a1",
      overId: elementOver("a3"),
      pointerY: lowerHalfY,
      overRect: rowRect,
    });

    expect(
      elementIdsIn(
        previewServicePlanSections(sectionsForElementDrop(), "a1", placement),
        "a",
      ),
    ).toEqual(["a2", "a3", "a1"]);
  });

  it("moves an item into an empty section", () => {
    const placement = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a1",
      overId: sectionOver("empty"),
    });

    expect(placement).toEqual({
      type: "append",
      destinationSectionId: "empty",
    });
    expect(
      elementIdsIn(
        previewServicePlanSections(sectionsForElementDrop(), "a1", placement),
        "empty",
      ),
    ).toEqual(["a1"]);
  });

  it("appends after the final element from its lower half", () => {
    const { sections } = previewFromOver(elementOver("b4"), lowerHalfY);

    expect(elementIdsIn(sections, "b")).toEqual(["b1", "b2", "b3", "b4", "a1"]);
  });

  it("appends when the first contact is section whitespace", () => {
    const placement = resolveServicePlanElementPlacement({
      sections: sectionsForElementDrop(),
      activeElementId: "a1",
      overId: sectionOver("b"),
    });

    expect(placement).toEqual({
      type: "append",
      destinationSectionId: "b",
    });
    expect(
      elementIdsIn(
        previewServicePlanSections(sectionsForElementDrop(), "a1", placement),
        "b",
      ),
    ).toEqual(["b1", "b2", "b3", "b4", "a1"]);
  });
});

describe("commitServicePlanElementDrag", () => {
  const original = sectionsForElementDrop();

  it("commits the last valid preview even when release hits the dragged row", () => {
    const preview = previewFromOver(elementOver("b3"), lowerHalfY).sections;
    const committed = commitServicePlanElementDrag({
      originalSections: original,
      previewSections: preview,
      overId: elementOver("a1"),
    });

    expect(committed).toBe(preview);
    expect(elementIdsIn(committed, "b")).toEqual([
      "b1",
      "b2",
      "b3",
      "a1",
      "b4",
    ]);
  });

  it("commits the last valid preview when release hits a section container", () => {
    const preview = previewFromOver(elementOver("b3"), upperHalfY).sections;
    const committed = commitServicePlanElementDrag({
      originalSections: original,
      previewSections: preview,
      overId: sectionOver("b"),
    });

    expect(committed).toBe(preview);
  });

  it("restores the original order for a cancelled or outside drop", () => {
    const preview = previewFromOver(elementOver("b1"), upperHalfY).sections;
    const committed = commitServicePlanElementDrag({
      originalSections: original,
      previewSections: preview,
      overId: null,
    });

    expect(committed).toBe(original);
    expect(elementIdsIn(committed, "a")).toEqual(["a1", "a2", "a3"]);
  });

  it("keeps preview and commit identical for the last valid placement", () => {
    const { placement, sections: preview } = previewFromOver(
      elementOver("b3"),
      lowerHalfY,
    );
    const leftoverOvers = [
      elementOver("b3"),
      elementOver("a1"),
      sectionOver("b"),
      sectionOver("a"),
    ];

    expect(placement).toEqual({
      type: "after",
      destinationSectionId: "b",
      targetElementId: "b3",
    });
    leftoverOvers.forEach((overId) => {
      expect(
        commitServicePlanElementDrag({
          originalSections: original,
          previewSections: preview,
          overId,
        }),
      ).toEqual(preview);
    });
  });
});
