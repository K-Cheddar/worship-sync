import { getDisplayHomePath } from "./displaySurface";

type LoginState =
  | "idle"
  | "loading"
  | "error"
  | "success"
  | "guest"
  | null
  | undefined;

type SessionKind = "human" | "workstation" | "display" | null | undefined;
type Access = "full" | "music" | "view" | null | undefined;

type RouteSessionContext = {
  loginState?: LoginState;
  sessionKind?: SessionKind;
  access?: Access;
  operatorName?: string | null;
  displaySurfaceType?: string | null;
};

const GUEST_ALLOWED_PREFIXES = ["/controller"];
const GUEST_ALLOWED_EXACT = new Set([
  "/home",
  "/overlay-controller",
  "/credits-editor",
  "/info-controller",
]);

const HUMAN_ALLOWED_PREFIXES = ["/controller"];
const HUMAN_ALLOWED_EXACT = new Set([
  "/home",
  "/account",
  "/overlay-controller",
  "/workstation/pair",
  "/display/pair",
  "/credits-editor",
  "/info-controller",
  "/boards/controller",
  "/boards/display",
  "/projector",
  "/projector-full",
  "/monitor",
  "/stream",
  "/stream-info",
  "/credits",
]);

const WORKSTATION_ALLOWED_PREFIXES = ["/controller"];

/** Output / audience surfaces a workstation may open before an operator name is set. */
export const WORKSTATION_DISPLAY_SURFACE_EXACT = new Set([
  "/projector",
  "/projector-full",
  "/monitor",
  "/stream",
  "/stream-info",
  "/credits",
  "/boards/display",
]);

export const isWorkstationDisplaySurfacePath = (pathname: string): boolean =>
  WORKSTATION_DISPLAY_SURFACE_EXACT.has(pathname);

const WORKSTATION_ALLOWED_EXACT = new Set([
  "/home",
  "/overlay-controller",
  "/credits-editor",
  "/info-controller",
  "/boards/controller",
  "/workstation/operator",
  "/workstation/pair",
  ...WORKSTATION_DISPLAY_SURFACE_EXACT,
]);

const DISPLAY_ALLOWED_EXACT = new Set([
  "/projector",
  "/projector-full",
  "/monitor",
  "/stream",
  "/stream-info",
  "/credits",
  "/boards/display",
  "/display/pair",
]);

const VIEW_BLOCKED_EXACT = new Set([
  "/info-controller",
  "/boards/controller",
  "/boards/display",
  "/projector",
  "/projector-full",
  "/monitor",
  "/stream",
  "/stream-info",
  "/credits",
]);

/** Paths that only members with full app access may open (human / workstation). */
export const FULL_ACCESS_ONLY_EXACT = new Set(["/boards/controller"]);

const matchesAllowedRoute = (
  pathname: string,
  exactPaths: Set<string>,
  prefixes: string[] = []
) => exactPaths.has(pathname) || prefixes.some((prefix) => pathname.startsWith(prefix));

export const isRouteAllowedForSession = (
  pathname: string,
  context: RouteSessionContext
): boolean => {
  if (!pathname || pathname === "/") {
    return false;
  }

  if (context.loginState === "guest") {
    return matchesAllowedRoute(pathname, GUEST_ALLOWED_EXACT, GUEST_ALLOWED_PREFIXES);
  }

  if (context.sessionKind === "human") {
    if (!matchesAllowedRoute(pathname, HUMAN_ALLOWED_EXACT, HUMAN_ALLOWED_PREFIXES)) {
      return false;
    }
    if (context.access === "view" && VIEW_BLOCKED_EXACT.has(pathname)) {
      return false;
    }
    if (context.access !== "full" && FULL_ACCESS_ONLY_EXACT.has(pathname)) {
      return false;
    }
    return true;
  }

  if (context.sessionKind === "workstation") {
    if (!matchesAllowedRoute(pathname, WORKSTATION_ALLOWED_EXACT, WORKSTATION_ALLOWED_PREFIXES)) {
      return false;
    }
    if (context.access === "view" && VIEW_BLOCKED_EXACT.has(pathname)) {
      return false;
    }
    if (context.access !== "full" && FULL_ACCESS_ONLY_EXACT.has(pathname)) {
      return false;
    }
    return true;
  }

  if (context.sessionKind === "display") {
    return matchesAllowedRoute(pathname, DISPLAY_ALLOWED_EXACT);
  }

  return false;
};

export const getDefaultRouteForSession = (context: RouteSessionContext): string => {
  if (context.loginState === "guest") {
    return "/controller";
  }
  if (context.sessionKind === "human") {
    return "/home";
  }
  if (context.sessionKind === "workstation") {
    return context.operatorName?.trim() ? "/controller" : "/workstation/operator";
  }
  if (context.sessionKind === "display") {
    return getDisplayHomePath(context.displaySurfaceType || undefined);
  }
  return "/";
};

export const getAllowedRouteOrDefault = (
  pathname: string | null | undefined,
  context: RouteSessionContext
): string => {
  if (pathname && isRouteAllowedForSession(pathname, context)) {
    return pathname;
  }
  return getDefaultRouteForSession(context);
};
