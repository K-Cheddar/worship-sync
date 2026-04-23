import { persistExistingOverlayDoc } from "./persistOverlayDoc";

describe("persistExistingOverlayDoc", () => {
  it("retries after a Pouch conflict and returns the persisted doc", async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({
        _id: "overlay-1",
        _rev: "1-a",
        id: "1",
        type: "participant",
        name: "Old",
        event: "Welcome",
      })
      .mockResolvedValueOnce({
        _id: "overlay-1",
        _rev: "2-b",
        id: "1",
        type: "participant",
        name: "Older",
        event: "Welcome",
      });
    const put = jest
      .fn()
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({ ok: true, rev: "3-c" });

    const persisted = await persistExistingOverlayDoc(
      { get, put },
      {
        id: "1",
        type: "participant",
        name: "New Name",
        event: "Welcome",
      },
    );

    expect(get).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(2);
    expect(persisted._rev).toBe("3-c");
    expect(persisted.name).toBe("New Name");
  });
});
