import "./App.css";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react"; // <-- import the hook from our React package
import Home from "./pages/Home";
import Controller from "./pages/Controller/Controller";
import Presentation from "./pages/Projector";
import Monitor from "./pages/Monitor";
import Stream from "./pages/Stream";
import { Provider } from "react-redux";
import store from "./store/store";
import GlobalInfoProvider from "./context/globalInfo";
import Login from "./pages/Login";

gsap.registerPlugin(useGSAP);

function App() {
  return (
    <Provider store={store}>
      <Router>
        <GlobalInfoProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/controller/*" element={<Controller />} />
            <Route path="/presentation" element={<Presentation />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/stream" element={<Stream />} />
            <Route path="/login" element={<Login />} />
          </Routes>
        </GlobalInfoProvider>
      </Router>
    </Provider>
  );
}

export default App;
