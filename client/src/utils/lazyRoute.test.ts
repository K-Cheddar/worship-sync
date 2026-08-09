import { loadChunk } from "./lazyRoute";

const RELOAD_FLAG = "worshipsync:chunk-reload";

describe("loadChunk", () => {
  let reload: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    window.sessionStorage.clear();
    reload = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Drains the retry delay without waiting in real time. */
  const flush = async () => {
    await Promise.resolve();
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
  };

  it("returns the module on first success", async () => {
    const mod = { default: "Component" };
    const load = jest.fn().mockResolvedValue(mod);

    await expect(loadChunk(load, reload)).resolves.toBe(mod);
    expect(load).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("retries once before giving up on the network", async () => {
    const mod = { default: "Component" };
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch module"))
      .mockResolvedValue(mod);

    const promise = loadChunk(load, reload);
    await flush();

    await expect(promise).resolves.toBe(mod);
    expect(load).toHaveBeenCalledTimes(2);
    // A transient blip must not disrupt the operator with a reload.
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when both attempts fail", async () => {
    const load = jest.fn().mockRejectedValue(new Error("404"));

    loadChunk(load, reload);
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_FLAG)).toBe("1");
  });

  it("never settles while the reload is in flight", async () => {
    const load = jest.fn().mockRejectedValue(new Error("404"));
    const settled = jest.fn();

    void loadChunk(load, reload).then(settled, settled);
    await flush();

    // Settling here would flash the error boundary before navigation.
    expect(settled).not.toHaveBeenCalled();
  });

  it("rethrows instead of reloading again after a reload already happened", async () => {
    window.sessionStorage.setItem(RELOAD_FLAG, "1");
    const error = new Error("still 404");
    const load = jest.fn().mockRejectedValue(error);

    // Attach the handler immediately so the rejection is never unhandled,
    // then assert on the captured error after the retry delay drains.
    const caught = loadChunk(load, reload).catch((e: unknown) => e);
    await flush();
    await expect(caught).resolves.toBe(error);

    // This is the loop guard: a chunk broken after reloading must not reload again.
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the guard after a successful load so a later deploy can recover", async () => {
    window.sessionStorage.setItem(RELOAD_FLAG, "1");
    const load = jest.fn().mockResolvedValue({ default: "Component" });

    await loadChunk(load, reload);

    expect(window.sessionStorage.getItem(RELOAD_FLAG)).toBeNull();
  });

  it("still reloads when sessionStorage is unavailable", async () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const load = jest.fn().mockRejectedValue(new Error("404"));

    loadChunk(load, reload);
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
