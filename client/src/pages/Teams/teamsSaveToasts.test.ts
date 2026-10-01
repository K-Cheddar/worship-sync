import { formatEntitySaveToast, formatTeamSaveToast } from "./teamsSaveToasts";

describe("formatEntitySaveToast", () => {
  it("suppresses an update confirmation that only says the save succeeded", () => {
    expect(formatEntitySaveToast("Worship", false, [])).toBeNull();
  });

  it("retains creation names and update summaries that explain what changed", () => {
    expect(formatEntitySaveToast("Worship", true, [])).toBe("Added Worship.");
    expect(formatEntitySaveToast("Worship", false, ["Members: added Rae Kim"])).toBe(
      "Updated Worship: Members: added Rae Kim.",
    );
  });
});

it("compares structured team icon refs and colors in save summaries", () => {
  const previous = {
    churchId: "church-1",
    teamId: "team-1",
    name: "Media",
    memberIds: [],
    icon: { source: "lucide", name: "Camera", color: "#22c55e" } as const,
  };
  const context = { memberNameById: new Map<string, string>() };

  expect(formatTeamSaveToast(previous, {
    name: "Media",
    memberIds: [],
    icon: { source: "lucide", name: "Camera", color: "#ef4444" },
  }, context)).toBe("Updated Media: Icon.");
  expect(formatTeamSaveToast({ ...previous, icon: "Music" }, {
    name: "Media",
    memberIds: [],
    icon: "Music",
  }, context)).toBeNull();
});
