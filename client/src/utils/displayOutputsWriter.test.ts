import { type Database } from "firebase/database";
import { writeDisplayOutputs } from "./displayOutputsWriter";
import { DisplayOutput } from "./displayOutputs";

const setMock = jest.fn().mockResolvedValue(undefined);
const updateMock = jest.fn().mockResolvedValue(undefined);

jest.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  set: (target: unknown, value: unknown) => setMock(target, value),
  update: (target: unknown, value: unknown) => updateMock(target, value),
}));

const db = {} as Database;

const output = (id: string, order: number): DisplayOutput => ({
  id,
  type: "projector",
  name: id,
  order,
  enabled: true,
});

beforeEach(() => {
  setMock.mockClear().mockResolvedValue(undefined);
  updateMock.mockClear().mockResolvedValue(undefined);
});

describe("persisting the display registry", () => {
  it("does not write unchanged outputs", async () => {
    const previous = [output("projector", 0), output("out_lobby", 1)];
    const next = [output("projector", 0), output("out_lobby", 1)];

    await writeDisplayOutputs(db, "church-1", next, previous);

    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("writes only the output that changed", async () => {
    const previous = [output("projector", 0), output("out_lobby", 1)];
    const next = [output("projector", 0), output("out_lobby", 2)];

    await writeDisplayOutputs(db, "church-1", next, previous);

    const [, payload] = updateMock.mock.calls[0];
    expect(Object.keys(payload)).toEqual(["out_lobby"]);
  });

  it("nulls a display that was removed", async () => {
    const previous = [output("projector", 0), output("out_lobby", 1)];
    const next = [output("projector", 0)];

    await writeDisplayOutputs(db, "church-1", next, previous);

    const [, payload] = updateMock.mock.calls[0];
    expect(payload.out_lobby).toBeNull();
    expect(payload).not.toHaveProperty("projector");
  });

  it("writes whole when it cannot tell a removal from an absence", async () => {
    await writeDisplayOutputs(db, "church-1", [output("projector", 0)]);

    expect(updateMock).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("reports failure instead of throwing at the operator", async () => {
    updateMock.mockRejectedValue(new Error("offline"));

    await expect(
      writeDisplayOutputs(db, "church-1", [output("projector", 0)], []),
    ).resolves.toBe(false);
  });

  it("does nothing without a church", async () => {
    await expect(
      writeDisplayOutputs(db, null, [output("projector", 0)], []),
    ).resolves.toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});
