import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, ListFilter, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import type { TeamPosition } from "../../../api/authTypes";
import { resolvePositionLucideIcon } from "../lucidePositionIcons";

type ScheduleMembersPositionFilterProps = {
  positions: TeamPosition[];
  value: string[];
  onChange: (value: string[]) => void;
  panelRef: RefObject<HTMLElement | null>;
};

const ScheduleMembersPositionFilter = ({
  positions,
  value,
  onChange,
  panelRef,
}: ScheduleMembersPositionFilterProps) => {
  const [open, setOpen] = useState(false);
  const activeCount = value.length;
  const hasFilter = activeCount > 0;

  const toggle = (positionId: string) => {
    onChange(
      value.includes(positionId)
        ? value.filter((id) => id !== positionId)
        : [...value, positionId],
    );
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const overlay =
    open && panelRef.current
      ? createPortal(
        <div
          role="dialog"
          aria-label="Filter by position"
          className="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Positions
            </p>
            <div className="flex items-center gap-2">
              {hasFilter ? (
                <Button
                  type="button"
                  variant="textLink"
                  padding="p-0"
                  className="text-xs text-cyan-300"
                  onClick={() => onChange([])}
                >
                  Clear
                </Button>
              ) : null}
              <Button
                type="button"
                variant="tertiary"
                svg={X}
                iconSize="sm"
                padding="p-0.5"
                className="text-gray-400 hover:text-white"
                aria-label="Close position filter"
                onClick={() => setOpen(false)}
              />
            </div>
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {positions.length === 0 ? (
              <p className="text-sm text-gray-400">No positions on this team.</p>
            ) : (
              positions.map((position) => {
                const checked = value.includes(position.positionId);
                const PositionIcon = resolvePositionLucideIcon(position.icon);
                return (
                  <button
                    key={position.positionId}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggle(position.positionId)}
                    className={cn(
                      "flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
                      checked
                        ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-50"
                        : "border-gray-700 bg-gray-950/40 text-gray-100 hover:border-gray-600 hover:bg-gray-800/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-cyan-400 bg-cyan-400 text-gray-950"
                          : "border-gray-600",
                      )}
                    >
                      {checked ? <Check className="h-3 w-3 stroke-3" /> : null}
                    </span>
                    {PositionIcon ? (
                      <PositionIcon className="h-3.5 w-3.5 shrink-0 text-orange-300" aria-hidden />
                    ) : null}
                    <span className="min-w-0 truncate">
                      {position.name}
                      {position.archivedAt ? " (archived)" : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <Button
            type="button"
            variant="primary"
            svg={Check}
            iconSize="sm"
            color="#22d3ee"
            className="mt-3 shrink-0 w-full justify-center text-sm"
            onClick={() => setOpen(false)}
          >
            Apply
          </Button>
        </div>,
        panelRef.current,
      )
      : null;

  return (
    <>
      <Button
        type="button"
        variant="tertiary"
        svg={ListFilter}
        iconSize="sm"
        className={cn(
          "w-full justify-center",
          hasFilter && "border-cyan-400/40 bg-cyan-400/10 text-cyan-50",
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          hasFilter
            ? `Filter by position, ${activeCount} selected`
            : "Filter by position"
        }
        onClick={() => setOpen((current) => !current)}
      >
        {hasFilter ? `Filter (${activeCount})` : "Filter"}
      </Button>
      {overlay}
    </>
  );
};

export default ScheduleMembersPositionFilter;
