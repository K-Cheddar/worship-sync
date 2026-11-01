import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer/Drawer";

export type AllToolsTargets = {
  quickFontSize: HTMLElement | null;
  quickBoxLayout: HTMLElement | null;
  quickBoxHeight: HTMLElement | null;
  quickBrightness: HTMLElement | null;
  quickBibleMode: HTMLElement | null;
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
  showBibleMode: boolean;
  showStreamFormatting: boolean;
  showOutputTargets: boolean;
  children: (targets: AllToolsTargets) => ReactNode;
};

const AllToolsDrawer = ({
  isOpen,
  onClose,
  onToggle,
  isMobile,
  showBibleMode,
  showStreamFormatting,
  showOutputTargets,
  children,
}: AllToolsDrawerProps) => {
  const [quickFontSize, setQuickFontSize] = useState<HTMLElement | null>(null);
  const [quickBoxLayout, setQuickBoxLayout] = useState<HTMLElement | null>(null);
  const [quickBoxHeight, setQuickBoxHeight] = useState<HTMLElement | null>(null);
  const [quickBrightness, setQuickBrightness] = useState<HTMLElement | null>(null);
  const [quickBibleMode, setQuickBibleMode] = useState<HTMLElement | null>(null);
  const [slideFormatting, setSlideFormatting] = useState<HTMLElement | null>(null);
  const [boxLayout, setBoxLayout] = useState<HTMLElement | null>(null);
  const [streamFormatting, setStreamFormatting] = useState<HTMLElement | null>(null);
  const [outputTargets, setOutputTargets] = useState<HTMLElement | null>(null);

  const targets = {
    quickFontSize,
    quickBoxLayout,
    quickBoxHeight,
    quickBrightness,
    quickBibleMode,
    slideFormatting,
    boxLayout,
    streamFormatting,
    outputTargets,
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          className={isMobile ? "min-w-0 flex-1 overflow-x-auto scrollbar-variable" : "min-w-0 overflow-x-auto scrollbar-variable"}
          data-testid="quick-editing-toolbar-scroll"
        >
          <div
            className="flex min-w-max items-center gap-0.5 px-1"
            data-testid="quick-editing-toolbar-groups"
          >
            <div
              ref={setQuickFontSize}
              data-testid="quick-toolbar-font-size"
              className="flex shrink-0 items-center gap-1 px-1"
            />
            <div
              ref={setQuickBoxLayout}
              data-testid="quick-toolbar-box-layout"
              className="flex shrink-0 items-center gap-1 border-l border-gray-600 px-2"
            />
            <div
              ref={setQuickBoxHeight}
              data-testid="quick-toolbar-box-height"
              className="flex shrink-0 items-center gap-1 border-l border-gray-600 px-2"
            />
            <div
              ref={setQuickBrightness}
              data-testid="quick-toolbar-brightness"
              className="flex shrink-0 items-center gap-1 border-l border-gray-600 px-2"
            />
            {showBibleMode && (
              <div
                ref={setQuickBibleMode}
                data-testid="quick-toolbar-bible-mode"
                className="flex shrink-0 items-center gap-1 border-l border-gray-600 px-2"
              />
            )}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="h-8 shrink-0 border-l border-gray-600"
        />
        <Button
          type="button"
          variant={isOpen ? "secondary" : "tertiary"}
          svg={SlidersHorizontal}
          aria-label="All Tools"
          aria-expanded={isOpen}
          onClick={onToggle}
          className="shrink-0"
          iconSize="sm"
        >
          All Tools
        </Button>
      </div>

      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="All Tools"
        position={isMobile ? "bottom" : "right"}
        size={isMobile ? "lg" : "md"}
        contentClassName="min-h-0 flex flex-col gap-6 overflow-x-hidden overflow-y-auto"
      >
        <section className="flex min-w-0 flex-col gap-3 border-b border-gray-600 pb-5">
          <h2 className="text-base font-semibold">Text &amp; Appearance</h2>
          <div
            ref={setSlideFormatting}
            className="flex min-w-0 flex-col gap-4"
          />
        </section>
        <section className="flex min-w-0 flex-col gap-3 border-b border-gray-600 pb-5">
          <h2 className="text-base font-semibold">Position &amp; Size</h2>
          <div ref={setBoxLayout} className="flex min-w-0 flex-col gap-4" />
        </section>
        {showStreamFormatting && (
          <section className="flex min-w-0 flex-col gap-3 border-b border-gray-600 pb-5">
            <h2 className="text-base font-semibold">Stream Formatting</h2>
            <div
              ref={setStreamFormatting}
              className="flex min-w-0 flex-col gap-4"
            />
          </section>
        )}
        {showOutputTargets && (
          <section className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">Show On</h2>
              <p className="text-xs text-gray-400">
                Choose where this item appears when sent live.
              </p>
            </div>
            <div
              ref={setOutputTargets}
              className="flex min-w-0 flex-col gap-4"
            />
          </section>
        )}
      </Drawer>

      {children(targets)}
    </>
  );
};

export default AllToolsDrawer;
