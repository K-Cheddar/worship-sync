import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ItemSlideType } from "../src/types";
import StaticSlideThumbnail from "../src/containers/ItemSlides/StaticSlideThumbnail";
import { useStaticThumbnailScaleFactor } from "../src/containers/ItemSlides/staticThumbnailGeometry";
import "../src/index.css";

const longCameraLabel =
  "Main camera from the worship hall with a deliberately long saved source name";

const unavailableSlide: ItemSlideType = {
  id: "unavailable-camera",
  name: "Unavailable camera",
  type: "Verse",
  boxes: [],
  mediaSource: {
    kind: "local-video-input",
    sourceId: "remote-camera",
    label: longCameraLabel,
    ownerDeviceId: "remote-device",
    ownerLabel: "Booth workstation with a long owner label",
  },
};

const savedStillSlide: ItemSlideType = {
  ...unavailableSlide,
  id: "saved-still-camera",
  name: "Saved still",
};

const App = () => {
  const [zoom, setZoom] = useState(3);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [thumbnailGrid, setThumbnailGrid] =
    useState<HTMLUListElement | null>(null);
  const columns = 5 - zoom;
  const scaleFactor = useStaticThumbnailScaleFactor(
    thumbnailGrid,
    columns,
    `${columns}`,
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-900 p-3 text-white">
      <div className="mb-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Thumbnail zoom
          <input
            aria-label="Thumbnail zoom"
            type="range"
            min={1}
            max={4}
            step={1}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((open) => !open)}
          className="rounded bg-slate-700 px-3 py-2"
        >
          {drawerOpen ? "Close controller drawer" : "Open controller drawer"}
        </button>
      </div>

      <ul
        ref={setThumbnailGrid}
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        data-testid="controller-slide-grid"
      >
        <li
          className="relative isolate min-w-0 rounded-lg"
          data-testid="unavailable-source-slide-tile"
        >
          <h2 className="truncate bg-slate-700 px-2 py-1 text-center text-sm">
            Unavailable camera
          </h2>
          <StaticSlideThumbnail
            slide={unavailableSlide}
            itemType="song"
            previewMode="projector"
            scaleFactor={scaleFactor}
          />
        </li>
        <li
          className="relative isolate min-w-0 rounded-lg"
          data-testid="saved-still-slide-tile"
        >
          <h2 className="truncate bg-slate-700 px-2 py-1 text-center text-sm">
            Saved capture still
          </h2>
          <StaticSlideThumbnail
            slide={savedStillSlide}
            itemType="song"
            previewMode="projector"
            scaleFactor={scaleFactor}
            localVideoInputThumbnailUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='16' height='9' fill='%23334155'/%3E%3C/svg%3E"
          />
        </li>
      </ul>

      {drawerOpen ? (
        <aside
          aria-label="Controller media drawer"
          data-testid="controller-drawer"
          className="absolute inset-y-0 right-0 z-10 flex w-[65%] flex-col bg-[#16a085] p-4 text-white shadow-xl"
        >
          <h2 className="text-lg font-semibold">Controller drawer</h2>
          <p className="mt-2">Drawer content stays above the slide grid.</p>
        </aside>
      ) : null}
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
