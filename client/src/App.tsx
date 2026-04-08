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
import ControllerContextWrapper from "./ControllerContextWrapper";
import GlobalInfoProvider from "./context/globalInfo";
import { ToastProvider } from "./context/toastContext";
import Credits from "./pages/Credits";
import ProjectorFull from "./pages/ProjectorFull";
import CreditsEditor from "./pages/CreditsEditor/CreditsEditor";
import TimerManager from "./components/TimerManager/TimerManager";
import StreamInfo from "./pages/StreamInfo";
import InfoController from "./pages/InfoController";
import BoardController from "./pages/BoardController";
import BoardDisplay from "./pages/BoardDisplay";
import BoardPage from "./pages/BoardPage";
import BoardPresent from "./pages/BoardPresent";
import RoutePersistence from "./components/RoutePersistence/RoutePersistence";
import { useContext, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { delay } from "./utils/generalUtils";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthGate from "./components/AuthGate";
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

/** Connecting splash on setup and board/controller surfaces; display windows stay blank until ready. */
const isBootstrapSplashRoute = (pathname: string) => {
  if (pathname === "/home") return true;
  if (pathname.startsWith("/controller")) return true;
  if (pathname === "/overlay-controller") return true;
  if (pathname === "/boards/controller") return true;
  if (pathname === "/boards/display") return true;
  if (pathname === "/credits-editor" || pathname === "/info-controller") return true;
  if (pathname === "/workstation/pair" || pathname === "/workstation/operator") {
    return true;
  }
  return false;
};

const BootstrapSplash = () => {
  const context = useContext(GlobalInfoContext);
  const description = getAuthBootstrapLoadingDescription(
    context?.authServerStatus ?? "checking",
    { retryCount: context?.authServerRetryCount ?? 0 }
  );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-700 px-6 text-white">
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
    </main>
  );
};

const AppRoutes = () => {
  const context = useContext(GlobalInfoContext);
  const location = useLocation();
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
          <Route
            path="/info-controller"
            element={
              <AuthGate allowedKinds={["human", "workstation"]} allowGuest>
                <ViewAccessBlockedRedirect>
                  <InfoController />
                </ViewAccessBlockedRedirect>
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
            <AuthGate allowedKinds={["human", "display"]}>
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
            <AuthGate allowedKinds={["human", "display"]}>
              <ViewAccessBlockedRedirect>
                <Projector />
              </ViewAccessBlockedRedirect>
            </AuthGate>
          }
        />
        <Route
          path="/projector-full"
          element={
            <AuthGate allowedKinds={["human", "display"]}>
              <ViewAccessBlockedRedirect>
                <ProjectorFull />
              </ViewAccessBlockedRedirect>
            </AuthGate>
          }
        />
        <Route
          path="/monitor"
          element={
            <AuthGate allowedKinds={["human", "display"]}>
              <ViewAccessBlockedRedirect>
                <Monitor />
              </ViewAccessBlockedRedirect>
            </AuthGate>
          }
        />
        <Route
          path="/stream"
          element={
            <AuthGate allowedKinds={["human", "display"]}>
              <ViewAccessBlockedRedirect>
                <Stream />
              </ViewAccessBlockedRedirect>
            </AuthGate>
          }
        />
        <Route
          path="/stream-info"
          element={
            <AuthGate allowedKinds={["human", "display"]}>
              <ViewAccessBlockedRedirect>
                <StreamInfo />
              </ViewAccessBlockedRedirect>
            </AuthGate>
          }
        />
        <Route
          path="/credits"
          element={
            <AuthGate allowedKinds={["human", "display"]}>
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
          <ToastProvider>
            <RoutePersistence />
            <TimerManager />
            <AppRoutes />
          </ToastProvider>
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
};

export default App;
