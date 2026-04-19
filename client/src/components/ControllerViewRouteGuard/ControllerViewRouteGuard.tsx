import { ReactNode, useContext, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";

/** Controller segments view-only users must not open (creation and settings; content tools stay reachable read-only). */
export const VIEW_BLOCKED_CONTROLLER_SEGMENTS = new Set([
  "create",
  "preferences",
  "quick-links",
  "monitor-settings",
  "service-planning",
]);

type ControllerViewRouteGuardProps = {
  children: ReactNode;
};

/**
 * Redirects view-access sessions away from routes that add items or change team settings.
 */
const ControllerViewRouteGuard = ({ children }: ControllerViewRouteGuardProps) => {
  const { access } = useContext(GlobalInfoContext) || {};
  const location = useLocation();

  const shouldRedirect = useMemo(() => {
    if (access !== "view") return false;
    const segments = location.pathname.split("/").filter(Boolean);
    const first = segments[0];
    const second = segments[1];
    if (first !== "controller" || !second) return false;
    return VIEW_BLOCKED_CONTROLLER_SEGMENTS.has(second);
  }, [access, location.pathname]);

  if (shouldRedirect) {
    return <Navigate to="/controller" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

export default ControllerViewRouteGuard;
