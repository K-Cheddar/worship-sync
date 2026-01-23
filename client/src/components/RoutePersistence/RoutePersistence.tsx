import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Component that persists and restores the current route in Electron
 * Saves the route whenever it changes and restores it on app startup
 */
const RoutePersistence: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const hasRestoredRef = useRef(false);
  const isElectron = window.electronAPI !== undefined;

  // Restore route on mount (only once)
  useEffect(() => {
    if (!isElectron || hasRestoredRef.current) return;

    const restoreRoute = async () => {
      try {
        const lastRoute = await window.electronAPI!.getLastRoute();
        if (lastRoute && lastRoute !== location.pathname && lastRoute !== "/") {
          // Only restore if we're on the home page or a different route
          // This prevents restoring when navigating programmatically
          if (location.pathname === "/" || location.pathname === "/login") {
            navigate(lastRoute, { replace: true });
          }
        }
        hasRestoredRef.current = true;
      } catch (error) {
        console.error("Error restoring route:", error);
        hasRestoredRef.current = true;
      }
    };

    // Small delay to ensure router is ready
    const timeoutId = setTimeout(restoreRoute, 100);
    return () => clearTimeout(timeoutId);
  }, [isElectron, navigate, location.pathname]);

  // Save route whenever it changes
  useEffect(() => {
    if (!isElectron || !hasRestoredRef.current) return;

    // Don't save certain routes (like login, projector, monitor, stream)
    const routesToSkip = [
      "/login",
      "/projector",
      "/projector-full",
      "/monitor",
      "/stream",
      "/stream-info",
      "/credits",
    ];

    if (routesToSkip.includes(location.pathname)) {
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
