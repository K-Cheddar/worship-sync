import { useCallback, useEffect, useRef, useState } from "react";
import cn from "classnames";
import TextArea from "../TextArea/TextArea";

type SectionTextEditorProps = {
  value: string;
  onChange: (value: string, cursorPosition?: number) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  autoResize?: boolean;
  onCursorChange?: (position: number) => void;
  sectionName?: string;
  sectionColor?: string;
  isReformatting?: boolean;
};

const SectionTextEditor = ({
  value,
  onChange,
  disabled = false,
  className,
  placeholder = "Enter text...",
  autoResize = true,
  onCursorChange,
  sectionName,
  sectionColor,
  isReformatting = false,
}: SectionTextEditorProps) => {
  const isEditingRef = useRef(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const savedCursorRef = useRef<number | null>(null);

  // Sync with external value changes (but not during editing)
  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalValue(value);
      // Restore cursor position after value update
      if (savedCursorRef.current !== null && textAreaRef.current) {
        requestAnimationFrame(() => {
          if (textAreaRef.current) {
            const pos = Math.min(
              savedCursorRef.current!,
              textAreaRef.current.value.length
            );
            textAreaRef.current.selectionStart = pos;
            textAreaRef.current.selectionEnd = pos;
            savedCursorRef.current = null;
          }
        });
      }
    }
  }, [value]);

  const handleChange = useCallback(
    (newValue: string) => {
      isEditingRef.current = true;
      setLocalValue(newValue);
      
      // Track cursor position
      if (textAreaRef.current) {
        const cursorPos = textAreaRef.current.selectionStart;
        savedCursorRef.current = cursorPos;
        onCursorChange?.(cursorPos);
        onChange(newValue, cursorPos);
      } else {
        onChange(newValue);
      }
      
      // Reset editing flag after a short delay
      setTimeout(() => {
        isEditingRef.current = false;
      }, 100);
    },
    [onChange, onCursorChange]
  );

  return (
    <div className={cn("flex flex-col border-gray-600 border rounded-md lg:flex-[0_0_30%] w-full h-full max-lg:min-h-0 max-lg:overflow-y-auto", className)}>
      {sectionName && sectionColor && (
        <div className={cn("flex items-center gap-2 px-2 rounded-t-md shrink-0", sectionColor)}>
          <p className="text-sm font-semibold text-white">{sectionName}</p>
          {isReformatting && (
            <span className="text-xs text-blue-200 animate-pulse">
              Formatting...
            </span>
          )}
        </div>
      )}
      <TextArea
        ref={textAreaRef}
        value={localValue}
        onChange={(value) => handleChange(value as string)}
        onSelect={(e) => {
          const target = e.target as HTMLTextAreaElement;
          onCursorChange?.(target.selectionStart);
        }}
        label="Section Text"
        hideLabel={true}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full max-h-[60vh] scrollbar-variable flex-1 min-h-0 max-lg:min-h-[15vh] flex flex-col"
        textareaClassName={cn(`bg-gray-800 text-white text-sm rounded-b-md p-3 flex-1
            focus:border-blue-500 focus:outline-none`)}
        data-ignore-undo="true"
        style={{
          height: autoResize ? "auto" : undefined,
        }}
        onInput={(e) => {
          if (autoResize) {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
          }
        }}
      />
    </div>
  );
};

export default SectionTextEditor;
