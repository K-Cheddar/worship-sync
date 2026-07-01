import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import Textarea from "@/components/ui/Textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/utils/cnHelper";
import type { TeamRosterMember } from "../../../api/authTypes";
import type { ScheduleSlotColumn } from "./scheduleRequirements";
import {
  buildRowPastePreview,
  countSkippedRows,
  parsePastedRow,
  type RowPasteApplyEntry,
  type RowPasteOutcome,
  type RowPastePreviewRow,
} from "./schedulePasteRow";

export type PasteRowOccurrenceOption = {
  occurrenceId: string;
  label: string;
};

type SchedulePasteRowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occurrences: PasteRowOccurrenceOption[];
  columns: ScheduleSlotColumn[];
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  defaultOccurrenceId?: string;
  /** Same reason string as manual assignment, bound to a specific occurrence. */
  getIssueForOccurrence: (
    occurrenceId: string,
    memberId: string,
    positionId: string,
  ) => string;
  onApply: (occurrenceId: string, entries: RowPasteApplyEntry[]) => void;
};

const outcomeBadge = (
  outcome: RowPasteOutcome,
): { text: string; className: string } => {
  switch (outcome.kind) {
    case "assign":
      return {
        text: outcome.memberLabel,
        className: "border-emerald-300/40 bg-emerald-500/15 text-emerald-100",
      };
    case "empty":
      return {
        text: "Left as-is",
        className: "border-gray-600 bg-gray-800/60 text-gray-400",
      };
    case "not-found":
      return {
        text: "Not found",
        className: "border-amber-300/40 bg-amber-500/15 text-amber-100",
      };
    case "ambiguous":
      return {
        text:
          outcome.matchLabels.length > 0
            ? `Ambiguous: ${outcome.matchLabels.join(" / ")}`
            : "Ambiguous",
        className: "border-amber-300/40 bg-amber-500/15 text-amber-100",
      };
    case "issue":
      return {
        text: outcome.reason,
        className: "border-rose-300/40 bg-rose-500/15 text-rose-100",
      };
  }
};

const SchedulePasteRowDialog = ({
  open,
  onOpenChange,
  occurrences,
  columns,
  members,
  duplicateFirstNames,
  defaultOccurrenceId,
  getIssueForOccurrence,
  onApply,
}: SchedulePasteRowDialogProps) => {
  const [occurrenceId, setOccurrenceId] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [skipFirstCell, setSkipFirstCell] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset to a clean slate each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setOccurrenceId(defaultOccurrenceId || occurrences[0]?.occurrenceId || "");
    setPastedText("");
    setSkipFirstCell(false);
  }, [open, defaultOccurrenceId, occurrences]);

  const parsed = useMemo(
    () => parsePastedRow(pastedText, { skipFirstCell }),
    [pastedText, skipFirstCell],
  );

  const preview = useMemo(
    () =>
      buildRowPastePreview({
        cells: parsed.cells,
        columns,
        members,
        duplicateFirstNames,
        getIssue: (memberId, positionId) =>
          occurrenceId
            ? getIssueForOccurrence(occurrenceId, memberId, positionId)
            : "Not available",
      }),
    [
      parsed.cells,
      columns,
      members,
      duplicateFirstNames,
      occurrenceId,
      getIssueForOccurrence,
    ],
  );

  const hasInput = parsed.cells.length > 0;
  const assignCount = preview.applyEntries.length;
  const skipCount = countSkippedRows(preview.rows);

  const handleApply = () => {
    if (!occurrenceId || assignCount === 0) return;
    onApply(occurrenceId, preview.applyEntries);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-lg gap-0"
        onOpenAutoFocus={(event) => {
          // Focus the paste box so the operator can paste immediately.
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-5 w-5 text-cyan-200" aria-hidden />
            Paste a row from Excel
          </SheetTitle>
          <SheetDescription>
            Copy one row of names from your spreadsheet and paste it here. Names
            fill this service&apos;s positions left to right. Only matched, eligible
            people are filled — everything else is left for you.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-variable min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Select
            label="Service to fill"
            className="w-full"
            selectClassName="w-full"
            value={occurrenceId}
            onChange={setOccurrenceId}
            options={occurrences.map((occurrence) => ({
              label: occurrence.label,
              value: occurrence.occurrenceId,
            }))}
          />

          <div>
            <label
              htmlFor="schedule-paste-row-input"
              className="p-1 text-sm font-semibold"
            >
              Pasted row:
            </label>
            <Textarea
              id="schedule-paste-row-input"
              ref={textareaRef}
              rows={2}
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder="Paste a row of names here (tab or comma separated)"
            />
            <label className="mt-2 flex items-center gap-2 p-1 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-neutral-500 bg-neutral-900 accent-cyan-500"
                checked={skipFirstCell}
                onChange={(event) => setSkipFirstCell(event.target.checked)}
              />
              First cell is a date or label — skip it
            </label>
          </div>

          {hasInput ? (
            <div className="rounded-lg border border-gray-700 bg-gray-950/50">
              <div className="flex items-center justify-between gap-3 border-b border-gray-700 px-3 py-2 text-xs uppercase tracking-wide text-gray-400">
                <span>Position</span>
                <span>Result</span>
              </div>
              <ul className="divide-y divide-gray-800">
                {preview.rows.map((row: RowPastePreviewRow) => {
                  const badge = outcomeBadge(row.outcome);
                  return (
                    <li
                      key={row.columnKey}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-neutral-100">
                          {row.positionLabel}
                        </div>
                        {row.pastedText ? (
                          <div className="truncate text-xs text-gray-400">
                            {row.pastedText}
                          </div>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded border px-2 py-0.5 text-xs font-medium",
                          badge.className,
                        )}
                      >
                        {badge.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="rounded-md border border-gray-700 bg-gray-950/50 p-3 text-sm text-gray-400">
              Paste a row above to see how it lines up with this service&apos;s
              positions.
            </p>
          )}

          {parsed.extraLineCount > 0 ? (
            <p className="text-xs text-amber-200/90">
              Only the first row is used. {parsed.extraLineCount} more{" "}
              {parsed.extraLineCount === 1 ? "row was" : "rows were"} ignored.
            </p>
          ) : null}
          {preview.ignoredCellCount > 0 ? (
            <p className="text-xs text-amber-200/90">
              {preview.ignoredCellCount} extra{" "}
              {preview.ignoredCellCount === 1 ? "name has" : "names have"} no
              matching position and {preview.ignoredCellCount === 1 ? "was" : "were"}{" "}
              ignored.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-700 px-6 py-4">
          <p className="text-sm text-gray-400">
            {hasInput
              ? `${assignCount} to assign${skipCount > 0 ? `, ${skipCount} skipped` : ""}`
              : "Nothing to assign yet"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="tertiary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={assignCount === 0}
              onClick={handleApply}
            >
              {assignCount > 0 ? `Assign ${assignCount}` : "Assign"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SchedulePasteRowDialog;
