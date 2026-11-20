import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import "../src/index.css";
import ServicePublicView from "../src/pages/ServicePublicView";
import type { PublicServiceFlowSnapshot } from "../src/services/serviceFlowTypes";

const now = Date.now();
const startsAt = new Date(now + 60_000).toISOString();
const items = Array.from({ length: 120 }, (_, index) => {
  const number = index + 1;
  return {
    id: `stress-item-${number}`,
    title: `Stress item ${number}`,
    durationSeconds: 60,
    notes: {
      blocks: [{
        type: "paragraph" as const,
        spans: [{ text: `Demo note for service item ${number}.` }],
      }],
    },
    resources: [{
      type: "text",
      title: `Call sheet ${number}`,
      detail: `Representative demo details for call sheet ${number}.`,
    }],
  };
});

const snapshot: PublicServiceFlowSnapshot = {
  success: true,
  churchName: "Efficiency Demo Chapel",
  serverNowMs: now,
  service: {
    shareId: "service-public-efficiency-demo",
    viewMode: "team",
    title: "Efficiency Demo Service",
    startsAt,
    timezone: "UTC",
    revision: 1,
    sections: [{ id: "demo-order", title: "Order of Worship", items }],
    live: { mode: "schedule" },
  },
};

const FixtureRoutes = () => {
  const navigate = useNavigate();

  useEffect(() => {
    window.setServicePublicFixtureRoute = (path) => navigate(path);
    return () => {
      delete window.setServicePublicFixtureRoute;
    };
  }, [navigate]);

  return (
    <Routes>
      <Route path="/viewer" element={<ServicePublicView snapshot={snapshot} />} />
      <Route path="/home" element={<main><h1>Demo Home</h1></main>} />
      <Route path="*" element={<main><h1>Demo Home</h1></main>} />
    </Routes>
  );
};

declare global {
  interface Window {
    setServicePublicFixtureRoute?: (path: "/viewer" | "/home") => void;
  }
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/viewer"]}>
    <FixtureRoutes />
  </MemoryRouter>,
);
