import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Italic,
  List,
  ListOrdered,
  MoreHorizontal,
  Underline as UnderlineIcon,
} from "lucide-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";
import Button from "../Button/Button";
import { BrandAwareColorPicker } from "../ColorField/ColorField";
import PopOver from "../PopOver/PopOver";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  EMPTY_RICH_TEXT,
  normalizeRichTextDocument,
  type RichTextAlign,
  type RichTextDocument,
  type RichTextSize,
} from "../../types/richText";
import { normalizeHexColor } from "../../utils/richTextColorContrast";
import {
  richTextDocumentToTiptapContent,
  tiptapContentToRichTextDocument,
} from "./richTextTiptap";
import { BlockSize, ReadableColor } from "./richTextExtensions";

const DEFAULT_TEXT_COLOR = "#f4f4f5";
/** Pause between color-wheel samples before rewriting the selection (matches ColorField). */
const TEXT_COLOR_APPLY_DEBOUNCE_MS = 80;
const EDITABLE_CLASS_NAME =
  "rich-text-editable min-h-9 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus-visible:ring-[3px] focus-visible:ring-cyan-500/35";

const SIZE_OPTIONS: { value: RichTextSize | "normal"; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

const EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    link: false,
    strike: false,
    trailingNode: false,
  }),
  TextStyle,
  ReadableColor,
  TextAlign.configure({
    types: ["paragraph"],
    alignments: ["left", "center", "right"],
    defaultAlignment: "left",
  }),
  BlockSize,
];

type RichTextEditorProps = {
  value: RichTextDocument;
  onChange: (value: RichTextDocument) => void;
  label?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
  singleLine?: boolean;
  toolbarLeading?: ReactNode;
  toolbarTrailing?: ReactNode;
};

const editorAttributes = ({
  id,
  label,
  singleLine,
  disabled,
  editorClassName,
}: Pick<
  RichTextEditorProps,
  "label" | "singleLine" | "disabled" | "editorClassName"
> & { id: string }) => ({
  id,
  role: "textbox",
  "aria-label": label || "",
  "aria-multiline": String(!singleLine),
  "aria-disabled": String(disabled),
  class: cn(
    EDITABLE_CLASS_NAME,
    disabled && "cursor-not-allowed opacity-60",
    editorClassName,
  ),
});

const currentBlockSize = (editor: Editor): RichTextSize | "normal" => {
  const size = editor.getAttributes("paragraph").blockSize;
  return size === "small" || size === "large" ? size : "normal";
};

const currentAlignment = (editor: Editor): RichTextAlign => {
  const alignment = editor.getAttributes("paragraph").textAlign;
  return alignment === "center" || alignment === "right"
    ? alignment
    : "left";
};

const RichTextEditor = ({
  value,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
  placeholder,
  className,
  editorClassName,
  singleLine = false,
  toolbarLeading,
  toolbarTrailing,
}: RichTextEditorProps) => {
  const id = useId();
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef(
    JSON.stringify(normalizeRichTextDocument(value || EMPTY_RICH_TEXT)),
  );
  const queuedDocumentRef = useRef<RichTextDocument | null>(null);
  const emitQueuedRef = useRef(false);
  const mountedRef = useRef(true);
  const textColorApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingTextColorRef = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [draftTextColor, setDraftTextColor] = useState<string | null>(null);
  const { churchBranding } = useContext(GlobalInfoContext) || {};
  const brandColors = churchBranding?.colors || [];
  const showFullToolbar = useMediaQuery("(min-width: 768px)");

  onChangeRef.current = onChange;

  const queueDocumentChange = (editor: Editor) => {
    const next = normalizeRichTextDocument(
      tiptapContentToRichTextDocument(editor.getJSON()),
    );
    const serialized = JSON.stringify(next);
    if (serialized === lastEmittedRef.current) return;
    lastEmittedRef.current = serialized;
    queuedDocumentRef.current = next;
    if (emitQueuedRef.current) return;
    emitQueuedRef.current = true;
    queueMicrotask(() => {
      emitQueuedRef.current = false;
      const queued = queuedDocumentRef.current;
      queuedDocumentRef.current = null;
      if (mountedRef.current && queued) onChangeRef.current(queued);
    });
  };

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: richTextDocumentToTiptapContent(
      normalizeRichTextDocument(value || EMPTY_RICH_TEXT),
    ),
    editable: !disabled,
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: nextEditor }) => queueDocumentChange(nextEditor),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    editorProps: {
      attributes: editorAttributes({
        id,
        label,
        singleLine,
        disabled,
        editorClassName,
      }),
      handleKeyDown: (_view, event) => singleLine && event.key === "Enter",
    },
  });

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (textColorApplyTimerRef.current) {
        clearTimeout(textColorApplyTimerRef.current);
        textColorApplyTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
    editor.setOptions({
      editorProps: {
        attributes: editorAttributes({
          id,
          label,
          singleLine,
          disabled,
          editorClassName,
        }),
        handleKeyDown: (_view, event) =>
          singleLine && event.key === "Enter",
      },
    });
  }, [disabled, editor, editorClassName, id, label, singleLine]);

  useEffect(() => {
    if (!editor) return;
    const incoming = normalizeRichTextDocument(value || EMPTY_RICH_TEXT);
    const serializedIncoming = JSON.stringify(incoming);
    if (serializedIncoming === lastEmittedRef.current) return;

    // Autosave/server normalization can rewrite whitespace-only blocks while
    // the operator is still typing. Applying that echo with setContent jumps
    // the caret; absorb it and keep TipTap's live document until blur/unfocus.
    // Same while the color picker is open: parent echoes from live color
    // samples must not rewrite content mid-drag.
    if (editor.isFocused || colorPickerOpen) {
      lastEmittedRef.current = serializedIncoming;
      return;
    }

    editor.commands.setContent(richTextDocumentToTiptapContent(incoming), {
      emitUpdate: false,
      errorOnInvalidContent: true,
    });
    lastEmittedRef.current = serializedIncoming;
  }, [colorPickerOpen, editor, value]);

  if (!editor) return null;

  const textColor =
    draftTextColor ||
    normalizeHexColor(editor.getAttributes("textStyle").color) ||
    DEFAULT_TEXT_COLOR;
  const activeSize = currentBlockSize(editor);
  const activeAlignment = currentAlignment(editor);
  const isBulletList = editor.isActive("bulletList");
  const isOrderedList = editor.isActive("orderedList");
  const moreFormattingActive =
    editor.isActive("bold") ||
    editor.isActive("italic") ||
    editor.isActive("underline") ||
    isBulletList ||
    isOrderedList ||
    activeAlignment !== "left";

  const applyTextColorToSelection = (nextColor: string) => {
    editor.chain().focus().setColor(nextColor).run();
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
    // Keep the picker + toolbar border live while dragging; only the TipTap
    // rewrite (and parent plan update) is debounced.
    setDraftTextColor(nextColor);
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

  const runCommand = (apply: () => void) => {
    if (disabled) return;
    apply();
  };

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
        runCommand(onApply);
      }}
    />
  );

  const markButton = (
    mark: "bold" | "italic" | "underline",
    Icon: typeof Bold,
    ariaLabel: string,
  ) =>
    commandButton({
      Icon,
      ariaLabel,
      isActive: editor.isActive(mark),
      onApply: () => {
        const chain = editor.chain().focus();
        if (mark === "bold") chain.toggleBold().run();
        else if (mark === "italic") chain.toggleItalic().run();
        else chain.toggleUnderline().run();
      },
    });

  const alignButton = (
    alignment: RichTextAlign,
    Icon: typeof Bold,
    ariaLabel: string,
  ) =>
    commandButton({
      Icon,
      ariaLabel,
      isActive: activeAlignment === alignment,
      onApply: () => editor.chain().focus().setTextAlign(alignment).run(),
    });

  const listButton = (
    kind: "bullet" | "ordered",
    Icon: typeof Bold,
    ariaLabel: string,
  ) =>
    commandButton({
      Icon,
      ariaLabel,
      isActive: kind === "bullet" ? isBulletList : isOrderedList,
      onApply: () => {
        const chain = editor.chain().focus();
        if (kind === "bullet") chain.toggleBulletList().run();
        else chain.toggleOrderedList().run();
      },
    });

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
            activeSize !== "normal" && "bg-gray-600 text-white",
          )}
          onMouseDown={(event) => event.preventDefault()}
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
              activeSize === option.value && "bg-gray-600 text-white",
            )}
            aria-pressed={activeSize === option.value}
            onMouseDown={(event) => {
              event.preventDefault();
              editor
                .chain()
                .focus()
                .setBlockSize(
                  option.value === "normal" ? null : option.value,
                )
                .run();
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
      onOpenChange={(open) => {
        setColorPickerOpen(open);
        if (!open) {
          flushPendingTextColor();
          setDraftTextColor(null);
        }
      }}
      onFocusOutside={(event) => {
        // TipTap's focus() is deferred to requestAnimationFrame. Applying color
        // focuses the editor so the selection updates; without this, Radix
        // treats that as focus-outside and closes the picker on the first
        // wheel sample. Pointer-outside still dismisses normally.
        event.preventDefault();
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
          onMouseDown={(event) => event.preventDefault()}
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
          className={cn(
            "shrink-0 p-1 text-sm font-semibold",
            hideLabel && "sr-only",
          )}
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
                  {markButton("underline", UnderlineIcon, "Underline")}
                  <span
                    className="mx-0.5 h-4 w-px shrink-0 bg-gray-700"
                    aria-hidden
                  />
                  {listButton("bullet", List, "Bulleted list")}
                  {listButton("ordered", ListOrdered, "Numbered list")}
                  {renderTextSizeControl()}
                  <span
                    className="mx-0.5 h-4 w-px shrink-0 bg-gray-700"
                    aria-hidden
                  />
                  {alignButton("left", AlignLeft, "Align left")}
                  {alignButton("center", AlignCenter, "Align center")}
                  {alignButton("right", AlignRight, "Align right")}
                  <span
                    className="mx-0.5 h-4 w-px shrink-0 bg-gray-700"
                    aria-hidden
                  />
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
                        className={cn(
                          moreFormattingActive &&
                          "bg-gray-600 text-white",
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                      />
                    }
                  >
                    <div className="flex flex-wrap items-center gap-1 p-1.5">
                      {markButton("bold", Bold, "Bold")}
                      {markButton("italic", Italic, "Italic")}
                      {markButton(
                        "underline",
                        UnderlineIcon,
                        "Underline",
                      )}
                      <span
                        className="mx-0.5 h-4 w-px shrink-0 bg-gray-700"
                        aria-hidden
                      />
                      {listButton("bullet", List, "Bulleted list")}
                      {listButton(
                        "ordered",
                        ListOrdered,
                        "Numbered list",
                      )}
                      <span
                        className="mx-0.5 h-4 w-px shrink-0 bg-gray-700"
                        aria-hidden
                      />
                      {alignButton("left", AlignLeft, "Align left")}
                      {alignButton(
                        "center",
                        AlignCenter,
                        "Align center",
                      )}
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
        {editor.isEmpty && !focused && placeholder ? (
          <span className="pointer-events-none absolute left-2 top-1.5 text-sm text-gray-500">
            {placeholder}
          </span>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default RichTextEditor;
