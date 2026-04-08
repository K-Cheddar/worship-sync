import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

const LENGTH = 6;

type VerificationCodeInputProps = {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  errorText?: string;
};

const digitsOnly = (s: string) => s.replace(/\D/g, "").slice(0, LENGTH);

const charsFromValue = (value: string) => {
  const d = digitsOnly(value);
  return Array.from({ length: LENGTH }, (_, i) => d[i] ?? "");
};

const VerificationCodeInput = ({
  id: idProp,
  value,
  onChange,
  disabled,
  autoFocus,
  errorText,
}: VerificationCodeInputProps) => {
  const generatedId = useId();
  const errorId = useId();
  const baseId = idProp ?? generatedId;
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const didAutoFocus = useRef(false);
  const chars = charsFromValue(value);

  const focusAt = useCallback((index: number) => {
    const el = refs.current[Math.max(0, Math.min(index, LENGTH - 1))];
    el?.focus();
    el?.select();
  }, []);

  useEffect(() => {
    if (!autoFocus || disabled || didAutoFocus.current) {
      return;
    }
    didAutoFocus.current = true;
    focusAt(0);
  }, [autoFocus, disabled, focusAt]);

  const emitFromRow = (row: string[]) => {
    onChange(digitsOnly(row.join("")));
  };

  const handleChange = (index: number, raw: string) => {
    const pasted = digitsOnly(raw);
    if (pasted.length > 1) {
      onChange(pasted);
      focusAt(Math.min(pasted.length, LENGTH - 1));
      return;
    }
    const digit = pasted.slice(-1);
    const row = charsFromValue(value);
    row[index] = digit;
    emitFromRow(row);
    if (digit && index < LENGTH - 1) {
      focusAt(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    const compact = digitsOnly(value);
    if (e.key === "Backspace") {
      if (chars[index]) {
        const row = [...chars];
        row[index] = "";
        emitFromRow(row);
      } else if (index > 0) {
        const row = [...chars];
        row[index - 1] = "";
        emitFromRow(row);
        focusAt(index - 1);
      } else if (compact.length > 0) {
        onChange(compact.slice(0, -1));
      }
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusAt(index - 1);
    }
    if (e.key === "ArrowRight" && index < LENGTH - 1) {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = digitsOnly(e.clipboardData.getData("text"));
    if (!pasted) {
      return;
    }
    onChange(pasted);
    focusAt(Math.min(pasted.length, LENGTH - 1));
  };

  const inputClassName =
    "h-12 w-10 sm:w-11 rounded-md border-2 bg-white text-center text-lg font-semibold tabular-nums text-gray-900 " +
    (errorText
      ? "border-red-500 "
      : "border-gray-400 ") +
    "outline-none transition-colors focus-visible:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/40 " +
    "disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <fieldset className="mt-4">
      <legend className="mb-2 block text-sm font-semibold text-white">
        Verification code
      </legend>
      <div
        className="flex flex-wrap justify-center gap-2"
        role="group"
        aria-label="Verification code digits"
      >
        {chars.map((char, index) => (
          <input
            key={`${baseId}-${index}`}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={index === 0 ? baseId : `${baseId}-${index}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            name={index === 0 ? "one-time-code" : undefined}
            maxLength={1}
            disabled={disabled}
            value={char}
            aria-label={`Digit ${index + 1} of ${LENGTH}`}
            aria-invalid={index === 0 ? Boolean(errorText) : undefined}
            aria-describedby={index === 0 && errorText ? errorId : undefined}
            className={inputClassName}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
          />
        ))}
      </div>
      {errorText ? (
        <p id={errorId} className="mt-2 text-center text-sm text-red-400" role="alert">
          {errorText}
        </p>
      ) : null}
    </fieldset>
  );
};

export default VerificationCodeInput;
