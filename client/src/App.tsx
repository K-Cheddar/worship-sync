import "./App.css";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import Home from "./pages/Home";
import Controller from "./pages/Controller/Controller";
import Projector from "./pages/Projector";
import Monitor from "./pages/Monitor";
import Stream from "./pages/Stream";
import { Provider } from "react-redux";
import store from "./store/store";
import Login from "./pages/Login";
import ControllerContextWrapper from "./ControllerContextWrapper";
import GlobalInfoProvider from "./context/globalInfo";
import Credits from "./pages/Credits";
import ProjectorFull from "./pages/ProjectorFull";
import CreditsEditor from "./pages/CreditsEditor/CreditsEditor";
import TimerManager from "./components/TimerManager/TimerManager";

gsap.registerPlugin(useGSAP, ScrollToPlugin);
gsap.ticker.lagSmoothing(0);

const App: React.FC = () => {
  return (
    <Provider store={store}>
      <Router>
        <GlobalInfoProvider>
          <TimerManager />
          <Routes>
            <Route element={<ControllerContextWrapper />}>
              <Route path="/" element={<Home />} />
              <Route path="/controller/*" element={<Controller />} />
              <Route path="/login" element={<Login />} />
              <Route path="/credits-editor" element={<CreditsEditor />} />
            </Route>
            <Route path="/projector" element={<Projector />} />
            <Route path="/projector-full" element={<ProjectorFull />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/stream" element={<Stream />} />
            <Route path="/credits" element={<Credits />} />
          </Routes>
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
};

export default App;
