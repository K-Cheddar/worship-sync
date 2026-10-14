import { isPublicSharePathname } from "./publicSharePathRedirect";

/** Shared by startup and router fallbacks; actual output stages own their backgrounds. */
export const isTransparentDisplayRoute = (pathname: string): boolean => {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase();
  return (
    [
      "/stream", "/stream-info", "/projector", "/projector-full",
      "/monitor", "/credits", "/boards/display",
    ].includes(path) ||
    /^\/boards\/present\/[^/]+$/.test(path)
  );
};

/** Public links use BrowserRouter; the operator/Electron shell uses HashRouter. */
export const getInitialRoutePathname = (
  location: Pick<Location, "pathname" | "hash">,
): string => {
  if (isPublicSharePathname(location.pathname)) return location.pathname;
  return (location.hash.slice(1) || location.pathname).split(/[?#]/, 1)[0];
};
