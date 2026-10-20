import { type Database } from "firebase/database";
import { writeControllerProfiles } from "./controllerProfilesWriter";
import { getDefaultControllerProfiles } from "./controllerProfiles";

const setMock = jest.fn().mockResolvedValue(undefined);
const updateMock = jest.fn().mockResolvedValue(undefined);

jest.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  set: (target: unknown, value: unknown) => setMock(target, value),
  update: (target: unknown, value: unknown) => updateMock(target, value),
}));

const db = {} as Database;

beforeEach(() => {
  setMock.mockClear().mockResolvedValue(undefined);
  updateMock.mockClear().mockResolvedValue(undefined);
});

describe("persisting controller profiles", () => {
  it("writes configured icons and colors in the church-scoped profile update", async () => {
    const previous = getDefaultControllerProfiles();
    const next = previous.map((profile) =>
      profile.id === "presentation"
        ? { ...profile, icon: "captions" as const, iconColor: "teal" as const }
        : profile,
    );

    await writeControllerProfiles(db, "church-1", next, previous);

    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [target, payload] = updateMock.mock.calls[0];
    expect(target.path).toBe("churches/church-1/data/controllerProfiles");
    expect(payload).toEqual({
      presentation: expect.objectContaining({
        icon: "captions",
        iconColor: "teal",
      }),
    });
  });
});
