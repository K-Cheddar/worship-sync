import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import Button from "../../../components/Button/Button";
import Drawer from "../../../components/Drawer/Drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../components/ui/DropdownMenu";
import RadioButton, { RadioGroup } from "../../../components/RadioButton/RadioButton";
import type { SlideEditingScope } from "../../../utils/slideEditingScope";

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
  /** Present mode can open the same sheet without rendering edit shortcuts. */
  showToolbarControls?: boolean;
  /** Indicator shortcut opens the existing sheet at its routing controls. */
  scrollToOutputTargets?: boolean;
  showBibleMode: boolean;
  showStreamFormatting: boolean;
  showOutputTargets: boolean;
  editingScope: SlideEditingScope;
  onEditingScopeChange: (scope: SlideEditingScope) => void;
  children: (targets: AllToolsTargets) => ReactNode;
};

const AllToolsDrawer = ({
  isOpen,
  onClose,
  onToggle,
  isMobile,
  showToolbarControls = true,
  scrollToOutputTargets = false,
  showBibleMode,
  showStreamFormatting,
  showOutputTargets,
  editingScope,
  onEditingScopeChange,
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
  const outputTargetsSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !scrollToOutputTargets) return;
    outputTargetsSectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [isOpen, scrollToOutputTargets]);

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
      {showToolbarControls && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={isMobile ? "min-w-0 flex-1 overflow-x-auto scrollbar-variable" : "min-w-0 overflow-x-auto scrollbar-variable"}
            data-testid="quick-editing-toolbar-scroll"
          >
            <div
              className="flex min-w-max items-center gap-0.5 px-1"
              data-testid="quick-editing-toolbar-groups"
            >
              <div className="flex shrink-0 items-center border-r border-gray-600 px-1">
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="tertiary"
                      className="h-8 shrink-0 gap-1.5 rounded-md border-gray-500 bg-gray-800/70 px-2 text-xs hover:border-cyan-400 hover:bg-gray-700"
                      aria-label={`Formatting scope: ${editingScope === "all" ? "All slides" : "This slide"}`}
                      title="Choose whether text, appearance, and layout changes apply to this slide or all slides"
                    >
                      {editingScope === "all" ? "All slides" : "This slide"}
                      <ChevronDown className="size-3.5 text-gray-300" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={4} className="min-w-40">
                    <DropdownMenuLabel className="text-xs text-gray-400">
                      Apply changes to
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={editingScope}
                      onValueChange={(value) =>
                        onEditingScopeChange(value as SlideEditingScope)
                      }
                    >
                      <DropdownMenuRadioItem value="selected">
                        This slide
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="all">
                        All slides
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
      )}

      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="All Tools"
        position={isMobile ? "bottom" : "right"}
        size={isMobile ? "lg" : "md"}
        contentClassName="min-h-0 flex flex-col gap-6 overflow-x-hidden overflow-y-auto"
      >
        <section className="flex min-w-0 flex-col gap-1 border-b border-gray-600 pb-5">
          <p className="text-xs font-medium">Apply changes to</p>
          <RadioGroup
            value={editingScope}
            onValueChange={(value) =>
              onEditingScopeChange(value as SlideEditingScope)
            }
            className="flex flex-wrap items-center gap-2"
            aria-label="Apply changes to"
            title="Choose whether text, appearance, and layout changes apply to this slide or all slides"
          >
            <RadioButton
              className="w-fit text-xs"
              optionValue="selected"
              label="This slide"
              hideLabelColon
            />
            <RadioButton
              className="w-fit text-xs"
              optionValue="all"
              label="All slides"
              hideLabelColon
            />
          </RadioGroup>
        </section>
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
          <section
            ref={outputTargetsSectionRef}
            className="flex min-w-0 flex-col gap-3"
          >
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
