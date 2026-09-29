import { formatEntitySaveToast } from "./teamsSaveToasts";

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
