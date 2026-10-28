import { useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer/Drawer";

export type AllToolsTargets = {
  quickToolbar: HTMLElement | null;
  slideFormatting: HTMLElement | null;
  boxLayout: HTMLElement | null;
  streamFormatting: HTMLElement | null;
  outputTargets: HTMLElement | null;
};

type AllToolsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  isMobile: boolean;
  showStreamFormatting: boolean;
  showOutputTargets: boolean;
  children: (targets: AllToolsTargets) => ReactNode;
};

const AllToolsDrawer = ({
  isOpen,
  onClose,
  onToggle,
  isMobile,
  showStreamFormatting,
  showOutputTargets,
  children,
}: AllToolsDrawerProps) => {
  const [quickToolbar, setQuickToolbar] = useState<HTMLElement | null>(null);
  const [slideFormatting, setSlideFormatting] = useState<HTMLElement | null>(null);
  const [boxLayout, setBoxLayout] = useState<HTMLElement | null>(null);
  const [streamFormatting, setStreamFormatting] = useState<HTMLElement | null>(null);
  const [outputTargets, setOutputTargets] = useState<HTMLElement | null>(null);

  const targets = {
    quickToolbar,
    slideFormatting,
    boxLayout,
    streamFormatting,
    outputTargets,
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          className="min-w-0 flex-1 overflow-x-auto scrollbar-variable"
          data-testid="quick-editing-toolbar-scroll"
        >
          <div
            ref={setQuickToolbar}
            className="flex min-w-max items-center gap-2 px-2"
          />
        </div>
        <Button
          type="button"
          variant={isOpen ? "secondary" : "tertiary"}
          svg={Maximize2}
          aria-label="All Tools"
          aria-expanded={isOpen}
          onClick={onToggle}
          className="shrink-0"
        >
          All Tools
        </Button>
      </div>

      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="All Tools"
        position={isMobile ? "bottom" : "right"}
        size="xl"
        contentClassName="min-h-0 flex flex-col gap-6 overflow-y-auto"
      >
        <section className="flex flex-col gap-3 border-b border-gray-700 pb-5">
          <h2 className="text-base font-semibold">Slide Formatting</h2>
          <div ref={setSlideFormatting} className="flex flex-col gap-4" />
        </section>
        <section className="flex flex-col gap-3 border-b border-gray-700 pb-5">
          <h2 className="text-base font-semibold">Box &amp; Layout</h2>
          <div ref={setBoxLayout} className="flex flex-col gap-4" />
        </section>
        {showStreamFormatting && (
          <section className="flex flex-col gap-3 border-b border-gray-700 pb-5">
            <h2 className="text-base font-semibold">Stream Formatting</h2>
            <div ref={setStreamFormatting} className="flex flex-col gap-4" />
          </section>
        )}
        {showOutputTargets && (
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Output Targets</h2>
            <div ref={setOutputTargets} className="flex flex-col gap-4" />
          </section>
        )}
      </Drawer>

      {children(targets)}
    </>
  );
};

export default AllToolsDrawer;
