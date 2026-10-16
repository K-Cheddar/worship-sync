import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../src/context/toastContext";
import AccountPage from "../src/pages/Account";
import "../src/index.css";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <HashRouter>
      <Routes>
        <Route path="/account/*" element={<AccountPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </HashRouter>
  </ToastProvider>,
);
