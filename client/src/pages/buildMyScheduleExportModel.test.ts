import { buildMyScheduleExportModel } from "./buildMyScheduleExportModel";
import type { MyScheduleOccurrence } from "../api/auth";

const occurrence = (
  overrides: Partial<MyScheduleOccurrence> = {},
): MyScheduleOccurrence => ({
  occurrenceId: "svc@2099-09-06",
  serviceIds: ["svc"],
  name: "Sunday Gathering",
  date: "2099-09-06",
  startsAt: "2099-09-06T15:00:00.000Z",
  serving: [
    {
      memberId: "m1",
      name: "Kevin Cheddar",
      isMe: true,
      scheduleId: "sched-1",
      teamId: "team-media",
      teamName: "Media",
      positionId: "pos-director",
      positionName: "Director",
      columnKey: "pos-director::0",
      isPrimary: true,
    },
    {
      memberId: "",
      name: "Ada R.",
      isMe: false,
      scheduleId: "sched-1",
      teamId: "team-media",
      teamName: "Media",
      positionId: "pos-camera",
      positionName: "Camera",
      columnKey: "pos-camera::0",
      isPrimary: true,
    },
    {
      memberId: "",
      name: "Sam S.",
      isMe: false,
      scheduleId: "sched-1",
      teamId: "team-media",
      teamName: "Media",
      positionId: "pos-camera",
      positionName: "Camera",
      columnKey: "pos-camera::0",
      isPrimary: false,
    },
  ],
  plan: null,
  ...overrides,
});

describe("buildMyScheduleExportModel", () => {
  it("builds a by-date export model with the viewer highlighted", () => {
    const model = buildMyScheduleExportModel(occurrence());

    expect(model.highlightName).toBe("Kevin Cheddar");
    expect(model.columnLabels).toEqual(["Camera", "Director"]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].rows).toHaveLength(1);

    const cells = model.groups[0].rows[0].cells;
    expect(cells).toHaveLength(2);
    const director = cells.find((cell) =>
      cell.tokens.some((token) => token.name === "Kevin Cheddar"),
    );
    expect(director?.highlighted).toBe(true);
    expect(director?.tokens[0].highlighted).toBe(true);

    const camera = cells.find((cell) =>
      cell.tokens.some((token) => token.name === "Ada R."),
    );
    expect(camera?.tokens.map((token) => token.roleNote)).toEqual([
      "",
      "shadow",
    ]);
  });
});
