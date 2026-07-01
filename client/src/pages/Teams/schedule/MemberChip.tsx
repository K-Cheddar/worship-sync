import type { ReactNode } from "react";
import { Highlighter, Info } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import { WantsThisBadge } from "./WantsThisIndicator";

type MemberChipProps = {
  label: string;
  subtitle?: string;
  issue?: string;
  /** Non-blocking caution shown in amber; the member stays selectable. */
  warning?: string;
  /** Member asked for the active position on intake. */
  desiresPosition?: boolean;
  assignmentCount?: number;
  disabled?: boolean;
  highlighted?: boolean;
  expanded?: boolean;
  showHighlightAction?: boolean;
  details?: ReactNode;
  onToggleHighlight?: () => void;
  onToggleExpand?: () => void;
  onSelect?: () => void;
};

const MemberChip = ({
  label,
  subtitle,
  issue,
  warning,
  desiresPosition = false,
  assignmentCount = 0,
  disabled,
  highlighted = false,
  expanded = false,
  showHighlightAction = false,
  details,
  onToggleHighlight,
  onToggleExpand,
  onSelect,
}: MemberChipProps) => {
  const assignmentCountLabel = `assigned ${assignmentCount} ${assignmentCount === 1 ? "time" : "times"} on this schedule`;
  const selectable = Boolean(onSelect);
  const showSecondRow = Boolean(subtitle || desiresPosition);

  return (
    <div
      className={cn(
        "w-full max-w-full rounded border text-left text-sm font-semibold text-gray-100",
        disabled
          ? "border-gray-800 bg-gray-900/40 text-gray-500"
          : highlighted
            ? "border-cyan-400/60 bg-cyan-400/15 ring-1 ring-cyan-400/40"
            : "border-gray-700 bg-gray-900/60",
      )}
      role="group"
      aria-label={
        disabled && issue
          ? `${label}, unavailable: ${issue}`
          : `${label}, ${assignmentCountLabel}`
      }
    >
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          {selectable ? (
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "min-w-0 flex-1 truncate rounded text-left",
                disabled
                  ? "cursor-not-allowed"
                  : "cursor-pointer hover:bg-gray-800/80",
              )}
              aria-label={
                disabled && issue
                  ? `${label}, unavailable: ${issue}`
                  : `Assign ${label}`
              }
              onClick={() => {
                if (disabled) return;
                onSelect?.();
              }}
            >
              {label}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate">{label}</span>
          )}

          {showHighlightAction ? (
            <div
              className={cn(
                "inline-flex shrink-0 items-stretch overflow-hidden rounded-md border",
                highlighted
                  ? "border-cyan-400/40 bg-cyan-400/10"
                  : "border-gray-600 bg-gray-900/50",
              )}
              aria-label={assignmentCountLabel}
            >
              <span
                className={cn(
                  "flex items-center border-r px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                  highlighted ? "border-cyan-400/30" : "border-gray-600",
                  assignmentCount > 0
                    ? "bg-orange-400/20 text-orange-50"
                    : "text-gray-400",
                )}
                aria-hidden
              >
                {assignmentCount}
              </span>
              <Button
                type="button"
                variant="tertiary"
                padding="px-1 py-1"
                svg={Highlighter}
                iconSize="sm"
                className={cn(
                  "shrink-0 rounded-none",
                  highlighted ? "text-cyan-200" : "text-gray-400 hover:text-cyan-200",
                )}
                aria-pressed={highlighted}
                aria-label={`Highlight ${label} on the grid`}
                onClick={onToggleHighlight}
              />
            </div>
          ) : (
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                assignmentCount > 0
                  ? "border-orange-400/35 bg-orange-400/20 text-orange-50"
                  : "border-gray-600 bg-gray-900/60 text-gray-400",
              )}
              aria-hidden
            >
              {assignmentCount}
            </span>
          )}

          {onToggleExpand ? (
            <Button
              type="button"
              variant="tertiary"
              padding="px-1 py-1"
              svg={Info}
              iconSize="sm"
              className={cn(
                "shrink-0",
                expanded ? "text-cyan-200" : "text-gray-400 hover:text-cyan-200",
              )}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} details for ${label}`}
              onClick={onToggleExpand}
            />
          ) : null}
        </div>

        {showSecondRow ? (
          <div className="mt-0.5 flex items-center gap-1">
            {subtitle ? (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs font-normal",
                  disabled || issue ? "text-gray-500" : "text-gray-400",
                )}
              >
                {subtitle}
              </span>
            ) : (
              <span className="min-w-0 flex-1" aria-hidden />
            )}

            {desiresPosition ? <WantsThisBadge /> : null}
          </div>
        ) : null}

        {warning ? (
          <span className="mt-0.5 block truncate text-xs font-normal text-amber-300">
            ⚠ {warning}
          </span>
        ) : null}
      </div>

      {details ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden" inert={expanded ? undefined : true}>
            <div className="border-t border-gray-700/80 px-2 py-2 text-xs font-normal text-gray-300">
              {details}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MemberChip;
