import { useCallback, useEffect, useRef, HTMLProps, useId } from "react";
import cn from "classnames";

type TextAreaProps = HTMLProps<HTMLTextAreaElement> & {
  className?: string;
  type?: string;
  value: string | number;
  label?: string;
  hideLabel?: boolean;
  autoResize?: boolean;
  onChange: (value: string) => void;
  labelClassName?: string;
};

const TextArea = ({
  className,
  type = "text",
  value,
  onChange,
  label,
  hideLabel = false,
  autoResize = false,
  labelClassName,
  ...rest
}: TextAreaProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  const id = useId();

  const resizeTextArea = useCallback(() => {
    if (containerRef.current && textAreaRef.current && labelRef.current) {
      if (autoResize) {
        containerRef.current.style.height = "auto";
        containerRef.current.style.height =
          textAreaRef.current.scrollHeight +
          labelRef.current.offsetHeight +
          4 +
          "px";
      } else {
        containerRef.current.style.height = "";
      }
    }
  }, [autoResize]);

  useEffect(() => {
    resizeTextArea();
  }, [resizeTextArea]);

  return (
    <div ref={containerRef} className={cn("scrollbar-variable", className)}>
      <label
        htmlFor={id}
        ref={labelRef}
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
        ref={textAreaRef}
        className="w-full h-full rounded px-2 py-1 select text-black resize-none text-sm"
        value={value}
        onChange={(e) => {
          if (autoResize) resizeTextArea();
          onChange(e.target.value);
        }}
        {...rest}
      />
    </div>
  );
};

export default TextArea;
