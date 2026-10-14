import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "/src/context/toastContext";
import TeamsAndServices from "/src/pages/Teams/TeamsAndServices";
import "/src/index.css";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <HashRouter>
      <Routes>
        <Route path="/teams-and-services/*" element={<TeamsAndServices />} />
        <Route path="/home" element={<div>Home</div>} />
      </Routes>
    </HashRouter>
  </ToastProvider>,
);
