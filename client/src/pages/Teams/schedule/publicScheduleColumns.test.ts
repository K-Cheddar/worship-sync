import { buildPublicScheduleColumns } from "./publicScheduleColumns";

const positions = [
  { positionId: "vocal", name: "Vocalist" },
  { positionId: "camera", name: "Camera" },
  { positionId: "director", name: "Director" },
];

describe("buildPublicScheduleColumns", () => {
  it("uses occurrence requirements and additional slots, including unfilled needs", () => {
    const occurrences = [
      { occurrenceId: "sabbath-1" },
      { occurrenceId: "sabbath-2" },
      { occurrenceId: "sabbath-3" },
    ];
    const requirementsByOccurrence = new Map([
      ["sabbath-1", [{ positionId: "vocal", count: 1 }]],
      [
        "sabbath-2",
        [
          { positionId: "vocal", count: 1 },
          { positionId: "director", count: 1 },
        ],
      ],
      ["sabbath-3", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildPublicScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      additionalPositionSlots: {
        "sabbath-2": ["vocal::1", "camera::0"],
        "unlisted-occurrence": ["director::1"],
      },
      positions,
    });

    expect(columns.map((column) => column.columnKey)).toEqual([
      "vocal::0",
      "vocal::1",
      "camera::0",
      "director::0",
    ]);
    expect(columns.map((column) => column.label)).toEqual([
      "Vocalist 1",
      "Vocalist 2",
      "Camera",
      "Director",
    ]);
  });

  it("does not infer required positions from assignments or equipment", () => {
    const columns = buildPublicScheduleColumns({
      occurrences: [{ occurrenceId: "o1" }],
      requirementsByOccurrence: new Map([
        ["o1", [{ positionId: "vocal", count: 1 }]],
      ]),
      positions,
    });

    expect(columns.map((column) => column.columnKey)).toEqual(["vocal::0"]);
  });

  it("keeps different service requirements separate by occurrence", () => {
    const columns = buildPublicScheduleColumns({
      occurrences: [{ occurrenceId: "sabbath" }, { occurrenceId: "wednesday" }],
      requirementsByOccurrence: new Map([
        ["sabbath", [{ positionId: "vocal", count: 1 }]],
        ["wednesday", [{ positionId: "camera", count: 2 }]],
      ]),
      positions,
    });

    expect(columns.map((column) => column.columnKey)).toEqual([
      "vocal::0",
      "camera::0",
      "camera::1",
    ]);
  });
});
