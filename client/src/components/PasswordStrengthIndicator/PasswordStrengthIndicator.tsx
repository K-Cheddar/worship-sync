import { Check, Circle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cnHelper";
import {
  PASSWORD_CHARACTER_TYPES_MIN,
  PASSWORD_CHARACTER_TYPES_TOTAL,
  getPasswordRequirementChecks,
  type PasswordStrengthLevel,
} from "@/utils/passwordRequirements";
import {
  emptyZxcvbnStrengthDisplay,
  mapZxcvbnResultToDisplay,
  type ZxcvbnStrengthDisplay,
} from "@/utils/zxcvbnStrength";

type ZxcvbnFn = (
  password: string,
  userInputs?: string[],
) => {
  score: number;
  feedback: { warning?: string; suggestions?: string[] };
};

const LEVEL_LABEL: Record<PasswordStrengthLevel, string> = {
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

const LEVEL_TEXT_CLASS: Record<PasswordStrengthLevel, string> = {
  weak: "text-red-400",
  fair: "text-amber-300",
  good: "text-cyan-300",
  strong: "text-emerald-400",
};

const LEVEL_BAR_CLASS: Record<PasswordStrengthLevel, string> = {
  weak: "bg-red-400",
  fair: "bg-amber-400",
  good: "bg-cyan-400",
  strong: "bg-emerald-400",
};

type PasswordStrengthIndicatorProps = {
  password: string;
  /** For `aria-describedby` on the password field. */
  id?: string;
  className?: string;
};

const PasswordStrengthIndicator = ({
  password,
  id,
  className,
}: PasswordStrengthIndicatorProps) => {
  const [zxcvbnFn, setZxcvbnFn] = useState<ZxcvbnFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("zxcvbn").then((mod) => {
      if (!cancelled) {
        setZxcvbnFn(() => mod.default as ZxcvbnFn);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const zxcvbnDisplay: ZxcvbnStrengthDisplay = useMemo(() => {
    if (!password || !zxcvbnFn) {
      return emptyZxcvbnStrengthDisplay();
    }
    return mapZxcvbnResultToDisplay(zxcvbnFn(password));
  }, [password, zxcvbnFn]);

  const { level, barPercent, feedbackWarning, feedbackSuggestions } =
    zxcvbnDisplay;
  const checks = getPasswordRequirementChecks(password);
  const lengthCheck = checks[0];
  const typeChecks = checks.slice(1);
  const feedbackLine =
    feedbackWarning ||
    (feedbackSuggestions.length > 0 ? feedbackSuggestions[0] : "");

  return (
    <div
      id={id}
      className={cn("mt-2 space-y-2", className)}
      role="region"
      aria-label="Password requirements and estimated strength"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">Estimated strength</span>
        <span
          className={cn("text-xs font-medium", LEVEL_TEXT_CLASS[level])}
          aria-live="polite"
        >
          {LEVEL_LABEL[level]}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-600"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barPercent}
        aria-valuetext={`${LEVEL_LABEL[level]}, ${barPercent} percent`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-150",
            LEVEL_BAR_CLASS[level]
          )}
          style={{ width: `${barPercent}%` }}
        />
      </div>
      {feedbackLine ? (
        <p className="text-xs leading-snug text-amber-300/90">{feedbackLine}</p>
      ) : null}
      <ul className="list-none space-y-1.5 text-xs leading-snug text-gray-400">
        {lengthCheck ? (
          <li key={lengthCheck.id} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 inline-flex shrink-0",
                lengthCheck.met ? "text-emerald-400" : "text-gray-500"
              )}
              aria-hidden
            >
              {lengthCheck.met ? (
                <Check className="size-3.5" strokeWidth={2.5} />
              ) : (
                <Circle className="size-3.5" strokeWidth={2} />
              )}
            </span>
            <span className={cn(lengthCheck.met && "text-gray-200")}>
              {lengthCheck.label}
            </span>
          </li>
        ) : null}
        {typeChecks.length > 0 ? (
          <li className="pt-0.5 text-gray-400">
            Use at least {PASSWORD_CHARACTER_TYPES_MIN} of these{" "}
            {PASSWORD_CHARACTER_TYPES_TOTAL}:
          </li>
        ) : null}
        {typeChecks.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 inline-flex shrink-0",
                item.met ? "text-emerald-400" : "text-gray-500"
              )}
              aria-hidden
            >
              {item.met ? (
                <Check className="size-3.5" strokeWidth={2.5} />
              ) : (
                <Circle className="size-3.5" strokeWidth={2} />
              )}
            </span>
            <span className={cn(item.met && "text-gray-200")}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PasswordStrengthIndicator;
