import "./App.css";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react"; // <-- import the hook from our React package
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

gsap.registerPlugin(useGSAP);

function App() {
  return (
    <Provider store={store}>
      <Router>
        <GlobalInfoProvider>
          <Routes>
            <Route element={<ControllerContextWrapper />}>
              <Route path="/" element={<Home />} />
              <Route path="/controller/*" element={<Controller />} />
              <Route path="/login" element={<Login />} />
            </Route>
            <Route path="/projector" element={<Projector />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/stream" element={<Stream />} />
          </Routes>
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
}

export default App;
