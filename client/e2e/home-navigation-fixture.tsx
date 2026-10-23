import { createRoot } from "react-dom/client";
import { useLayoutEffect } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { HashRouter, useLocation } from "react-router-dom";
import { AppRoutes } from "../src/App";
import { GlobalInfoContext } from "../src/context/globalInfo";
import { controllerProfilesSlice, setControllerProfilesForChurch } from "../src/store/controllerProfilesSlice";
import { displayOutputsSlice, setDisplayOutputsForChurch } from "../src/store/displayOutputsSlice";
import { getDefaultControllerProfiles } from "../src/utils/controllerProfiles";
import { getDefaultDisplayOutputs } from "../src/utils/displayOutputs";
import { writeHomeNavigationMetadata } from "../src/pages/home/homeNavigationCache";
import "../src/index.css";

const churchId = "home-navigation-browser-fixture";
const query = new URLSearchParams(window.location.search);
const session = query.get("session") ?? "human";
const delayedSync = query.get("delaySync") === "1";
const store = configureStore({
  reducer: {
    controllerProfiles: controllerProfilesSlice.reducer,
    displayOutputs: displayOutputsSlice.reducer,
  },
});

const defaultProfiles = getDefaultControllerProfiles();
const profiles = [
  { ...defaultProfiles[0], name: "Text Master", order: 1, homeIcon: { source: "tabler" as const, name: "device-desktop", color: "#7dd3fc" } },
  { ...defaultProfiles[1], name: "Overlays", order: 0 },
  {
    id: "ctrl_lobby",
    type: "aux-presentation" as const,
    name: "Lobby Screens",
    description: "",
    order: 2,
    enabled: true,
    icon: "monitor" as const,
    iconColor: "cyan" as const,
    outputIds: [],
    outputsConfigured: true,
    defaultSendOutputIds: [],
    outlineScope: "ctrl_lobby",
  },
];
const displays = [
  ...getDefaultDisplayOutputs(),
  { id: "out_sanctuary", type: "projector" as const, name: "Sanctuary", order: 5, enabled: true },
];

const setLiveMetadata = () => {
  const updatedProfiles = delayedSync
    ? profiles.map((profile) => profile.id === "presentation"
      ? { ...profile, name: "Presentation Operator" }
      : profile)
    : profiles;
  store.dispatch(setControllerProfilesForChurch({ churchId, data: updatedProfiles }));
  store.dispatch(setDisplayOutputsForChurch({ churchId, data: displays }));
  (window as Window & { __homeMetadataResolvedAt?: number }).__homeMetadataResolvedAt = performance.now();
};

if (delayedSync) {
  writeHomeNavigationMetadata({
    churchId,
    controllers: profiles.map(({ id, name, icon, iconColor, homeIcon, order }) => ({
      id,
      name,
      icon,
      iconColor,
      homeIcon,
      order,
    })),
    displays: displays.map(({ id, name, type, order }) => ({ id, name, type, order })),
  }, window.localStorage);
  window.setTimeout(setLiveMetadata, 1_800);
} else {
  setLiveMetadata();
}

const globalInfo = {
  user: "browser-test-user",
  userId: "browser-test-user-id",
  firebaseDb: null,
  loginState: session === "guest" ? "guest" : session === "public" ? "idle" : "success",
  bootstrapStatus: "ready",
  authServerStatus: "online",
  authServerRetryCount: 0,
  sessionKind: session === "guest" || session === "public" ? null : session,
  churchId,
  churchName: "Browser fixture",
  database: "browser-fixture",
  role: session === "guest" ? "member" : "admin",
  access: "full",
  controllerAccess: "full",
  permissions: { teams: "edit" },
  canViewTeams: true,
  canViewServices: true,
  canEditTeams: true,
  canEditServices: true,
  hasBroadTeamsReadAccess: true,
  canUseTeamsLiveSync: true,
  operatorName: session === "workstation" ? "Fixture operator" : "",
  exitGuestMode: () => undefined,
  logout: () => undefined,
  refreshAuthBootstrap: async () => undefined,
};

const RouteObservation = () => {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const target = window as Window & {
      __homeRouteObservations?: Array<Record<string, unknown>>;
    };
    target.__homeRouteObservations ??= [];
    const page = document.querySelector<HTMLElement>(
      "#root [data-testid='home-content'], #root [data-testid='fixture-route'], #root [data-testid='public-entry']",
    );
    const rect = page?.getBoundingClientRect();
    const style = page ? getComputedStyle(page) : null;
    const splash = document.querySelector<HTMLElement>("#root .route-chunk-splash");
    target.__homeRouteObservations.push({
      at: performance.now(),
      pathname,
      pageTestId: page?.dataset.testid ?? null,
      pageVisible: Boolean(page && style?.display !== "none" && style?.visibility !== "hidden" && rect && rect.height > 0),
      routeSplashVisible: Boolean(splash && getComputedStyle(splash).visibility !== "hidden"),
    });
  }, [pathname]);
  return null;
};

const routeFrames: Array<Record<string, unknown>> = [];
const sampleRouteFrame = () => {
  const page = document.querySelector<HTMLElement>(
    "#root [data-testid='home-content'], #root [data-testid='fixture-route'], #root [data-testid='public-entry']",
  );
  const rect = page?.getBoundingClientRect();
  const style = page ? getComputedStyle(page) : null;
  routeFrames.push({
    at: performance.now(),
    hash: window.location.hash,
    pathname: window.location.hash.slice(1).split("?")[0] || "/",
    pageTestId: page?.dataset.testid ?? null,
    pageVisible: Boolean(page && style?.display !== "none" && style?.visibility !== "hidden" && rect && rect.height > 0),
  });
  requestAnimationFrame(sampleRouteFrame);
};
const browserWindow = window as Window & {
  __homeRouteFrames: Array<Record<string, unknown>>;
  __homeHashHistory: Array<{ at: number; hash: string; kind: string }>;
  __controllerWrapperMounts?: number;
};
browserWindow.__homeRouteFrames = routeFrames;
browserWindow.__homeHashHistory = [];
const recordHashChange = (kind: string) => {
  browserWindow.__homeHashHistory.push({ at: performance.now(), hash: window.location.hash, kind });
};
window.addEventListener("hashchange", () => recordHashChange("hashchange"));
const originalPushState = window.history.pushState.bind(window.history);
const originalReplaceState = window.history.replaceState.bind(window.history);
window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
  const result = originalPushState(...args);
  recordHashChange("pushState");
  return result;
}) as History["pushState"];
window.history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
  const result = originalReplaceState(...args);
  recordHashChange("replaceState");
  return result;
}) as History["replaceState"];
requestAnimationFrame(sampleRouteFrame);

const root = createRoot(document.getElementById("root")!);
root.render(
  <Provider store={store}>
    <GlobalInfoContext.Provider value={globalInfo as never}>
      <HashRouter>
        <RouteObservation />
        <AppRoutes />
      </HashRouter>
    </GlobalInfoContext.Provider>
  </Provider>,
);
