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
import RemoteDbProvider from "./context/remoteDb";

gsap.registerPlugin(useGSAP);

function App() {
  return (
    <Provider store={store}>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/controller/*"
            element={
              <RemoteDbProvider>
                <Controller />
              </RemoteDbProvider>
            }
          />
          <Route path="/presentation" element={<Presentation />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/stream" element={<Stream />} />
        </Routes>
      </Router>
    </Provider>
  );
}

export default App;
