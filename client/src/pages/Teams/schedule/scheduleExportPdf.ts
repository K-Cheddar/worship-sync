import { jsPDF } from "jspdf";
import autoTable, {
  type CellDef,
  type RowInput,
  type Styles,
} from "jspdf-autotable";
import {
  formatExportCellText,
  type ScheduleExportCell,
  type ScheduleExportModel,
} from "./scheduleExport";

/**
 * Renders the schedule export model to a one-click PDF download. Three layouts
 * are offered because the readable choice depends on the schedule's shape:
 *  - "grid": positions across the top (familiar, best when dates outnumber positions)
 *  - "transpose": positions down the side (best for many positions / few dates)
 *  - "byDate": a vertical per-service list (most readable, phone-friendly)
 * All data resolution lives in buildScheduleExportModel; this only does layout.
 */

export type ScheduleExportLayout = "grid" | "transpose" | "byDate";

export const SCHEDULE_EXPORT_LAYOUTS: {
  value: ScheduleExportLayout;
  label: string;
}[] = [
  { value: "grid", label: "Grid (positions across)" },
  { value: "transpose", label: "By position (rows)" },
  { value: "byDate", label: "By date (list)" },
];

const ORANGE: [number, number, number] = [249, 115, 22];
const ORANGE_TINT: [number, number, number] = [255, 237, 213];
const DATE_TINT: [number, number, number] = [255, 247, 237];
const HIGHLIGHT_TINT: [number, number, number] = [253, 230, 138];
const INACTIVE_FILL: [number, number, number] = [250, 250, 250];
const MUTED: [number, number, number] = [176, 182, 191];
const INK: [number, number, number] = [17, 24, 39];
const SUBTLE_INK: [number, number, number] = [75, 85, 99];
const SERVICE_INK: [number, number, number] = [124, 45, 18];

const sanitizeFilename = (value: string) =>
  (value || "schedule")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "schedule";

/**
 * Style one assignment cell: assigned names read dark and bold so they pop,
 * unfilled-but-required slots show a muted dash, and inactive slots stay blank.
 */
const cellToDef = (cell: ScheduleExportCell): CellDef => {
  const content = formatExportCellText(cell);
  if (cell.state === "inactive") {
    return { content, styles: { fillColor: INACTIVE_FILL } };
  }
  if (cell.state === "empty") {
    return { content, styles: { textColor: MUTED, fontStyle: "italic" } };
  }
  return {
    content,
    styles: cell.highlighted
      ? { fillColor: HIGHLIGHT_TINT, textColor: INK, fontStyle: "bold" }
      : { textColor: INK, fontStyle: "bold" },
  };
};

const serviceCaption = (serviceName: string, timingLabel: string) =>
  timingLabel ? `${serviceName}    ${timingLabel}` : serviceName;

type LayoutTable = {
  head: RowInput[];
  body: RowInput[];
  /** Per-column style overrides (e.g. the label column). */
  columnStyles?: Record<number, Partial<Styles>>;
};

const gridTable = (model: ScheduleExportModel): LayoutTable => {
  const columnCount = model.columnLabels.length + 1;
  const head: RowInput[] = [["Date", ...model.columnLabels]];
  const body: RowInput[] = [];
  model.groups.forEach((group) => {
    body.push([
      {
        content: serviceCaption(group.serviceName, group.timingLabel),
        colSpan: columnCount,
        styles: {
          fillColor: ORANGE_TINT,
          textColor: SERVICE_INK,
          fontStyle: "bold",
        },
      },
    ]);
    group.rows.forEach((row) => {
      body.push([
        {
          content: row.rowLabel,
          styles: { fillColor: DATE_TINT, fontStyle: "bold" },
        },
        ...row.cells.map(cellToDef),
      ]);
    });
  });
  return {
    head,
    body,
    columnStyles: {
      0: { fillColor: DATE_TINT, fontStyle: "bold", cellWidth: "wrap" },
    },
  };
};

const transposeTable = (model: ScheduleExportModel): LayoutTable => {
  const occurrences = model.groups.flatMap((group) =>
    group.rows.map((row) => ({ rowLabel: row.rowLabel, cells: row.cells })),
  );
  // Two header rows: service names spanning their dates, then the dates.
  const serviceSpanRow: RowInput = [
    { content: "", styles: { fillColor: ORANGE } },
    ...model.groups.map((group) => ({
      content: serviceCaption(group.serviceName, group.timingLabel),
      colSpan: group.rows.length,
      styles: {
        fillColor: ORANGE_TINT,
        textColor: SERVICE_INK,
        fontStyle: "bold" as const,
      },
    })),
  ];
  const dateRow: RowInput = [
    "Position",
    ...occurrences.map((occurrence) => occurrence.rowLabel),
  ];
  const body: RowInput[] = model.columnLabels.map((label, columnIndex) => [
    { content: label, styles: { fillColor: DATE_TINT, fontStyle: "bold" } },
    ...occurrences.map((occurrence) =>
      cellToDef(occurrence.cells[columnIndex]),
    ),
  ]);
  return {
    head: [serviceSpanRow, dateRow],
    body,
    columnStyles: {
      0: { fillColor: DATE_TINT, fontStyle: "bold", cellWidth: "wrap" },
    },
  };
};

const byDateTable = (model: ScheduleExportModel): LayoutTable => {
  const head: RowInput[] = [["Position", "Assigned"]];
  const body: RowInput[] = [];
  model.groups.forEach((group) => {
    group.rows.forEach((row) => {
      body.push([
        {
          content: `${group.serviceName} — ${row.rowLabel}${
            group.timingLabel ? `  (${group.timingLabel})` : ""
          }`,
          colSpan: 2,
          styles: {
            fillColor: ORANGE_TINT,
            textColor: SERVICE_INK,
            fontStyle: "bold",
          },
        },
      ]);
      model.columnLabels.forEach((label, columnIndex) => {
        const cell = row.cells[columnIndex];
        if (cell.state === "inactive") return; // role not needed this service
        const assignee = cellToDef(cell);
        body.push([
          { content: label, styles: { textColor: SUBTLE_INK } },
          assignee,
        ]);
      });
    });
  });
  return {
    head,
    body,
    columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" } },
  };
};

const LAYOUT_BUILDERS: Record<
  ScheduleExportLayout,
  (model: ScheduleExportModel) => LayoutTable
> = {
  grid: gridTable,
  transpose: transposeTable,
  byDate: byDateTable,
};

export const formatSchedulePdfGeneratedAtLabel = (date = new Date()) =>
  date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const buildSchedulePdf = (
  model: ScheduleExportModel,
  layout: ScheduleExportLayout = "grid",
): jsPDF => {
  const generatedAtLabel = formatSchedulePdfGeneratedAtLabel();
  // The vertical list reads best in portrait; the wide matrices need landscape.
  const orientation = layout === "byDate" ? "portrait" : "landscape";
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const { head, body, columnStyles } = LAYOUT_BUILDERS[layout](model);

  const marginTop = 78;
  const drawHeader = () => {
    const left = 32;
    if (model.churchName) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(180, 83, 9);
      doc.text(model.churchName.toUpperCase(), left, 30);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(model.scheduleName || "Schedule", left, 48);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...SUBTLE_INK);
    const metaParts = [model.dateRangeLabel].filter(Boolean);
    if (model.highlightName)
      metaParts.push(`Highlighting ${model.highlightName}`);
    if (metaParts.length) doc.text(metaParts.join("   ·   "), left, 62);
  };

  const drawFooter = (pageNumber: number, pageCount: number) => {
    const pageSize = doc.internal.pageSize;
    const y = pageSize.getHeight() - 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${generatedAtLabel}`, 32, y);
    doc.text(
      `Page ${pageNumber} of ${pageCount}`,
      pageSize.getWidth() - 32,
      y,
      {
        align: "right",
      },
    );
  };

  autoTable(doc, {
    head,
    body,
    startY: marginTop,
    margin: { top: marginTop, left: 32, right: 32, bottom: 28 },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: ORANGE,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    columnStyles,
    didDrawPage: () => {
      drawHeader();
    },
  });

  // Total page count is only known after layout, so stamp footers in a second pass.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawFooter(page, pageCount);
  }

  return doc;
};

export const downloadSchedulePdf = (
  model: ScheduleExportModel,
  layout: ScheduleExportLayout = "grid",
): void => {
  const doc = buildSchedulePdf(model, layout);
  doc.save(`${sanitizeFilename(model.scheduleName)}.pdf`);
};
