import { isPublicSharePathname } from "./publicSharePathRedirect";

/**
 * Navigate from the public BrowserRouter shell into the HashRouter operator app.
 * Prefer this over react-router `navigate("/home")` on public path URLs — those
 * paths are not operator routes inside BrowserRouter.
 */
export const assignOperatorAppLocation = (
  hashRoute: string,
  assign: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): void => {
  const trimmed = String(hashRoute || "").replace(/^#/, "");
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  assign(`/#${path}`);
};

/** True when the current document is the public path shell (not HashRouter). */
export const isPublicPathShell = (
  pathname: string = typeof window !== "undefined"
    ? window.location.pathname
    : "/",
): boolean => isPublicSharePathname(pathname);
