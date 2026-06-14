import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cnHelper";
import {
  EXPORT_EMPTY_SLOT_LABEL,
  type ScheduleExportCell,
  type ScheduleExportModel,
} from "./scheduleExport";
import type { ScheduleExportLayout } from "./scheduleExportPdf";
import {
  getScheduleAxisHighlight,
  scheduleExportAxisHighlightClassName,
  scheduleGridCellKey,
  type ScheduleExportAxisTheme,
  type ScheduleFocusedCell,
  type ScheduleGridLayout,
} from "./scheduleUtils";

/**
 * Read-only on-screen rendering of a schedule export model, in any of the three
 * export layouts. Shares the model with the PDF export, so the on-screen view
 * and the downloaded file always agree. Assigned names read bold; unfilled-but-
 * active slots show a dash.
 */

type ScheduleExportTableTheme = "light" | "board-attendee";

const palette = (isBoard: boolean) => ({
  container: isBoard
    ? "border-stone-700 shadow-lg shadow-black/20"
    : "border-gray-200 shadow-sm",
  head: isBoard
    ? "border-amber-500/40 bg-amber-950/80 text-amber-100"
    : "border-orange-400 bg-orange-500 text-white",
  serviceBg: isBoard ? "bg-stone-800/90" : "bg-orange-100",
  serviceText: isBoard ? "text-amber-200" : "text-orange-900",
  serviceTiming: isBoard ? "text-amber-300/80" : "text-orange-700",
  rowBorder: isBoard ? "border-stone-700" : "border-gray-200",
  rowEven: isBoard ? "bg-stone-900/85" : "bg-white",
  rowOdd: isBoard ? "bg-stone-950/90" : "bg-gray-50",
  labelCell: isBoard
    ? "border-stone-700 bg-stone-800 text-stone-100"
    : "border-gray-200 bg-orange-50 text-gray-900",
  cellBorder: isBoard ? "border-stone-700" : "border-gray-200",
  cellHighlight: isBoard ? "bg-amber-950/40" : "bg-amber-50",
  empty: isBoard ? "text-stone-500" : "text-gray-400",
  inactive: isBoard ? "text-stone-600" : "text-gray-300",
  name: isBoard ? "text-stone-100" : "text-gray-900",
  nameHighlight: isBoard
    ? "rounded bg-amber-500/25 px-1 text-amber-100"
    : "rounded bg-amber-200 px-1 text-amber-900",
  role: isBoard ? "text-stone-400" : "text-gray-500",
  byDatePositionLabel: isBoard
    ? "text-stone-100"
    : "text-gray-700",
  byDatePositionDivider: isBoard ? "border-stone-600" : "border-gray-200",
  emptyPanel: isBoard
    ? "border-stone-700 bg-stone-900/60 text-stone-300"
    : "border-gray-200 bg-gray-50 text-gray-600",
});

type Palette = ReturnType<typeof palette>;

type AxisHighlightOptions = {
  rowIndex?: number;
  surface?: "body" | "sticky" | "header";
};

type GridFocusProps = {
  focusedCell: ScheduleFocusedCell | null;
  getAxisHighlightClassName: (
    occurrenceId?: string,
    columnKey?: string,
    options?: AxisHighlightOptions,
  ) => string;
  onFocusCell: (cell: ScheduleFocusedCell) => void;
};

const CellContent = ({ cell, p }: { cell: ScheduleExportCell; p: Palette }) => {
  if (cell.state === "inactive") {
    return <span className={p.inactive}>·</span>;
  }
  if (cell.state === "empty") {
    return <span className={p.empty}>{EXPORT_EMPTY_SLOT_LABEL}</span>;
  }
  return (
    <div className="space-y-0.5">
      {cell.tokens.map((token, index) => (
        <div key={`${token.name}-${index}`} className="leading-tight">
          <span
            className={cn(
              "font-semibold",
              p.name,
              token.highlighted && p.nameHighlight,
            )}
          >
            {token.name}
          </span>
          {token.roleNote ? (
            <span className={cn("text-xs font-normal", p.role)}>
              {" "}
              ({token.roleNote})
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
};

const ExportGridCell = ({
  cell,
  occurrenceId,
  columnKey,
  rowIndex,
  p,
  focus,
}: {
  cell: ScheduleExportCell;
  occurrenceId: string;
  columnKey: string;
  rowIndex: number;
  p: Palette;
  focus: GridFocusProps;
}) => {
  const clickable = cell.state !== "inactive";
  const axisHighlightClassName = focus.getAxisHighlightClassName(
    occurrenceId,
    columnKey,
    { rowIndex, surface: "body" },
  );

  return (
    <td
      data-schedule-export-cell={clickable ? "" : undefined}
      className={cn(
        "border-l px-3 py-2 align-top",
        p.cellBorder,
        cell.highlighted && p.cellHighlight,
        axisHighlightClassName,
        clickable && "cursor-pointer",
      )}
      onClick={
        clickable
          ? () => focus.onFocusCell({ occurrenceId, columnKey })
          : undefined
      }
    >
      <CellContent cell={cell} p={p} />
    </td>
  );
};

const GridLayout = ({
  model,
  p,
  focus,
}: {
  model: ScheduleExportModel;
  p: Palette;
  focus: GridFocusProps;
}) => {
  let globalRowIndex = 0;

  return (
    <div className={cn("overflow-auto rounded-lg border", p.container)}>
      <table className="w-max max-w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th
              className={cn(
                "sticky left-0 top-0 z-20 whitespace-nowrap border-b px-3 py-2 font-semibold",
                p.head,
              )}
            >
              Date
            </th>
            {model.columnLabels.map((label, index) => (
              <th
                key={`${label}-${index}`}
                className={cn(
                  "whitespace-nowrap border-b border-l px-3 py-2 font-semibold",
                  p.head,
                  focus.getAxisHighlightClassName(undefined, model.columnKeys[index], {
                    surface: "header",
                  }),
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.groups.map((group, groupIndex) => (
            <Fragment key={`${group.serviceName}-${groupIndex}`}>
              <tr className={p.serviceBg}>
                <th
                  colSpan={model.columnLabels.length + 1}
                  className={cn("px-3 py-2 text-left font-bold", p.serviceText)}
                >
                  <span>{group.serviceName}</span>
                  {group.timingLabel ? (
                    <span className={cn("ml-2 font-normal", p.serviceTiming)}>
                      {group.timingLabel}
                    </span>
                  ) : null}
                </th>
              </tr>
              {group.rows.map((row, rowIndex) => {
                const axisRowIndex = globalRowIndex;
                globalRowIndex += 1;
                return (
                  <tr
                    key={`${row.occurrenceId}-${rowIndex}`}
                    className={cn(
                      "border-t",
                      p.rowBorder,
                      rowIndex % 2 === 0 ? p.rowEven : p.rowOdd,
                    )}
                  >
                    <th
                      className={cn(
                        "sticky left-0 z-10 whitespace-nowrap border-r px-3 py-2 text-left font-semibold",
                        p.labelCell,
                        focus.getAxisHighlightClassName(row.occurrenceId, undefined, {
                          rowIndex: axisRowIndex,
                          surface: "sticky",
                        }),
                      )}
                    >
                      {row.rowLabel}
                    </th>
                    {row.cells.map((cell, cellIndex) => (
                      <ExportGridCell
                        key={scheduleGridCellKey(row.occurrenceId, model.columnKeys[cellIndex])}
                        cell={cell}
                        occurrenceId={row.occurrenceId}
                        columnKey={model.columnKeys[cellIndex]}
                        rowIndex={axisRowIndex}
                        p={p}
                        focus={focus}
                      />
                    ))}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TransposeLayout = ({
  model,
  p,
  focus,
}: {
  model: ScheduleExportModel;
  p: Palette;
  focus: GridFocusProps;
}) => {
  const occurrences = model.groups.flatMap((group) =>
    group.rows.map((row) => ({
      occurrenceId: row.occurrenceId,
      rowLabel: row.rowLabel,
      cells: row.cells,
    })),
  );

  return (
    <div className={cn("overflow-auto rounded-lg border", p.container)}>
      <table className="w-max max-w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th
              className={cn(
                "sticky left-0 top-0 z-20 whitespace-nowrap border-b px-3 py-2 font-semibold",
                p.head,
              )}
            />
            {model.groups
              .filter((group) => group.rows.length > 0)
              .map((group, groupIndex) => (
                <th
                  key={`${group.serviceName}-${groupIndex}`}
                  colSpan={group.rows.length}
                  className={cn(
                    "whitespace-nowrap border-b border-l px-3 py-2 text-center font-semibold",
                    p.head,
                  )}
                >
                  {group.serviceName}
                  {group.timingLabel ? (
                    <span className="ml-2 font-normal opacity-80">
                      {group.timingLabel}
                    </span>
                  ) : null}
                </th>
              ))}
          </tr>
          <tr>
            <th
              className={cn(
                "sticky left-0 top-0 z-20 whitespace-nowrap border-b px-3 py-2 font-semibold",
                p.head,
              )}
            >
              Position
            </th>
            {occurrences.map((occurrence, index) => (
              <th
                key={`${occurrence.occurrenceId}-${index}`}
                className={cn(
                  "whitespace-nowrap border-b border-l px-3 py-2 font-semibold",
                  p.head,
                  focus.getAxisHighlightClassName(occurrence.occurrenceId, undefined, {
                    surface: "header",
                  }),
                )}
              >
                {occurrence.rowLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.columnLabels.map((label, columnIndex) => (
            <tr
              key={`${label}-${columnIndex}`}
              className={cn(
                "border-t",
                p.rowBorder,
                columnIndex % 2 === 0 ? p.rowEven : p.rowOdd,
              )}
            >
              <th
                className={cn(
                  "sticky left-0 z-10 whitespace-nowrap border-r px-3 py-2 text-left font-semibold",
                  p.labelCell,
                  focus.getAxisHighlightClassName(undefined, model.columnKeys[columnIndex], {
                    rowIndex: columnIndex,
                    surface: "sticky",
                  }),
                )}
              >
                {label}
              </th>
              {occurrences.map((occurrence, index) => {
                const cell = occurrence.cells[columnIndex];
                if (!cell) return <td key={index} className={cn("border-l", p.cellBorder)} />;
                return (
                  <ExportGridCell
                    key={scheduleGridCellKey(occurrence.occurrenceId, model.columnKeys[columnIndex])}
                    cell={cell}
                    occurrenceId={occurrence.occurrenceId}
                    columnKey={model.columnKeys[columnIndex]}
                    rowIndex={columnIndex}
                    p={p}
                    focus={focus}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ByDateLayout = ({ model, p }: { model: ScheduleExportModel; p: Palette }) => (
  <div className="space-y-4">
    {model.groups.map((group, groupIndex) =>
      group.rows.map((row, rowIndex) => {
        const entries = model.columnLabels
          .map((label, columnIndex) => ({
            label,
            columnKey: model.columnKeys[columnIndex],
            cell: row.cells[columnIndex],
          }))
          .filter((entry) => entry.cell && entry.cell.state !== "inactive");
        return (
          <div
            key={`${groupIndex}-${rowIndex}`}
            className={cn("overflow-hidden rounded-lg border", p.container)}
          >
            <div className={cn("px-3 py-2 text-sm font-bold", p.serviceBg, p.serviceText)}>
              {group.serviceName} — {row.rowLabel}
              {group.timingLabel ? (
                <span className={cn("ml-2 font-normal", p.serviceTiming)}>
                  {group.timingLabel}
                </span>
              ) : null}
            </div>
            <dl className="divide-y border-transparent text-sm">
              {entries.map((entry, entryIndex) => (
                <div
                  key={entry.columnKey}
                  className={cn(
                    "flex items-start gap-4 border-t px-3 py-2",
                    p.rowBorder,
                    entryIndex % 2 === 0 ? p.rowEven : p.rowOdd,
                    entry.cell.highlighted && p.cellHighlight,
                  )}
                >
                  <dt
                    className={cn(
                      "min-w-[10.5rem] w-[48%] max-w-[16rem] shrink-0 self-stretch border-r pr-4 font-medium",
                      p.byDatePositionLabel,
                      p.byDatePositionDivider,
                    )}
                  >
                    {entry.label}
                  </dt>
                  <dd className="min-w-0 flex-1 pl-1">
                    <CellContent cell={entry.cell} p={p} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      }),
    )}
  </div>
);

const ScheduleExportTable = ({
  model,
  theme = "light",
  layout = "grid",
}: {
  model: ScheduleExportModel;
  theme?: ScheduleExportTableTheme;
  layout?: ScheduleExportLayout;
}) => {
  const p = palette(theme === "board-attendee");
  const [focusedCell, setFocusedCell] = useState<ScheduleFocusedCell | null>(null);

  const axisTheme: ScheduleExportAxisTheme =
    theme === "board-attendee" ? "board-attendee" : "light";

  const gridLayoutMode = useMemo<ScheduleGridLayout>(
    () => (layout === "transpose" ? "transpose" : "grid"),
    [layout],
  );

  const getAxisHighlightClassName = useCallback(
    (
      occurrenceId?: string,
      columnKey?: string,
      options?: AxisHighlightOptions,
    ) =>
      scheduleExportAxisHighlightClassName(
        getScheduleAxisHighlight({
          layout: gridLayoutMode,
          focusedCell,
          occurrenceId,
          columnKey,
        }),
        { ...options, theme: axisTheme },
      ),
    [axisTheme, focusedCell, gridLayoutMode],
  );

  const onFocusCell = useCallback((cell: ScheduleFocusedCell) => {
    setFocusedCell(cell);
  }, []);

  useEffect(() => {
    setFocusedCell(null);
  }, [layout, model.scheduleName]);

  useEffect(() => {
    if (!focusedCell) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusedCell(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-schedule-export-cell]")) return;
      setFocusedCell(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [focusedCell]);

  const focusProps: GridFocusProps = {
    focusedCell,
    getAxisHighlightClassName,
    onFocusCell,
  };

  if (model.columnLabels.length === 0) {
    return (
      <p className={cn("rounded-md border p-4 text-sm", p.emptyPanel)}>
        Nobody has been scheduled yet. Check back soon.
      </p>
    );
  }

  if (layout === "transpose") {
    return <TransposeLayout model={model} p={p} focus={focusProps} />;
  }
  if (layout === "byDate") return <ByDateLayout model={model} p={p} />;
  return <GridLayout model={model} p={p} focus={focusProps} />;
};

export default ScheduleExportTable;
