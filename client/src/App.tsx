import "./App.css";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import Home from "./pages/Home";
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
import RequireLogin from "./components/RequireLogin";
import { useEffect } from "react";
import { delay } from "./utils/generalUtils";
import ErrorBoundary from "./components/ErrorBoundary";

gsap.registerPlugin(useGSAP, ScrollToPlugin);
gsap.ticker.lagSmoothing(0);

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
            <ErrorBoundary>
              <Routes>
                <Route element={<ControllerContextWrapper />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/controller/*" element={<Controller />} />
                  <Route
                    path="/overlay-controller"
                    element={<OverlayController />}
                  />
                  <Route path="/login" element={<Login />} />
                  <Route path="/credits-editor" element={<CreditsEditor />} />
                  <Route path="/info-controller" element={<InfoController />} />
                </Route>
                <Route element={<RequireLogin />}>
                  <Route path="/boards/controller" element={<BoardController />} />
                </Route>
                <Route path="/boards/display" element={<BoardDisplay />} />
                <Route path="/boards/:aliasId" element={<BoardPage />} />
                <Route path="/boards/present/:aliasId" element={<BoardPresent />} />
                <Route path="/projector" element={<Projector />} />
                <Route path="/projector-full" element={<ProjectorFull />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/stream" element={<Stream />} />
                <Route path="/stream-info" element={<StreamInfo />} />
                <Route path="/credits" element={<Credits />} />
              </Routes>
            </ErrorBoundary>
          </ToastProvider>
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
};

export default App;
