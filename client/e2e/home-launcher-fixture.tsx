import { createRoot } from "react-dom/client";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { HashRouter, Route, Routes } from "react-router-dom";
import Home from "../src/pages/Home";
import { GlobalInfoContext } from "../src/context/globalInfo";
import { controllerProfilesSlice, setControllerProfilesForChurch } from "../src/store/controllerProfilesSlice";
import { displayOutputsSlice, setDisplayOutputsForChurch } from "../src/store/displayOutputsSlice";
import { getDefaultControllerProfiles } from "../src/utils/controllerProfiles";
import { getDefaultDisplayOutputs } from "../src/utils/displayOutputs";
import "../src/index.css";

const churchId = "home-launcher-smoke-church";
const store = configureStore({
  reducer: {
    controllerProfiles: controllerProfilesSlice.reducer,
    displayOutputs: displayOutputsSlice.reducer,
  },
});

const defaultProfiles = getDefaultControllerProfiles();
store.dispatch(setControllerProfilesForChurch({
  churchId,
  data: [
    { ...defaultProfiles[0], name: "Text Master", order: 0 },
    { ...defaultProfiles[1], name: "Overlays", order: 1 },
    {
      id: "ctrl_lobby",
      type: "aux-presentation",
      name: "Lobby Screens",
      description: "",
      order: 2,
      enabled: true,
      icon: "monitor",
      iconColor: "cyan",
      outputIds: [],
      outputsConfigured: true,
      defaultSendOutputIds: [],
      outlineScope: "ctrl_lobby",
    },
  ],
}));

store.dispatch(setDisplayOutputsForChurch({
  churchId,
  data: [
    ...getDefaultDisplayOutputs(),
    {
      id: "out_sanctuary",
      type: "projector",
      name: "Sanctuary",
      order: 5,
      enabled: true,
    },
  ],
}));

const globalInfo = {
  churchId,
  loginState: "success",
  role: "admin",
  access: "full",
  sessionKind: "human",
  canViewTeams: true,
  canViewServices: true,
};

const root = createRoot(document.getElementById("root")!);
root.render(
  <Provider store={store}>
    <GlobalInfoContext.Provider value={globalInfo as never}>
      <HashRouter>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/controller" element={<main>Presentation controller route</main>} />
          <Route path="/overlay-controller" element={<main>Overlay controller route</main>} />
          <Route path="/current-service" element={<main>Service workspace route</main>} />
        </Routes>
      </HashRouter>
    </GlobalInfoContext.Provider>
  </Provider>,
);
