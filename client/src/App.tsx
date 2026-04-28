import "./App.css";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import Home from "./pages/Home";
import AppEntry from "./pages/AppEntry";
import Controller from "./pages/Controller/Controller";
import OverlayController from "./pages/OverlayController/OverlayController";
import Projector from "./pages/Projector";
import Monitor from "./pages/Monitor";
import Stream from "./pages/Stream";
import { Provider } from "react-redux";
import store from "./store/store";
import Login from "./pages/Login";
import DesktopSsoComplete from "./pages/DesktopSsoComplete";
import ControllerContextWrapper from "./ControllerContextWrapper";
import GlobalInfoProvider from "./context/globalInfo";
import { ToastProvider } from "./context/toastContext";
import Credits from "./pages/Credits";
import ProjectorFull from "./pages/ProjectorFull";
import CreditsEditor from "./pages/CreditsEditor/CreditsEditor";
import TimerManager from "./components/TimerManager/TimerManager";
import StreamInfo from "./pages/StreamInfo";
import BoardController from "./pages/BoardController";
import BoardDisplay from "./pages/BoardDisplay";
import BoardPage from "./pages/BoardPage";
import BoardPresent from "./pages/BoardPresent";
import RoutePersistence from "./components/RoutePersistence/RoutePersistence";
import { useContext, useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { delay } from "./utils/generalUtils";
import ErrorBoundary from "./components/ErrorBoundary";
import { FloatingWindowZIndexProvider } from "./components/FloatingWindow/FloatingWindowZIndexContext";
import AuthGate from "./components/AuthGate";
import AuthScreenMain from "./components/AuthScreenMain";
import ViewAccessBlockedRedirect from "./components/ViewAccessBlockedRedirect/ViewAccessBlockedRedirect";
import WorkstationPair from "./pages/WorkstationPair";
import WorkstationOperator from "./pages/WorkstationOperator";
import InviteAccept from "./pages/InviteAccept";
import PasswordReset from "./pages/PasswordReset";
import RecoveryConfirm from "./pages/RecoveryConfirm";
import Account from "./pages/Account";
import { GlobalInfoContext } from "./context/globalInfo";
import WorshipSyncIcon from "./assets/WorshipSyncIconNoBg.png";
import { getAuthBootstrapLoadingDescription } from "./utils/authUserMessages";

gsap.registerPlugin(useGSAP, ScrollToPlugin);
gsap.ticker.lagSmoothing(0);

/** Connecting splash on entry and board/controller surfaces; display windows stay blank until ready. */
const isBootstrapSplashRoute = (pathname: string) => {
  /** Root entry: avoid flashing the entry screen before Navigate (e.g. workstation → operator). */
  if (pathname === "/" || pathname === "") return true;
  if (pathname === "/home") return true;
  if (pathname.startsWith("/controller")) return true;
  if (pathname === "/overlay-controller") return true;
  if (pathname === "/boards/controller") return true;
  if (pathname === "/boards/display") return true;
  if (pathname === "/credits-editor") return true;
  if (pathname === "/workstation/pair" || pathname === "/workstation/operator") {
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

const BootstrapSplash = () => {
  const context = useContext(GlobalInfoContext);
  const description = getAuthBootstrapLoadingDescription(
    context?.authServerStatus ?? "checking",
    { retryCount: context?.authServerRetryCount ?? 0 }
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

const AppRoutes = () => {
  const context = useContext(GlobalInfoContext);
  const location = useLocation();

  useLayoutEffect(() => {
    const routeNeedsTransparentCanvas = isTransparentDisplayRoute(location.pathname);
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

  return (
    <ErrorBoundary>
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
            path="/overlay-controller"
            element={
              <AuthGate allowedKinds={["human", "workstation"]} allowGuest>
                <OverlayController />
              </AuthGate>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route
            path="/login/desktop-sso-complete"
            element={<DesktopSsoComplete />}
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
          <Route
            path="/account"
            element={
              <AuthGate allowedKinds={["human"]}>
                <Account />
              </AuthGate>
            }
          />
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
      </Routes>
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
  return (
    <Provider store={store}>
      <Router>
        <GlobalInfoProvider>
          <FloatingWindowZIndexProvider>
          <ToastProvider>
            <RoutePersistence />
            <TimerManager />
            <AppRoutes />
          </ToastProvider>
          </FloatingWindowZIndexProvider>
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
};

export default App;
