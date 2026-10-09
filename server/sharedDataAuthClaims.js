const CONTROLLER_ACCESS_VALUES = new Set(["none", "view", "music", "full"]);
const SERVICES_ACCESS_VALUES = new Set(["none", "view", "edit"]);

/** Minimal authorization claims for church shared-data RTDB writes. */
export const buildSharedDataWriteClaims = (bootstrap = {}) => {
  const legacyControllerAccess = bootstrap.appAccess === "member"
    ? "none"
    : bootstrap.appAccess;
  const requestedControllerAccess = bootstrap.controllerAccess ?? legacyControllerAccess;
  const controllerAccess = CONTROLLER_ACCESS_VALUES.has(requestedControllerAccess)
    ? requestedControllerAccess
    : "view";
  const servicesPermission = bootstrap.permissions?.services;
  const hasServicesEdit =
    bootstrap.role === "admin" ||
    servicesPermission === "edit";
  const servicesAccess = hasServicesEdit
    ? "edit"
    : SERVICES_ACCESS_VALUES.has(servicesPermission)
      ? servicesPermission
      : "none";

  return { sharedDataAuthVersion: 2, controllerAccess, servicesAccess };
};
