import { useContext, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  getAllowedRouteOrDefault,
  isRouteAllowedForSession,
} from "../../utils/sessionRouteAccess";

let initialRouteRestoreStatus: "pending" | "done" = "pending";
let initialRouteRestoreTimeout: ReturnType<typeof setTimeout> | null = null;

export const resetRoutePersistenceForTests = () => {
  initialRouteRestoreStatus = "pending";
  if (initialRouteRestoreTimeout !== null) {
    clearTimeout(initialRouteRestoreTimeout);
    initialRouteRestoreTimeout = null;
  }
};

const RESTORE_STARTUP_ROUTES = new Set([
  "/",
  "/login",
  "/login/desktop-sso-complete",
  "/home",
  "/workstation/operator",
]);

const ROUTES_TO_SKIP_SAVE = new Set([
  "/login",
  "/login/desktop-sso-complete",
  "/workstation/pair",
  "/workstation/operator",
  "/projector",
  "/projector-full",
  "/monitor",
  "/stream",
  "/stream-info",
  "/credits",
]);

/**
 * Component that persists and restores the current route in Electron
 * Saves the route whenever it changes and restores it on app startup
 */
const RoutePersistence: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const context = useContext(GlobalInfoContext);
  const isElectron = window.electronAPI !== undefined;
  const bootstrapReady = context?.bootstrapStatus === "ready";
  const routeContext = useMemo(
    () => ({
      loginState: context?.loginState,
      sessionKind: context?.sessionKind,
      access: context?.access,
      operatorName: context?.operatorName,
      displaySurfaceType: context?.device?.surfaceType,
    }),
    [
      context?.access,
      context?.device?.surfaceType,
      context?.loginState,
      context?.operatorName,
      context?.sessionKind,
    ]
  );

  // Restore once after auth/bootstrap settles so we don't bounce through blocked routes.
  useEffect(() => {
    if (!isElectron || !bootstrapReady || initialRouteRestoreStatus === "done") return;
    if (initialRouteRestoreTimeout !== null) return;

    if (!RESTORE_STARTUP_ROUTES.has(location.pathname)) {
      initialRouteRestoreStatus = "done";
      return;
    }

    const restoreRoute = async () => {
      try {
        const lastRoute = await window.electronAPI!.getLastRoute();
        if (!lastRoute || lastRoute === "/" || lastRoute === location.pathname) {
          return;
        }

        if (isRouteAllowedForSession(lastRoute, routeContext)) {
          navigate(lastRoute, { replace: true });
          return;
        }

        const fallbackRoute = getAllowedRouteOrDefault(null, routeContext);
        if (fallbackRoute && fallbackRoute !== location.pathname && fallbackRoute !== "/") {
          navigate(fallbackRoute, { replace: true });
        }
      } catch (error) {
        console.error("Error restoring route:", error);
      } finally {
        initialRouteRestoreStatus = "done";
        initialRouteRestoreTimeout = null;
      }
    };

    initialRouteRestoreTimeout = setTimeout(restoreRoute, 100);
    return () => {
      if (initialRouteRestoreTimeout !== null) {
        clearTimeout(initialRouteRestoreTimeout);
        initialRouteRestoreTimeout = null;
      }
    };
  }, [bootstrapReady, isElectron, location.pathname, navigate, routeContext]);

  // Save route whenever it changes
  useEffect(() => {
    if (!isElectron || initialRouteRestoreStatus !== "done") return;

    if (ROUTES_TO_SKIP_SAVE.has(location.pathname)) {
      return;
    }

    // Save the current route
    const saveRoute = async () => {
      try {
        await window.electronAPI!.saveLastRoute(location.pathname);
      } catch (error) {
        console.error("Error saving route:", error);
      }
    };

    saveRoute();
  }, [location.pathname, isElectron]);

  return null;
};

export default RoutePersistence;
