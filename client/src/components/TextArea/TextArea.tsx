import { useCallback, useEffect, useRef, HTMLProps } from "react";
import cn from "classnames";
import "./TextArea.scss";
import generateRandomId from "../../utils/generateRandomId";

type TextAreaProps = HTMLProps<HTMLTextAreaElement> & {
  className?: string;
  type?: string;
  value: string | number;
  label?: string;
  hideLabel?: boolean;
  autoResize?: boolean;
  onChange: (value: string) => void;
  labelClassName?: string;
  id?: string;
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
  id,
  ...rest
}: TextAreaProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  const textAreaId = id || generateRandomId();

  const resizeTextArea = useCallback(() => {
    if (
      autoResize &&
      containerRef.current &&
      textAreaRef.current &&
      labelRef.current
    ) {
      containerRef.current.style.height = "auto";
      containerRef.current.style.height =
        textAreaRef.current.scrollHeight +
        labelRef.current.offsetHeight +
        4 +
        "px";
    }
  }, [autoResize]);

  useEffect(() => {
    resizeTextArea();
  }, [resizeTextArea]);

  return (
    <div ref={containerRef} className={cn("text-area-container", className)}>
      <label
        ref={labelRef}
        htmlFor={textAreaId}
        className={cn(
          "text-sm font-semibold",
          hideLabel && "sr-only",
          labelClassName
        )}
      >
        {label}:
      </label>
      <textarea
        ref={textAreaRef}
        id={textAreaId}
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
