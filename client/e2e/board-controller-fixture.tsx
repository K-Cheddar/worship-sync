import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import store from "../src/store/store";
import { GlobalInfoContext } from "../src/context/globalInfo";
import { ControllerInfoContext } from "../src/context/controllerInfo";
import { BoardControllerContent } from "../src/pages/BoardController";
import { ToastProvider } from "../src/context/toastContext";
import "../src/index.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <Provider store={store}>
    <GlobalInfoContext.Provider
      value={
        {
          database: "fixture",
          loginState: "success",
          churchId: "church-1",
          userId: "moderator-1",
          logout: () => {},
          churchIntegrations: {
            youtube: { connected: true, accountLabel: "Main channel" },
          },
        } as never
      }
    >
      <ControllerInfoContext.Provider value={{ setIsMobile: () => {} } as never}>
        <ToastProvider>
          <BoardControllerContent />
        </ToastProvider>
      </ControllerInfoContext.Provider>
    </GlobalInfoContext.Provider>
  </Provider>,
);
