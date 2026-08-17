import "./App.css";
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import Home from "./pages/Home";
import AppEntry from "./pages/AppEntry";
import { Provider } from "react-redux";
import store from "./store/store";
import Login from "./pages/Login";
import ControllerContextWrapper from "./ControllerContextWrapper";
import GlobalInfoProvider from "./context/globalInfo";
import { ToastProvider } from "./context/toastContext";
import TimerManager from "./components/TimerManager/TimerManager";
import RoutePersistence from "./components/RoutePersistence/RoutePersistence";
import DisplayOutputsSync from "./components/DisplayOutputsSync/DisplayOutputsSync";
import { Suspense, useContext, useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { delay } from "./utils/generalUtils";
import ErrorBoundary from "./components/ErrorBoundary";
import { FloatingWindowZIndexProvider } from "./components/FloatingWindow/FloatingWindowZIndexContext";
import AuthGate from "./components/AuthGate";
import AuthScreenMain from "./components/AuthScreenMain";
import ViewAccessBlockedRedirect from "./components/ViewAccessBlockedRedirect/ViewAccessBlockedRedirect";
import { GlobalInfoContext } from "./context/globalInfo";
import WorshipSyncIcon from "./assets/WorshipSyncIconNoBg.png";
import { getAuthBootstrapLoadingDescription } from "./utils/authUserMessages";
import TeamsAccessGuard from "./components/TeamsAccessGuard";
import { lazyRoute } from "./utils/lazyRoute";
import { ChatProvider } from "./chat/ChatContext";
import ChatWindowHost from "./chat/ChatWindowHost";

/**
 * Route-level code splitting.
 *
 * The presentation surfaces pull in the heavy rendering stack (DisplayWindow,
 * hls.js, tiptap, jspdf). Someone opening a service plan or practice playlist on
 * a phone should not download that first, so each route below is its own chunk.
 * `Home`, `AppEntry`, and `Login` stay eager: they are the common landing
 * surfaces and a chunk hop there would show a blank frame on first paint.
 *
 * The grouping is the presentation/operator vs planning/people line, so this is
 * also the seam to split on if these ever become two apps.
 *
 * `lazyRoute` (not bare `lazy`) recovers from stale chunk names after a deploy.
 */

// Presentation / operator
const Controller = lazyRoute(() => import("./pages/Controller/Controller"));
const CurrentServiceWorkspace = lazyRoute(
  () => import("./pages/Controller/CurrentServiceWorkspace"),
);
const OverlayController = lazyRoute(
  () => import("./pages/OverlayController/OverlayController"),
);
const Projector = lazyRoute(() => import("./pages/Projector"));
const ProjectorFull = lazyRoute(() => import("./pages/ProjectorFull"));
const Monitor = lazyRoute(() => import("./pages/Monitor"));
const Stream = lazyRoute(() => import("./pages/Stream"));
const StreamInfo = lazyRoute(() => import("./pages/StreamInfo"));
const Credits = lazyRoute(() => import("./pages/Credits"));
const CreditsEditor = lazyRoute(
  () => import("./pages/CreditsEditor/CreditsEditor"),
);
const BoardController = lazyRoute(() => import("./pages/BoardController"));
const BoardDisplay = lazyRoute(() => import("./pages/BoardDisplay"));
const BoardPage = lazyRoute(() => import("./pages/BoardPage"));
const BoardPresent = lazyRoute(() => import("./pages/BoardPresent"));
const LocalVideoCaptureHost = lazyRoute(
  () => import("./pages/LocalVideoCaptureHost"),
);

// Planning / people
const Chat = lazyRoute(() => import("./pages/Chat"));
const MySchedule = lazyRoute(() => import("./pages/MySchedule"));
const Account = lazyRoute(() => import("./pages/Account"));
const TeamsAndServices = lazyRoute(
  () => import("./pages/Teams/TeamsAndServices"),
);
const ScheduleResponsePublic = lazyRoute(
  () => import("./pages/Teams/ScheduleResponsePublic"),
);
const TeamIntakePublic = lazyRoute(
  () => import("./pages/Teams/TeamIntakePublic"),
);
const TeamSchedulePublic = lazyRoute(
  () => import("./pages/Teams/TeamSchedulePublic"),
);
const ServicePublic = lazyRoute(() => import("./pages/ServicePublic"));

// Auth / pairing side trips
const DesktopSsoComplete = lazyRoute(
  () => import("./pages/DesktopSsoComplete"),
);
const RestreamConnectComplete = lazyRoute(
  () => import("./pages/RestreamConnectComplete"),
);
const YouTubeConnectComplete = lazyRoute(
  () => import("./pages/YouTubeConnectComplete"),
);
const CanvaConnectComplete = lazyRoute(
  () => import("./pages/CanvaConnectComplete"),
);
const WorkstationPair = lazyRoute(() => import("./pages/WorkstationPair"));
const WorkstationOperator = lazyRoute(
  () => import("./pages/WorkstationOperator"),
);
const InviteAccept = lazyRoute(() => import("./pages/InviteAccept"));
const PasswordReset = lazyRoute(() => import("./pages/PasswordReset"));
const RecoveryConfirm = lazyRoute(() => import("./pages/RecoveryConfirm"));
const PrivacyPolicy = lazyRoute(() => import("./pages/Legal/PrivacyPolicy"));
const TermsOfService = lazyRoute(() => import("./pages/Legal/TermsOfService"));

gsap.registerPlugin(useGSAP, ScrollToPlugin);
gsap.ticker.lagSmoothing(0);

/** Connecting splash on entry and board/controller surfaces; display windows stay blank until ready. */
const isTeamsAdminRoute = (pathname: string) => {
  if (pathname === "/teams-and-services") return true;
  return [
    "/teams-and-services/schedules",
    "/teams-and-services/members",
    "/teams-and-services/positions",
    "/teams-and-services/groups",
    "/teams-and-services/forms",
    "/teams-and-services/plans",
    "/teams-and-services/templates",
    "/teams-and-services/service-settings",
  ].some(
    (adminPath) =>
      pathname === adminPath || pathname.startsWith(`${adminPath}/`),
  );
};

const isBootstrapSplashRoute = (pathname: string) => {
  /** Root entry: avoid flashing the entry screen before Navigate (e.g. workstation → operator). */
  if (pathname === "/" || pathname === "") return true;
  if (pathname === "/home") return true;
  if (pathname === "/current-service") return true;
  if (pathname.startsWith("/controller")) return true;
  if (pathname === "/overlay-controller") return true;
  if (pathname === "/boards/controller") return true;
  if (pathname === "/boards/display") return true;
  if (pathname === "/credits-editor") return true;
  if (isTeamsAdminRoute(pathname)) return true;
  if (
    pathname === "/workstation/pair" ||
    pathname === "/workstation/operator"
  ) {
    return true;
  }
  return false;
};

const isTransparentDisplayRoute = (pathname: string) => {
  if (pathname === "/projector") return true;
  if (pathname === "/projector-full") return true;
  if (pathname === "/monitor") return true;
  if (pathname === "/stream") return true;
  if (pathname === "/stream-info") return true;
  if (pathname === "/credits") return true;
  if (pathname === "/boards/display") return true;
  if (pathname.startsWith("/boards/present/")) return true;
  return false;
};

const HOMEPAGE_CANVAS_COLOR = "#2b3544";

/** Compat redirect: the admin shell used to live at "/teams" (renamed to
 * "/teams-and-services" since it covers both roster/scheduling and service
 * planning now) — old bookmarks/links still land on the right page. Public
 * links under "/teams/intake" and "/teams/schedule" are unaffected; they're
 * registered as their own routes and unrelated to this admin shell. */
const RedirectLegacyTeamsPath = () => {
  const location = useLocation();
  return (
    <Navigate
      to={`/teams-and-services${location.pathname.slice("/teams".length)}${location.search}`}
      replace
    />
  );
};

const BootstrapSplash = () => {
  const context = useContext(GlobalInfoContext);
  const description = getAuthBootstrapLoadingDescription(
    context?.authServerStatus ?? "checking",
    { retryCount: context?.authServerRetryCount ?? 0 },
  );
  return (
    <AuthScreenMain>
      <div className="flex max-w-md flex-col items-center gap-6">
        <img
          src={WorshipSyncIcon}
          alt=""
          className="h-28 w-28 animate-pulse"
          width={112}
          height={112}
        />
        <p
          className="text-center text-sm leading-relaxed text-gray-200"
          aria-live="polite"
        >
          {description}
        </p>
      </div>
    </AuthScreenMain>
  );
};

/**
 * Shown while a route chunk loads. Deliberately text-free so it reads as a
 * continuation of {@link BootstrapSplash} rather than a second loading state.
 */
const RouteChunkSplash = () => (
  // `route-chunk-splash` holds this invisible for 200ms, so a chunk served from
  // the precache never flashes it. See globals.css.
  <div className="route-chunk-splash">
    <AuthScreenMain>
      <img
        src={WorshipSyncIcon}
        alt=""
        className="h-28 w-28 animate-pulse"
        width={112}
        height={112}
      />
    </AuthScreenMain>
  </div>
);

const AppRoutes = () => {
  const context = useContext(GlobalInfoContext);
  const location = useLocation();

  useLayoutEffect(() => {
    const routeNeedsTransparentCanvas = isTransparentDisplayRoute(
      location.pathname,
    );
    const canvasColor = routeNeedsTransparentCanvas
      ? "transparent"
      : HOMEPAGE_CANVAS_COLOR;
    const root = document.getElementById("root");

    document.body.style.backgroundColor = canvasColor;
    if (root) {
      root.style.backgroundColor = canvasColor;
    }
  }, [location.pathname]);

  const showBootstrapSplash =
    context?.bootstrapStatus === "loading" &&
    isBootstrapSplashRoute(location.pathname);

  if (showBootstrapSplash) {
    return <BootstrapSplash />;
  }

  // Display surfaces stay blank (and transparent — the stream composites over
  // it) while their chunk loads. A splash there would flash on the projector or
  // into a live stream.
  const chunkFallback = isTransparentDisplayRoute(location.pathname) ? null : (
    <RouteChunkSplash />
  );

  return (
    <ErrorBoundary>
      <Suspense fallback={chunkFallback}>
        <Routes>
          <Route element={<ControllerContextWrapper />}>
            <Route path="/" element={<AppEntry />} />
            <Route
              path="/home"
              element={
                <AuthGate allowedKinds={["human", "workstation"]} allowGuest>
                  <Home />
                </AuthGate>
              }
            />
            <Route
              path="/controller/*"
              element={
                <AuthGate allowedKinds={["human", "workstation"]} allowGuest>
                  <Controller />
                </AuthGate>
              }
            />
            <Route
              path="/current-service"
              element={
                <AuthGate allowedKinds={["human", "workstation"]}>
                  <TeamsAccessGuard>
                    <CurrentServiceWorkspace />
                  </TeamsAccessGuard>
                </AuthGate>
              }
            />
            <Route
              path="/overlay-controller"
              element={
                <AuthGate allowedKinds={["human", "workstation"]} allowGuest>
                  <OverlayController />
                </AuthGate>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route
              path="/login/desktop-sso-complete"
              element={<DesktopSsoComplete />}
            />
            <Route
              path="/restream/connect-complete"
              element={<RestreamConnectComplete />}
            />
            <Route
              path="/youtube/connect-complete"
              element={<YouTubeConnectComplete />}
            />
            <Route
              path="/canva/connect-complete"
              element={<CanvaConnectComplete />}
            />
            <Route path="/invite" element={<InviteAccept />} />
            <Route path="/auth/reset" element={<PasswordReset />} />
            <Route path="/recovery/confirm" element={<RecoveryConfirm />} />
            <Route
              path="/workstation/pair"
              element={<WorkstationPair lockedPairType="workstation" />}
            />
            <Route
              path="/display/pair"
              element={<WorkstationPair lockedPairType="display" />}
            />
            {/* The one Teams surface reachable with `teams: "none"`, so it is
              gated on being signed in rather than on a teams permission. */}
            <Route
              path="/my-schedule"
              element={
                <AuthGate allowedKinds={["human"]}>
                  <MySchedule />
                </AuthGate>
              }
            />
            <Route
              path="/chat"
              element={
                <AuthGate allowedKinds={["human", "workstation"]}>
                  <Chat />
                </AuthGate>
              }
            />
            <Route
              path="/account/*"
              element={
                <AuthGate allowedKinds={["human"]}>
                  <Account />
                </AuthGate>
              }
            />
            <Route
              path="/teams-and-services/*"
              element={
                <AuthGate allowedKinds={["human"]}>
                  <TeamsAccessGuard>
                    <TeamsAndServices />
                  </TeamsAccessGuard>
                </AuthGate>
              }
            />
            <Route path="/teams/intake/:token" element={<TeamIntakePublic />} />
            <Route path="/teams/intake" element={<TeamIntakePublic />} />
            <Route
              path="/schedule-response/:token"
              element={<ScheduleResponsePublic />}
            />
            <Route
              path="/teams/schedule/:token"
              element={<TeamSchedulePublic />}
            />
            <Route path="/teams/*" element={<RedirectLegacyTeamsPath />} />
            <Route path="/services/:shareId" element={<ServicePublic />} />
            <Route
              path="/workstation/operator"
              element={<WorkstationOperator />}
            />
            <Route
              path="/credits-editor"
              element={
                <AuthGate allowedKinds={["human", "workstation"]} allowGuest>
                  <CreditsEditor />
                </AuthGate>
              }
            />
          </Route>
          <Route
            path="/boards/controller"
            element={
              <AuthGate allowedKinds={["human", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <BoardController />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/boards/display"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <BoardDisplay />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          {/* Public share links (buildBoardPublicUrl) — no WorshipSync session required */}
          <Route path="/boards/:aliasId" element={<BoardPage />} />
          <Route path="/boards/present/:aliasId" element={<BoardPresent />} />
          <Route
            path="/projector"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <Projector />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/projector-full"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <ProjectorFull />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/monitor"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <Monitor />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/stream"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <Stream />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/stream-info"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <StreamInfo />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/credits"
            element={
              <AuthGate allowedKinds={["human", "display", "workstation"]}>
                <ViewAccessBlockedRedirect>
                  <Credits />
                </ViewAccessBlockedRedirect>
              </AuthGate>
            }
          />
          <Route
            path="/local-video-capture-host"
            element={<LocalVideoCaptureHost />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  useEffect(() => {
    const url = new URL(window.location.href);
    delay(1000);

    if (url.searchParams.has("cacheBust")) {
      // Remove the param
      url.searchParams.delete("cacheBust");

      // Replace the current history entry without reloading
      window.history.replaceState({}, document.title, url.toString());
    }
  }, []);
  const isElectronCaptureHost =
    Boolean(window.__ELECTRON__) &&
    window.location.hash.startsWith("#/local-video-capture-host");
  return (
    <Provider store={store}>
      <Router>
        <GlobalInfoProvider>
          {isElectronCaptureHost ? (
            <Suspense fallback={null}>
              <LocalVideoCaptureHost />
            </Suspense>
          ) : (
            <FloatingWindowZIndexProvider>
              <ToastProvider>
                <ChatProvider>
                  <RoutePersistence />
                  <DisplayOutputsSync />
                  <TimerManager />
                  <AppRoutes />
                  <ChatWindowHost />
                </ChatProvider>
              </ToastProvider>
            </FloatingWindowZIndexProvider>
          )}
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
};

export default App;
