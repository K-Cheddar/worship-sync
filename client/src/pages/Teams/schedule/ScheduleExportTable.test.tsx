import { fireEvent, render, screen, within } from "@testing-library/react";
import ScheduleExportTable from "./ScheduleExportTable";
import { EXPORT_EMPTY_SLOT_LABEL, type ScheduleExportModel } from "./scheduleExport";

const model = (): ScheduleExportModel => ({
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
              tokens: [{ name: "Josh", roleNote: "", highlighted: false }],
            },
          ],
        },
        {
          occurrenceId: "o2",
          rowLabel: "May 9",
          cells: [
            {
              state: "filled",
              highlighted: false,
              tokens: [{ name: "Alex", roleNote: "", highlighted: false }],
            },
            {
              state: "empty",
              highlighted: false,
              tokens: [],
            },
          ],
        },
      ],
    },
  ],
});

test("highlights the focused row and column in the grid layout", () => {
  render(<ScheduleExportTable model={model()} layout="grid" theme="light" />);

  const table = screen.getByRole("table");
  fireEvent.click(within(table).getByText("Josh"));

  expect(within(table).getByRole("cell", { name: "Josh" })).toHaveClass("ring-1");
  expect(within(table).getByRole("columnheader", { name: "May 2" })).toHaveClass("ring-1");
  expect(within(table).getByRole("columnheader", { name: "Camera 1" })).toHaveClass(
    "ring-1",
  );
  expect(within(table).getByRole("columnheader", { name: "Director" })).not.toHaveClass(
    "ring-1",
  );
  expect(within(table).getByRole("cell", { name: "Alex" })).not.toHaveClass("ring-1");
});

test("clears the axis highlight when clicking outside the grid", () => {
  render(
    <div>
      <button type="button">Outside</button>
      <ScheduleExportTable model={model()} layout="grid" theme="light" />
    </div>,
  );

  const table = screen.getByRole("table");
  fireEvent.click(within(table).getByText("Josh"));
  expect(within(table).getByRole("cell", { name: "Josh" })).toHaveClass("ring-1");

  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(within(table).getByRole("cell", { name: "Josh" })).not.toHaveClass("ring-1");
});

test("highlights the focused row and column in the transpose layout", () => {
  render(<ScheduleExportTable model={model()} layout="transpose" theme="light" />);

  const table = screen.getByRole("table");
  fireEvent.click(within(table).getByText("Josh"));

  expect(within(table).getByRole("cell", { name: "Josh" })).toHaveClass("ring-1");
  expect(within(table).getByRole("columnheader", { name: "May 2" })).toHaveClass("ring-1");
  expect(within(table).getByText("Camera 1")).toHaveClass("ring-1");
  expect(within(table).getByText("Director")).not.toHaveClass("ring-1");
  expect(within(table).getByRole("cell", { name: "Alex" })).not.toHaveClass("ring-1");
});

test("renders empty slots as a dash and highlights a member in the by date layout", () => {
  const highlightedModel: ScheduleExportModel = {
    ...model(),
    highlightName: "Brandon",
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
                highlighted: true,
                tokens: [{ name: "Brandon", roleNote: "", highlighted: true }],
              },
              {
                state: "filled",
                highlighted: false,
                tokens: [{ name: "Josh", roleNote: "", highlighted: false }],
              },
            ],
          },
          {
            occurrenceId: "o2",
            rowLabel: "May 9",
            cells: [
              {
                state: "filled",
                highlighted: false,
                tokens: [{ name: "Alex", roleNote: "", highlighted: false }],
              },
              {
                state: "empty",
                highlighted: false,
                tokens: [],
              },
            ],
          },
        ],
      },
    ],
  };

  render(<ScheduleExportTable model={highlightedModel} layout="byDate" theme="light" />);

  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Brandon")).toHaveClass("bg-amber-200");
  expect(screen.getByText("Sabbath — May 9")).toBeInTheDocument();
  expect(screen.getByText(EXPORT_EMPTY_SLOT_LABEL)).toBeInTheDocument();
});

test("keeps duplicate position labels distinct in the by date layout", () => {
  const duplicateLabelModel: ScheduleExportModel = {
    ...model(),
    columnLabels: ["Vocal", "Vocal"],
    columnKeys: ["v1::0", "v2::0"],
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
                highlighted: false,
                tokens: [{ name: "Sam", roleNote: "", highlighted: false }],
              },
              {
                state: "filled",
                highlighted: false,
                tokens: [{ name: "Riley", roleNote: "", highlighted: false }],
              },
            ],
          },
        ],
      },
    ],
  };

  render(<ScheduleExportTable model={duplicateLabelModel} layout="byDate" theme="light" />);

  const vocalLabels = screen.getAllByText("Vocal");
  expect(vocalLabels).toHaveLength(2);
  expect(screen.getByText("Sam")).toBeInTheDocument();
  expect(screen.getByText("Riley")).toBeInTheDocument();
});
