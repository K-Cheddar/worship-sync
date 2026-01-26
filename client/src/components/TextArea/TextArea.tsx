import { useCallback, useEffect, useRef, HTMLProps, useId, forwardRef } from "react";
import cn from "classnames";

type TextAreaProps = HTMLProps<HTMLTextAreaElement> & {
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
  type = "text",
  value,
  onChange,
  label,
  hideLabel = false,
  autoResize = false,
  labelClassName,
  ...rest
}, forwardedRef) => {
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
      textarea.style.height = `${textarea.scrollHeight}px`;
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

  return (
    <div className={cn("scrollbar-variable", className)}>
      <label
        htmlFor={id}
        className={cn(
          "text-sm font-semibold",
          hideLabel && "sr-only",
          labelClassName
        )}
      >
        {label}:
      </label>
      <textarea
        id={id}
        ref={setTextAreaRef}
        className={cn("w-full h-full rounded px-2 py-1 select text-black resize-none text-sm", textareaClassName)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          resize(target);
          rest.onInput?.(e);
        }}
        {...rest}
      />
    </div>
  );
});

TextArea.displayName = "TextArea";

export default TextArea;
