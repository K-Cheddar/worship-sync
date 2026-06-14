import {
  buildSchedulePdf,
  formatSchedulePdfGeneratedAtLabel,
  SCHEDULE_EXPORT_LAYOUTS,
  type ScheduleExportLayout,
} from "./scheduleExportPdf";
import type { ScheduleExportModel } from "./scheduleExport";

const model = (
  overrides: Partial<ScheduleExportModel> = {},
): ScheduleExportModel => ({
  churchName: "Grace Chapel",
  scheduleName: "May 2026",
  dateRangeLabel: "May 1 – May 31, 2026",
  highlightName: "",
  columnLabels: ["Director", "Camera 1"],
  columnKeys: ["dir::0", "cam::0"],
  groups: [
    {
      serviceName: "Sabbath",
      timingLabel: "Saturdays · 10:00 AM",
      rows: [
        {
          occurrenceId: "o1",
          rowLabel: "May 2",
          cells: [
            {
              state: "filled",
              highlighted: false,
              tokens: [{ name: "Brandon", roleNote: "", highlighted: false }],
            },
            {
              state: "filled",
              highlighted: false,
              tokens: [
                { name: "Josh", roleNote: "", highlighted: false },
                { name: "Danielle", roleNote: "shadow", highlighted: false },
              ],
            },
          ],
        },
        {
          occurrenceId: "o2",
          rowLabel: "May 9",
          cells: [
            { state: "empty", highlighted: false, tokens: [] },
            { state: "inactive", highlighted: false, tokens: [] },
          ],
        },
      ],
    },
  ],
  ...overrides,
});

const LAYOUTS = SCHEDULE_EXPORT_LAYOUTS.map((option) => option.value);

describe("formatSchedulePdfGeneratedAtLabel", () => {
  it("formats a medium date and short time for the PDF footer", () => {
    expect(
      formatSchedulePdfGeneratedAtLabel(new Date("2026-06-08T20:30:00")),
    ).toMatch(/Jun 8, 2026/);
  });
});

describe("buildSchedulePdf", () => {
  it.each(LAYOUTS)("produces a non-empty PDF for the %s layout", (layout) => {
    const doc = buildSchedulePdf(model(), layout as ScheduleExportLayout);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const bytes = doc.output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("renders without throwing when a member is highlighted", () => {
    expect(() =>
      buildSchedulePdf(
        model({
          highlightName: "Danielle",
          groups: [
            {
              serviceName: "Sabbath",
              timingLabel: "",
              rows: [
                {
                  occurrenceId: "o1",
                  rowLabel: "May 2",
                  cells: [
                    {
                      state: "filled",
                      highlighted: true,
                      tokens: [
                        {
                          name: "Danielle",
                          roleNote: "shadow",
                          highlighted: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          columnLabels: ["Camera 1"],
          columnKeys: ["cam::0"],
        }),
      ),
    ).not.toThrow();
  });

  it.each(LAYOUTS)(
    "handles an empty schedule (no groups) without throwing for %s",
    (layout) => {
      expect(() =>
        buildSchedulePdf(model({ groups: [] }), layout as ScheduleExportLayout),
      ).not.toThrow();
    },
  );
});
