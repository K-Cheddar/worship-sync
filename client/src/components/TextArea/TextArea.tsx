import { useCallback, useEffect, useRef, HTMLProps, useId, forwardRef } from "react";

import UITextarea from "@/components/ui/Textarea";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";

type TextAreaProps = Omit<HTMLProps<HTMLTextAreaElement>, "onChange" | "value"> & {
  className?: string;
  textareaClassName?: string;
  type?: string;
  value: string | number;
  label?: string;
  hideLabel?: boolean;
  autoResize?: boolean;
  onChange: (value: string) => void;
  labelClassName?: string;
};

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(({
  className,
  textareaClassName,
  type: _unusedType,
  value,
  onChange,
  label,
  hideLabel = false,
  autoResize = false,
  labelClassName,
  ...rest
}, forwardedRef) => {
  const { onFocus: onFocusProp, onInput: onInputProp, ...textareaDomRest } = rest;
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // Callback ref that sets both forwarded ref and internal ref
  const setTextAreaRef = useCallback((node: HTMLTextAreaElement | null) => {
    textAreaRef.current = node;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    }
  }, [forwardedRef]);

  // Resize function that works directly on the textarea element
  const resize = useCallback((textarea: HTMLTextAreaElement) => {
    if (autoResize) {
      textarea.style.height = "auto";
      // scrollHeight vs set height often differs by 1–2px (subpixels, borders); without a
      // small buffer the textarea shows a scrollbar that only moves a pixel or two.
      const padded = Math.ceil(textarea.scrollHeight) + 2;
      textarea.style.height = `${padded}px`;
    }
  }, [autoResize]);

  // Resize when value changes externally (e.g., clicking different slides)
  useEffect(() => {
    if (autoResize && textAreaRef.current) {
      requestAnimationFrame(() => {
        if (textAreaRef.current) {
          resize(textAreaRef.current);
        }
      });
    }
  }, [value, autoResize, resize]);

  // Mobile auto-resize sets inline height; clear it when switching to fixed-height layout
  // (e.g. resize to desktop) so classes like h-full / min-h-* apply again.
  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) {
      return;
    }
    if (autoResize) {
      requestAnimationFrame(() => {
        if (textAreaRef.current) {
          resize(textAreaRef.current);
        }
      });
    } else {
      el.style.height = "";
    }
  }, [autoResize, resize]);

  return (
    <div
      className={cn(
        "scrollbar-variable flex min-h-0 flex-col",
        // flex-1 on the textarea fights inline heights from autoResize (scrollHeight).
        autoResize && "h-auto",
        className,
      )}
    >
      {label != null ? (
        <Label
          htmlFor={id}
          className={cn(
            "shrink-0 text-sm font-semibold p-1",
            hideLabel && "sr-only",
            labelClassName
          )}
        >
          {label}:
        </Label>
      ) : null}
      <UITextarea
        id={id}
        ref={setTextAreaRef}
        className={cn(
          "min-h-0 w-full resize-none select-text",
          autoResize ? "flex-none overflow-x-hidden overflow-y-hidden" : "flex-1",
          textareaClassName
        )}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          if (autoResize) {
            requestAnimationFrame(() => {
              if (textAreaRef.current) {
                resize(textAreaRef.current);
              }
            });
          }
          onFocusProp?.(e);
        }}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          resize(target);
          onInputProp?.(e);
        }}
        {...textareaDomRest}
      />
    </div>
  );
});

TextArea.displayName = "TextArea";

export default TextArea;
