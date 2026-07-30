import { useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Italic,
  List,
  MoreHorizontal,
  Underline,
} from "lucide-react";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";
import Button from "../Button/Button";
import { BrandAwareColorPicker } from "../ColorField/ColorField";
import PopOver from "../PopOver/PopOver";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  EMPTY_RICH_TEXT,
  isRichTextEmpty,
  type RichTextAlign,
  type RichTextDocument,
  type RichTextSize,
} from "../../types/richText";
import {
  BLOCK_SIZE_ATTR,
  BLOCK_TYPE_ATTR,
  blockAlignOf,
  blockSizeOf,
  blockTypeOf,
  getBlockElements,
  prepareRichTextColorsForBrowserCommand,
  readRichTextFromElement,
  renderRichTextIntoElement,
  resolveAuthoredRichTextColorFromElement,
} from "./richTextDom";
import { applyReadableRichTextColorToElement } from "../../utils/richTextColorContrast";

/** Matches the editor's own base text color (`text-neutral-100`). */
const DEFAULT_TEXT_COLOR = "#f4f4f5";
/** Pause between color-wheel samples before rewriting the selection (matches ColorField). */
const TEXT_COLOR_APPLY_DEBOUNCE_MS = 80;

const SIZE_OPTIONS: { value: RichTextSize | "normal"; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

/** Block size and list bullets are styled by real CSS keyed off the block
 * attributes (see index.css). Tailwind can't do it: the attributes are written
 * onto contentEditable children at runtime, so no class exists in source for
 * it to scan. */
const EDITABLE_BLOCK_STYLE_CLASS = "rich-text-editable";

type RichTextEditorProps = {
  value: RichTextDocument;
  onChange: (value: RichTextDocument) => void;
  label?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** For short fields like titles: Enter doesn't start a new block. */
  singleLine?: boolean;
  /** Rendered before the formatting toolbar on the same row (e.g. a Notes heading). */
  toolbarLeading?: ReactNode;
  /** Rendered after the formatting toolbar on the same row (e.g. a delete control). */
  toolbarTrailing?: ReactNode;
};

/** execCommand is deprecated but still the simplest way to toggle inline
 * formatting on a selection inside a contentEditable without hand-rolling a
 * selection model. jsdom doesn't implement it, so this is a guarded no-op
 * outside a real browser (Electron/Chromium here, where it works fine). */
const applyInlineFormat = (command: "bold" | "italic" | "underline") => {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return;
  }
  try {
    document.execCommand(command);
  } catch {
    // Unsupported in this environment — formatting toolbar becomes a no-op.
  }
};

/** styleWithCSS forces foreColor to wrap the selection in a <span
 * style="color:…"> instead of a legacy <font color> element — richTextDom's
 * reader only recognizes the former. */
const applyColorFormat = (color: string) => {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return;
  }
  try {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, color);
  } catch {
    // Unsupported in this environment — formatting toolbar becomes a no-op.
  }
};

/** Whether the caret/selection already carries an inline mark, so the toolbar
 * can show it as active. Deprecated alongside execCommand and guarded the same
 * way — it reports the browser's own view of the selection, which is exactly
 * what execCommand will act on. */
const isInlineFormatActive = (command: "bold" | "italic" | "underline") => {
  if (
    typeof document === "undefined" ||
    typeof document.queryCommandState !== "function"
  ) {
    return false;
  }
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
};

/**
 * The top-level block elements the selection touches. Block-level commands
 * (list, alignment) are applied straight to these rather than through
 * execCommand: `insertUnorderedList` builds nested <ul>/<li>, which this
 * editor's flat block model has no representation for.
 */
const getSelectedBlocks = (container: HTMLElement): HTMLElement[] => {
  const blocks = getBlockElements(container);
  if (typeof window === "undefined") return [];
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return [];
  const touched = blocks.filter((block) => range.intersectsNode(block));
  // A collapsed caret inside a block still counts as selecting that block.
  if (touched.length > 0) return touched;
  const anchor = blocks.find((block) =>
    block.contains(range.startContainer),
  );
  return anchor ? [anchor] : [];
};

/**
 * The authored color at the caret or start of the selection. Start color is
 * the conventional toolbar behavior for a selection spanning mixed colors.
 */
const getSelectedTextColor = (
  container: HTMLElement,
): string | undefined => {
  if (typeof window === "undefined") return undefined;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer)) return undefined;

  let element =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;

  while (element && element !== container) {
    const color = resolveAuthoredRichTextColorFromElement(element);
    if (color) return color;
    element = element.parentElement;
  }
  return undefined;
};

/**
 * Minimal rich text editor (bold/italic/underline/color, paragraphs/list items)
 * backed by a plain `contentEditable` div. Serializes to/from the structured
 * `RichTextDocument` shape (see richTextDom.ts) — never HTML strings — on
 * blur, so this can't become an HTML-injection surface and matches exactly
 * the shape the ServiceFlow public display already validates server-side.
 *
 * Text color uses the same BrandAwareColorPicker popover as presentation
 * slide edit tools (free hex + church brand swatches).
 */
const RichTextEditor = ({
  value,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
  placeholder,
  className,
  singleLine = false,
  toolbarLeading,
  toolbarTrailing,
}: RichTextEditorProps) => {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef<string>(JSON.stringify(EMPTY_RICH_TEXT));
  const savedRangeRef = useRef<Range | null>(null);
  /** Blocks the selection covered when a popover was opened. A popover takes
   * focus, which clears the live selection in a real browser, so block
   * commands issued from one can't rely on restoring it. */
  const savedBlocksRef = useRef<HTMLElement[]>([]);
  const textColorApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextColorRef = useRef<string | null>(null);
  const applyingTextColorRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [activeMarks, setActiveMarks] = useState({
    bold: false,
    italic: false,
    underline: false,
  });
  const [activeBlock, setActiveBlock] = useState<{
    isList: boolean;
    align: RichTextAlign;
    size: RichTextSize | "normal";
  }>({ isList: false, align: "left", size: "normal" });
  const { churchBranding } = useContext(GlobalInfoContext) || {};
  const brandColors = churchBranding?.colors || [];
  // Full toolbar from the md breakpoint up; compact size/color/More on phones.
  const showFullToolbar = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const serializedIncoming = JSON.stringify(value);
    // Skip re-render if this is just the value we ourselves last emitted —
    // rebuilding the DOM from props while the user is mid-edit would blow
    // away their cursor position.
    if (serializedIncoming === lastEmittedRef.current) return;
    renderRichTextIntoElement(container, value);
    lastEmittedRef.current = serializedIncoming;
  }, [value]);

  const commitChange = () => {
    const container = containerRef.current;
    if (!container) return;
    const next = readRichTextFromElement(container);
    lastEmittedRef.current = JSON.stringify(next);
    onChange(next);
  };

  const saveSelection = () => {
    if (typeof window === "undefined") return;
    const container = containerRef.current;
    if (container) savedBlocksRef.current = getSelectedBlocks(container);
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const range = savedRangeRef.current;
    if (!range || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  /** Display-only contrast helpers on colored spans (not part of the model). */
  const decorateColoredSpansInEditor = () => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>("span, font").forEach((el) => {
      // Must not re-read style.color after chips rewrite it to white/black ink —
      // that was overwriting the first word's authored color on the next paint.
      const hex = resolveAuthoredRichTextColorFromElement(el);
      if (!hex) return;
      applyReadableRichTextColorToElement(el, hex);
    });
  };

  const applyTextColorToSelection = (nextColor: string) => {
    const container = containerRef.current;
    if (!container) return;

    applyingTextColorRef.current = true;
    restoreSelection();
    // Remove display-only chip ink/metadata before the browser rewrites the
    // selection. Otherwise a stale authored-color attribute can win over the
    // newly applied style during the following decoration pass.
    prepareRichTextColorsForBrowserCommand(container);
    applyColorFormat(nextColor);
    saveSelection();
    decorateColoredSpansInEditor();
    // Radix emits focus-outside synchronously when selection restoration moves
    // focus back to the editor. Keep that internal move from dismissing the
    // picker, but let a later real click in the editor close it normally.
    queueMicrotask(() => {
      applyingTextColorRef.current = false;
    });
  };

  const flushPendingTextColor = () => {
    if (textColorApplyTimerRef.current) {
      clearTimeout(textColorApplyTimerRef.current);
      textColorApplyTimerRef.current = null;
    }
    const pending = pendingTextColorRef.current;
    if (pending == null) return;
    pendingTextColorRef.current = null;
    applyTextColorToSelection(pending);
  };

  const scheduleTextColorApply = (nextColor: string) => {
    // Keep the picker + toolbar border live while dragging; only the selection
    // rewrite is debounced (execCommand + contrast decoration).
    setTextColor(nextColor);
    pendingTextColorRef.current = nextColor;
    if (textColorApplyTimerRef.current) {
      clearTimeout(textColorApplyTimerRef.current);
    }
    textColorApplyTimerRef.current = setTimeout(() => {
      textColorApplyTimerRef.current = null;
      const pending = pendingTextColorRef.current;
      pendingTextColorRef.current = null;
      if (pending != null) applyTextColorToSelection(pending);
    }, TEXT_COLOR_APPLY_DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (textColorApplyTimerRef.current) {
        clearTimeout(textColorApplyTimerRef.current);
        textColorApplyTimerRef.current = null;
      }
    };
  }, []);

  /** Blocks the commands and the toolbar state both operate on: the live
   * selection when there is one, otherwise whatever was selected when a
   * popover took focus. */
  const getTargetBlocks = useCallback(() => {
    const container = containerRef.current;
    if (!container) return [];
    const live = getSelectedBlocks(container);
    if (live.length) return live;
    return savedBlocksRef.current.filter((block) => container.contains(block));
  }, []);

  const syncToolbarState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // Do not let selection restoration during a pending wheel drag overwrite
    // the picker's live draft color.
    if (pendingTextColorRef.current == null) {
      setTextColor(getSelectedTextColor(container) || DEFAULT_TEXT_COLOR);
    }
    setActiveMarks({
      bold: isInlineFormatActive("bold"),
      italic: isInlineFormatActive("italic"),
      underline: isInlineFormatActive("underline"),
    });
    const [firstBlock] = getTargetBlocks();
    setActiveBlock({
      isList: firstBlock ? blockTypeOf(firstBlock) === "list-item" : false,
      align: (firstBlock && blockAlignOf(firstBlock)) || "left",
      size: (firstBlock && blockSizeOf(firstBlock)) || "normal",
    });
  }, [getTargetBlocks]);

  // The toolbar has to follow the caret, and selection changes don't surface
  // as React events — `selectionchange` is document-level by spec.
  useEffect(() => {
    if (disabled || typeof document === "undefined") return undefined;
    const onSelectionChange = () => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.rangeCount === 0) return;
      if (!container.contains(selection.anchorNode)) return;
      syncToolbarState();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [disabled, syncToolbarState]);

  /**
   * Applies a change to every block the selection touches, then commits.
   * Mutating the block elements in place (rather than re-rendering from the
   * model) is what keeps the caret and the browser's native undo stack intact.
   */
  const updateSelectedBlocks = (mutate: (block: HTMLElement) => void) => {
    const container = containerRef.current;
    if (!container) return;
    const blocks = getTargetBlocks();
    if (blocks.length === 0) return;
    blocks.forEach(mutate);
    syncToolbarState();
    commitChange();
  };

  const toggleList = () => {
    const nextIsList = !activeBlock.isList;
    updateSelectedBlocks((block) => {
      block.setAttribute(BLOCK_TYPE_ATTR, nextIsList ? "list-item" : "paragraph");
    });
  };

  const applyAlign = (align: RichTextAlign) => {
    updateSelectedBlocks((block) => {
      // Left is the model's default, stored as no alignment at all.
      block.style.textAlign = align === "left" ? "" : align;
    });
  };

  const applySize = (size: RichTextSize | "normal") => {
    updateSelectedBlocks((block) => {
      // Normal is the model's default, stored as no size at all.
      if (size === "normal") block.removeAttribute(BLOCK_SIZE_ATTR);
      else block.setAttribute(BLOCK_SIZE_ATTR, size);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (singleLine && event.key === "Enter") {
      event.preventDefault();
    }
  };

  /** onMouseDown (not onClick) + preventDefault keeps the contentEditable
   * selection intact so the command has something to act on. */
  const commandButton = ({
    Icon,
    ariaLabel,
    isActive,
    onApply,
  }: {
    Icon: typeof Bold;
    ariaLabel: string;
    isActive: boolean;
    onApply: () => void;
  }) => (
    <Button
      type="button"
      variant="tertiary"
      iconSize="sm"
      svg={Icon}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      disabled={disabled}
      className={cn(isActive && "bg-gray-600 text-white")}
      onMouseDown={(event) => {
        event.preventDefault();
        onApply();
      }}
    />
  );

  const markButton = (
    command: "bold" | "italic" | "underline",
    Icon: typeof Bold,
    ariaLabel: string,
  ) =>
    commandButton({
      Icon,
      ariaLabel,
      isActive: activeMarks[command],
      onApply: () => {
        applyInlineFormat(command);
        syncToolbarState();
      },
    });

  const alignButton = (align: RichTextAlign, Icon: typeof Bold, ariaLabel: string) =>
    commandButton({
      Icon,
      ariaLabel,
      isActive: activeBlock.align === align,
      onApply: () => applyAlign(align),
    });

  const moreFormattingActive =
    activeMarks.bold ||
    activeMarks.italic ||
    activeMarks.underline ||
    activeBlock.isList ||
    activeBlock.align !== "left";

  const renderTextSizeControl = () => (
    <PopOver
      align="start"
      TriggeringButton={
        <Button
          type="button"
          variant="tertiary"
          iconSize="sm"
          svg={ALargeSmall}
          aria-label="Text size"
          className={cn(
            activeBlock.size !== "normal" && "bg-gray-600 text-white",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            saveSelection();
          }}
        />
      }
    >
      <div className="flex flex-col gap-1 p-1">
        {SIZE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="tertiary"
            className={cn(
              "justify-start",
              activeBlock.size === option.value && "bg-gray-600 text-white",
            )}
            aria-pressed={activeBlock.size === option.value}
            onMouseDown={(event) => {
              event.preventDefault();
              restoreSelection();
              applySize(option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </PopOver>
  );

  const renderTextColorControl = () => (
    <PopOver
      align="start"
      // Color changes restore the contentEditable selection so foreColor can
      // run. That moves focus out of the popover; without this, Radix closes
      // the picker on the first wheel click.
      onFocusOutside={(event) => {
        if (applyingTextColorRef.current) event.preventDefault();
      }}
      onOpenChange={(open) => {
        if (!open) flushPendingTextColor();
      }}
      TriggeringButton={
        <Button
          type="button"
          variant="tertiary"
          iconSize="sm"
          svg={Baseline}
          aria-label="Text color"
          className="border-b-2"
          style={{ borderColor: textColor }}
          // Keep the contentEditable selection while opening the picker,
          // same as bold/italic/underline.
          onMouseDown={(event) => {
            event.preventDefault();
            saveSelection();
          }}
        />
      }
    >
      <BrandAwareColorPicker
        color={textColor}
        colors={brandColors}
        onChange={scheduleTextColorApply}
      />
    </PopOver>
  );

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {label != null ? (
        <Label
          htmlFor={id}
          className={cn("shrink-0 p-1 text-sm font-semibold", hideLabel && "sr-only")}
        >
          {label}:
        </Label>
      ) : null}
      {!disabled || toolbarLeading != null || toolbarTrailing != null ? (
        <div className="flex shrink-0 items-start gap-1.5 pb-1">
          {toolbarLeading}
          {!disabled ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {showFullToolbar ? (
                <>
                  {markButton("bold", Bold, "Bold")}
                  {markButton("italic", Italic, "Italic")}
                  {markButton("underline", Underline, "Underline")}
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-700" aria-hidden />
                  {commandButton({
                    Icon: List,
                    ariaLabel: "Bulleted list",
                    isActive: activeBlock.isList,
                    onApply: toggleList,
                  })}
                  {renderTextSizeControl()}
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-700" aria-hidden />
                  {alignButton("left", AlignLeft, "Align left")}
                  {alignButton("center", AlignCenter, "Align center")}
                  {alignButton("right", AlignRight, "Align right")}
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-700" aria-hidden />
                  {renderTextColorControl()}
                </>
              ) : (
                <>
                  {renderTextSizeControl()}
                  {renderTextColorControl()}
                  <PopOver
                    align="start"
                    TriggeringButton={
                      <Button
                        type="button"
                        variant="tertiary"
                        iconSize="sm"
                        svg={MoreHorizontal}
                        aria-label="More formatting"
                        aria-pressed={moreFormattingActive}
                        className={cn(moreFormattingActive && "bg-gray-600 text-white")}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          saveSelection();
                        }}
                      />
                    }
                  >
                    <div className="flex flex-wrap items-center gap-1 p-1.5">
                      {markButton("bold", Bold, "Bold")}
                      {markButton("italic", Italic, "Italic")}
                      {markButton("underline", Underline, "Underline")}
                      <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-700" aria-hidden />
                      {commandButton({
                        Icon: List,
                        ariaLabel: "Bulleted list",
                        isActive: activeBlock.isList,
                        onApply: toggleList,
                      })}
                      <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-700" aria-hidden />
                      {alignButton("left", AlignLeft, "Align left")}
                      {alignButton("center", AlignCenter, "Align center")}
                      {alignButton("right", AlignRight, "Align right")}
                    </div>
                  </PopOver>
                </>
              )}
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          {toolbarTrailing}
        </div>
      ) : null}
      <div className="relative">
        {isRichTextEmpty(value) && !focused && placeholder ? (
          <span className="pointer-events-none absolute left-2 top-1.5 text-sm text-gray-500">
            {placeholder}
          </span>
        ) : null}
        <div
          id={id}
          ref={containerRef}
          role="textbox"
          // A plain div isn't a "labelable" element, so <label for> alone
          // doesn't reliably produce an accessible name for it — set
          // aria-label directly regardless of whether the visual label text
          // is shown or screen-reader-only.
          aria-label={label}
          aria-multiline={!singleLine}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className={cn(
            "min-h-9 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus-visible:ring-[3px] focus-visible:ring-cyan-500/35",
            EDITABLE_BLOCK_STYLE_CLASS,
            disabled && "cursor-not-allowed opacity-60",
          )}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            flushPendingTextColor();
            commitChange();
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
};

export default RichTextEditor;
