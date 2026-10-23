import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Modal from "../src/components/Modal/Modal";

function ModalMobileFocusFixture() {
  const [open, setOpen] = useState(false);

  return (
    <div className="h-dvh w-dvw overflow-hidden bg-gray-900 text-white">
      <header className="h-12 border-b border-gray-600" style={{ height: 48 }}>Controller toolbar</header>
      <main id="controller-main" className="relative h-[calc(100dvh-3rem)] overflow-hidden" style={{ position: "relative", width: "100vw", height: "calc(100dvh - 3rem)", overflow: "hidden" }}>
        <div id="controller-scroll-area" className="h-full w-full overflow-auto" style={{ width: "100%", height: "100%", overflow: "auto" }}>
          <div className="relative h-[900px] w-[760px] bg-gray-800" style={{ position: "relative", width: 760, height: 900 }}>
            <button
              id="media-library-opener"
              type="button"
              className="absolute left-0 top-4"
              style={{ position: "absolute", left: 0, top: 16 }}
              onClick={() => {
                const scroller = document.getElementById("controller-scroll-area");
                if (scroller) {
                  scroller.scrollLeft = 120;
                  scroller.scrollTop = 12;
                }
                setOpen(true);
              }}
            >
              Media Library
            </button>
            <div className="absolute left-[420px] top-20">Controller content</div>
          </div>
        </div>
      </main>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Media Library"
        size="full"
        contentPadding="p-0"
        contentClassName="overflow-hidden"
      >
        <div className="h-full min-h-0 overflow-y-auto" role="region" aria-label="Media grid">
          {Array.from({ length: 30 }, (_, index) => <div key={index}>Media item {index + 1}</div>)}
        </div>
      </Modal>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<ModalMobileFocusFixture />);
