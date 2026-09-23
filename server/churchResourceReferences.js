const resourceIdFromContent = (resource) =>
  typeof resource?.data?.resourceId === "string"
    ? resource.data.resourceId.trim()
    : "";

const resourcesContainId = (resources, resourceId) =>
  Array.isArray(resources) &&
  resources.some((resource) => resourceIdFromContent(resource) === resourceId);

const elementsContainResource = (elements, resourceId) =>
  Array.isArray(elements) &&
  elements.some((element) => resourcesContainId(element?.resources, resourceId));

/**
 * Service Plans are the first reverse-reference consumer. Keep this scan in a
 * small helper so future resource consumers can be added without teaching the
 * delete handler about every persisted plan shape.
 */
export const servicePlanReferencesChurchResource = (servicePlan, resourceId) => {
  const id = String(resourceId || "").trim();
  if (!id || !servicePlan || typeof servicePlan !== "object") return false;
  const sectionElements = Array.isArray(servicePlan.sections)
    ? servicePlan.sections.flatMap((section) => section?.elements || [])
    : [];
  return (
    elementsContainResource(sectionElements, id) ||
    elementsContainResource(servicePlan.elements, id)
  );
};

export const findChurchResourceServicePlanReferences = async ({
  queryDocs,
  servicePlansCollection,
  churchId,
  resourceId,
  limit = 5000,
}) => {
  if (typeof queryDocs !== "function" || !servicePlansCollection) {
    throw new Error("Service Plan reference scanning is not configured.");
  }
  const plans = await queryDocs(
    servicePlansCollection,
    [{ field: "churchId", value: churchId }],
    { limit },
  );
  return plans.filter(
    (plan) =>
      plan?.churchId === churchId &&
      servicePlanReferencesChurchResource(plan, resourceId),
  );
};
