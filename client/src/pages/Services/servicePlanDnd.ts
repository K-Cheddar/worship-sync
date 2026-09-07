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

/**
 * From a collision list already produced by dnd-kit, prefer nested item targets
 * over tall parent section cards when dragging an element.
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

  const elementCollisions = collisions.filter((collision) =>
    isElementDndId(String(collision.id)),
  );
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

  const pointerCollisions = pickServicePlanCollisions(
    activeId,
    pointerWithin(args),
  );
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  const intersectionCollisions = pickServicePlanCollisions(
    activeId,
    rectIntersection(args),
  );
  if (intersectionCollisions.length > 0) {
    return intersectionCollisions;
  }

  const elementContainers = args.droppableContainers.filter((container) =>
    isElementDndId(String(container.id)),
  );
  const elementClosest = closestCenter({
    ...args,
    droppableContainers: elementContainers,
  });
  if (elementClosest.length > 0) {
    return elementClosest;
  }

  const sectionContainers = args.droppableContainers.filter((container) =>
    isSectionDndId(String(container.id)),
  );
  return closestCenter({
    ...args,
    droppableContainers: sectionContainers,
  });
};

export type ServicePlanDropAction =
  | { type: "reorder-sections" }
  | { type: "move-element-to-element" }
  | { type: "move-element-to-section" }
  | { type: "noop" };

/**
 * Decide what a completed drag should commit. Dropping an element on its own
 * parent section is a no-op (tall-section collision leftover) — do not append
 * to the end of that section.
 */
export const resolveServicePlanDropAction = ({
  activeId,
  overId,
  activeElementOwningSectionId,
}: {
  activeId: string;
  overId: string;
  /** Section that currently owns the dragged element (from committed plan data). */
  activeElementOwningSectionId: string | null;
}): ServicePlanDropAction => {
  if (activeId === overId) {
    return { type: "noop" };
  }

  if (isSectionDndId(activeId) && isSectionDndId(overId)) {
    return { type: "reorder-sections" };
  }

  if (isElementDndId(activeId) && isElementDndId(overId)) {
    return { type: "move-element-to-element" };
  }

  if (isElementDndId(activeId) && isSectionDndId(overId)) {
    const destinationSectionId = overId.slice(
      SERVICE_PLAN_SECTION_DND_PREFIX.length,
    );
    if (
      activeElementOwningSectionId != null &&
      activeElementOwningSectionId === destinationSectionId
    ) {
      return { type: "noop" };
    }
    return { type: "move-element-to-section" };
  }

  return { type: "noop" };
};
