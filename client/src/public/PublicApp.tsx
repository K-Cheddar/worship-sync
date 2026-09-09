import { Suspense, useLayoutEffect } from "react";
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { Provider } from "react-redux";
import ErrorBoundary from "../components/ErrorBoundary";
import GlobalInfoProvider from "../context/globalInfo";
import { ToastProvider } from "../context/toastContext";
import store from "../store/store";
import { lazyRoute } from "../utils/lazyRoute";

/**
 * Lean shell for path-based public share links (`/services/...`, boards, etc.).
 * Uses BrowserRouter so crawlers and humans share the same URL shape. The
 * operator app stays on HashRouter (Electron `file://` + multi-window).
 */

const ServicePublic = lazyRoute(() => import("../pages/ServicePublic"));
const ScheduleResponsePublic = lazyRoute(
  () => import("../pages/Teams/ScheduleResponsePublic"),
);
const TeamIntakePublic = lazyRoute(
  () => import("../pages/Teams/TeamIntakePublic"),
);
const TeamSchedulePublic = lazyRoute(
  () => import("../pages/Teams/TeamSchedulePublic"),
);
const BoardPage = lazyRoute(() => import("../pages/BoardPage"));
const BoardPresent = lazyRoute(() => import("../pages/BoardPresent"));
const InviteAccept = lazyRoute(() => import("../pages/InviteAccept"));

const PublicFallback = () => (
  <div
    className="flex min-h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-300"
    aria-busy="true"
  >
    Loading…
  </div>
);

/** Invite needs Firebase session helpers from GlobalInfo (+ Redux). */
const InviteProviderLayout = () => (
  <Provider store={store}>
    <GlobalInfoProvider>
      <Outlet />
    </GlobalInfoProvider>
  </Provider>
);

/** Unknown path under the public shell → operator entry (HashRouter). */
const LeaveToOperatorApp = () => {
  useLayoutEffect(() => {
    window.location.replace("/");
  }, []);
  return <PublicFallback />;
};

const PublicApp = () => (
  <BrowserRouter>
    <ToastProvider>
      <ErrorBoundary>
        <Suspense fallback={<PublicFallback />}>
          <Routes>
            <Route path="/services/:shareId" element={<ServicePublic />} />
            <Route
              path="/schedule-response/:token"
              element={<ScheduleResponsePublic />}
            />
            <Route
              path="/teams/schedule/:token"
              element={<TeamSchedulePublic />}
            />
            <Route path="/teams/intake/:token" element={<TeamIntakePublic />} />
            <Route path="/teams/intake" element={<TeamIntakePublic />} />
            <Route path="/boards/present/:aliasId" element={<BoardPresent />} />
            <Route path="/boards/:aliasId" element={<BoardPage />} />
            <Route element={<InviteProviderLayout />}>
              <Route path="/invite" element={<InviteAccept />} />
            </Route>
            <Route path="*" element={<LeaveToOperatorApp />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </ToastProvider>
  </BrowserRouter>
);

export default PublicApp;
