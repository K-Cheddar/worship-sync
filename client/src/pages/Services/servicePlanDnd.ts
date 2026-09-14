import {
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors as useDndSensors,
  type Collision,
  type CollisionDetection,
} from "@dnd-kit/core";
import type { ServicePlanSection } from "../../types/servicePlan";
import { moveElementToPosition } from "./servicePlanDraftUtils";

export const SERVICE_PLAN_SECTION_DND_PREFIX = "section:";
export const SERVICE_PLAN_ELEMENT_DND_PREFIX = "element:";

/**
 * Plan editor grips already use `touch-none`, so touch can activate by distance
 * (like mouse) instead of a long-press that fails when the finger drifts a few
 * pixels on a scrollable list.
 */
export const useServicePlanSensors = () => {
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 4,
    },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      distance: 8,
    },
  });

  return useDndSensors(mouseSensor, touchSensor);
};

const isSectionDndId = (id: string) =>
  id.startsWith(SERVICE_PLAN_SECTION_DND_PREFIX);

const isElementDndId = (id: string) =>
  id.startsWith(SERVICE_PLAN_ELEMENT_DND_PREFIX);

export const servicePlanElementDndId = (elementId: string) =>
  `${SERVICE_PLAN_ELEMENT_DND_PREFIX}${elementId}`;

/**
 * From a collision list already produced by dnd-kit, prefer nested item targets
 * over tall parent section cards when dragging an element. The active item is
 * never a drop candidate — after a live preview it sits under the pointer and
 * would otherwise steal the destination.
 */
export const pickServicePlanCollisions = (
  activeId: string,
  collisions: Collision[],
): Collision[] => {
  if (isSectionDndId(activeId)) {
    return collisions.filter((collision) =>
      isSectionDndId(String(collision.id)),
    );
  }

  if (!isElementDndId(activeId)) {
    return collisions;
  }

  const elementCollisions = collisions.filter((collision) => {
    const collisionId = String(collision.id);
    return isElementDndId(collisionId) && collisionId !== activeId;
  });
  if (elementCollisions.length > 0) {
    return elementCollisions;
  }

  return collisions.filter((collision) => isSectionDndId(String(collision.id)));
};

/**
 * Nested section + element sortables: prefer element droppables whenever the
 * pointer or rect intersects one, so tall section cards do not steal the drop.
 */
export const servicePlanCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);

  if (isSectionDndId(activeId)) {
    const sectionContainers = args.droppableContainers.filter((container) =>
      isSectionDndId(String(container.id)),
    );
    return closestCenter({
      ...args,
      droppableContainers: sectionContainers,
    });
  }

  if (!isElementDndId(activeId)) {
    return closestCenter(args);
  }

  const argsWithoutActive = {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => String(container.id) !== activeId,
    ),
  };

  const pointerCollisions = pickServicePlanCollisions(
    activeId,
    pointerWithin(argsWithoutActive),
  );
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  const intersectionCollisions = pickServicePlanCollisions(
    activeId,
    rectIntersection(argsWithoutActive),
  );
  if (intersectionCollisions.length > 0) {
    return intersectionCollisions;
  }

  const elementContainers = argsWithoutActive.droppableContainers.filter(
    (container) => isElementDndId(String(container.id)),
  );
  const elementClosest = closestCenter({
    ...argsWithoutActive,
    droppableContainers: elementContainers,
  });
  if (elementClosest.length > 0) {
    return elementClosest;
  }

  const sectionContainers = argsWithoutActive.droppableContainers.filter(
    (container) => isSectionDndId(String(container.id)),
  );
  return closestCenter({
    ...argsWithoutActive,
    droppableContainers: sectionContainers,
  });
};

export type ServicePlanElementPlacement =
  | {
      type: "before" | "after";
      destinationSectionId: string;
      targetElementId: string;
    }
  | {
      type: "append";
      destinationSectionId: string;
    };

export const servicePlanElementPlacementsEqual = (
  a: ServicePlanElementPlacement | null,
  b: ServicePlanElementPlacement | null,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type || a.destinationSectionId !== b.destinationSectionId) {
    return false;
  }
  if (a.type === "append" || b.type === "append") {
    return a.type === "append" && b.type === "append";
  }
  return a.targetElementId === b.targetElementId;
};

export const elementDropEdgeFromPointer = (
  pointerY: number,
  overRect: { top: number; height: number },
): "before" | "after" =>
  pointerY < overRect.top + overRect.height / 2 ? "before" : "after";

export const pointerYFromDragEvent = (event: {
  activatorEvent: Event;
  delta: { y: number };
}): number | null => {
  const native = event.activatorEvent as {
    clientY?: number;
    touches?: ArrayLike<{ clientY: number }>;
    changedTouches?: ArrayLike<{ clientY: number }>;
  };
  if (typeof native.clientY === "number") {
    return native.clientY + event.delta.y;
  }
  const touch = native.touches?.[0] || native.changedTouches?.[0];
  return touch ? touch.clientY + event.delta.y : null;
};

/**
 * Resolve the semantic placement for an element drag against the committed
 * plan. Leftover collisions (the dragged row, the source section card, or the
 * destination section card after a precise row hit) keep the previous
 * placement instead of inventing a new one.
 */
export const resolveServicePlanElementPlacement = ({
  sections,
  activeElementId,
  overId,
  pointerY = null,
  overRect = null,
  previousPlacement = null,
}: {
  sections: ServicePlanSection[];
  activeElementId: string;
  overId: string | null;
  pointerY?: number | null;
  overRect?: { top: number; height: number } | null;
  previousPlacement?: ServicePlanElementPlacement | null;
}): ServicePlanElementPlacement | null => {
  if (!overId) return previousPlacement;

  const source = sections.find((section) =>
    section.elements.some((element) => element.id === activeElementId),
  );
  if (!source) return previousPlacement;

  if (overId === servicePlanElementDndId(activeElementId)) {
    return previousPlacement;
  }

  if (isElementDndId(overId)) {
    const targetElementId = overId.slice(
      SERVICE_PLAN_ELEMENT_DND_PREFIX.length,
    );
    const destination = sections.find((section) =>
      section.elements.some((element) => element.id === targetElementId),
    );
    if (!destination) return previousPlacement;
    const edge =
      pointerY != null && overRect
        ? elementDropEdgeFromPointer(pointerY, overRect)
        : "before";
    return {
      type: edge,
      destinationSectionId: destination.id,
      targetElementId,
    };
  }

  if (!isSectionDndId(overId)) return previousPlacement;

  const destinationSectionId = overId.slice(
    SERVICE_PLAN_SECTION_DND_PREFIX.length,
  );
  const destination = sections.find(
    (section) => section.id === destinationSectionId,
  );
  if (!destination) return previousPlacement;

  if (destination.elements.length === 0) {
    return { type: "append", destinationSectionId: destination.id };
  }

  if (
    previousPlacement &&
    previousPlacement.type !== "append" &&
    previousPlacement.destinationSectionId === destination.id
  ) {
    return previousPlacement;
  }

  if (
    previousPlacement &&
    previousPlacement.destinationSectionId !== source.id &&
    destination.id === source.id
  ) {
    return previousPlacement;
  }

  return { type: "append", destinationSectionId: destination.id };
};

/** Apply a semantic placement to the committed plan. Always the same input → same output. */
export const applyServicePlanElementPlacement = (
  sections: ServicePlanSection[],
  activeElementId: string,
  placement: ServicePlanElementPlacement,
): ServicePlanSection[] | null => {
  const source = sections.find((section) =>
    section.elements.some((element) => element.id === activeElementId),
  );
  const destination = sections.find(
    (section) => section.id === placement.destinationSectionId,
  );
  if (!source || !destination) return null;

  const destWithoutActive = destination.elements.filter(
    (element) => element.id !== activeElementId,
  );

  let targetIndex: number;
  if (placement.type === "append") {
    targetIndex = destWithoutActive.length;
  } else {
    const targetIndexInDest = destWithoutActive.findIndex(
      (element) => element.id === placement.targetElementId,
    );
    if (targetIndexInDest === -1) return null;
    targetIndex =
      placement.type === "before" ? targetIndexInDest : targetIndexInDest + 1;
  }

  return moveElementToPosition(
    sections,
    activeElementId,
    source.id,
    destination.id,
    targetIndex,
  );
};

export const previewServicePlanSections = (
  sections: ServicePlanSection[],
  activeElementId: string,
  placement: ServicePlanElementPlacement | null,
): ServicePlanSection[] => {
  if (!placement) return sections;
  return (
    applyServicePlanElementPlacement(sections, activeElementId, placement) ||
    sections
  );
};

/**
 * Commit the last valid preview whenever the drop has a target. Cancelled or
 * outside drops (`overId` missing) restore the original order.
 */
export const commitServicePlanElementDrag = ({
  originalSections,
  previewSections,
  overId,
}: {
  originalSections: ServicePlanSection[];
  previewSections: ServicePlanSection[] | null;
  overId: string | null;
}): ServicePlanSection[] => {
  if (!overId || !previewSections) return originalSections;
  return previewSections;
};
