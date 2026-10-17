import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  resolvePath,
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateOptions,
} from "react-router-dom";

type PendingRouteNavigation = {
  pathname: string | null;
  request: (to: string, options?: NavigateOptions) => void;
  complete: (pathname: string) => void;
  clear: () => void;
};

type PendingRoute = {
  pathname: string;
  sourceKey: string;
};

const PendingRouteNavigationContext =
  createContext<PendingRouteNavigation | null>(null);

/** Temporary route intent shared by navigation controls and route boundaries. */
export const PendingRouteNavigationProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [pendingRoute, setPendingRoute] = useState<PendingRoute | null>(null);

  const clear = useCallback(() => setPendingRoute(null), []);

  const request = useCallback(
    (to: string, options?: NavigateOptions) => {
      const pathname = resolvePath(to, location.pathname).pathname;
      if (pathname !== location.pathname) {
        setPendingRoute({ pathname, sourceKey: location.key });
      } else {
        setPendingRoute(null);
      }
      navigate(to, options);
    },
    [location.key, location.pathname, navigate],
  );

  const complete = useCallback((pathname: string) => {
    setPendingRoute((current) =>
      current?.pathname === pathname ? null : current,
    );
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", clear);
    return () => window.removeEventListener("popstate", clear);
  }, [clear]);

  useEffect(() => {
    if (!pendingRoute || location.key === pendingRoute.sourceKey) return;
    if (
      navigationType === "POP" ||
      location.pathname !== pendingRoute.pathname
    ) {
      setPendingRoute(null);
    }
  }, [location.key, location.pathname, navigationType, pendingRoute]);

  const value = useMemo(
    () => ({
      pathname: pendingRoute?.pathname ?? null,
      request,
      complete,
      clear,
    }),
    [clear, complete, pendingRoute, request],
  );

  return (
    <PendingRouteNavigationContext.Provider value={value}>
      {children}
    </PendingRouteNavigationContext.Provider>
  );
};

export const usePendingRouteNavigation = () => {
  const context = useContext(PendingRouteNavigationContext);
  if (!context) {
    throw new Error(
      "usePendingRouteNavigation must be used within PendingRouteNavigationProvider.",
    );
  }
  return context;
};

export const isUnmodifiedLeftClick = (
  event: ReactMouseEvent<HTMLAnchorElement>,
) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey;

export const PendingRouteReady = ({ routePath }: { routePath: string }) => {
  const { pathname, complete } = usePendingRouteNavigation();
  const location = useLocation();
  const routeIsReady = Boolean(
    pathname &&
    (pathname === routePath || pathname.startsWith(`${routePath}/`)) &&
    (location.pathname === routePath ||
      location.pathname.startsWith(`${routePath}/`)),
  );

  useLayoutEffect(() => {
    if (pathname && routeIsReady) complete(pathname);
  }, [complete, pathname, routeIsReady]);

  return null;
};
