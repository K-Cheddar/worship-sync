import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { HashRouter } from "react-router-dom";
import Resources from "../src/pages/Resources";
import { GlobalInfoContext } from "../src/context/globalInfo";
import { ControllerInfoContext } from "../src/context/controllerInfo";
import { TransferProvider } from "../src/context/transferContext";
import type { ChurchResource } from "../src/types/churchResource";
import "../src/index.css";

const date = "2026-10-20T12:00:00Z";
export const resources: ChurchResource[] = [
  ["June-2026-by-date.pdf", "application/pdf", "document"],
  ["Very-long-service-guidelines-with-an-unbroken-filename-".repeat(4) + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
  ["Budget.csv", "text/csv", "document"],
  ["Sunday presentation.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "document"],
  ["Announcements.txt", "text/plain", "document"],
  ["Service image.jpg", "image/jpeg", "image"],
  ["Christian_Hymn_Praise.mp3", "audio/mpeg", "audio"],
  ["Welcome video.mp4", "video/mp4", "other"],
  ["Archive.unknown", "application/octet-stream", "other"],
].map(([name, contentType, kind], index) => ({
  id: String(index), churchId: "fixture", name, kind: kind as ChurchResource["kind"],
  createdAt: date, createdBy: "fixture", updatedAt: date, updatedBy: "fixture",
  storage: { key: String(index), fileName: name, contentType, sizeBytes: 25000, uploadedAt: date },
}));
resources.push({ id: "link", churchId: "fixture", name: "Worship flow", kind: "other", sourceType: "external", external: { url: "https://example.test", provider: "google-drive", mediaType: "web" }, createdAt: date, createdBy: "fixture", updatedAt: date, updatedBy: "fixture" });
// Make fixtures available to the API boundary stub without initializing the application server.
Object.assign(window, { resourceFixtures: resources });
const state = { allDocs: { allSongDocs: [] }, undoable: { present: { preferences: { scrollbarWidth: 8 } } } };
const store = configureStore({ reducer: () => state });
const access = new URLSearchParams(location.search).get("access") || "full";
createRoot(document.getElementById("root")!).render(<Provider store={store}><HashRouter><TransferProvider><GlobalInfoContext.Provider value={{ churchId: "fixture", churchName: "Fixture Church", access, loginState: "success", sessionKind: "human" } as never}><ControllerInfoContext.Provider value={{ db: {} } as never}><Resources /></ControllerInfoContext.Provider></GlobalInfoContext.Provider></TransferProvider></HashRouter></Provider>);
