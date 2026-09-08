import {
  BootstrapTimeoutError,
  withBootstrapTimeout,
} from "./bootstrapTimeout";

describe("withBootstrapTimeout", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("passes a result straight through", async () => {
    await expect(
      withBootstrapTimeout(Promise.resolve("bootstrap"), 50),
    ).resolves.toBe("bootstrap");
  });

  it("passes a failure straight through, so retries still see it", async () => {
    await expect(
      withBootstrapTimeout(Promise.reject(new Error("offline")), 50),
    ).rejects.toThrow("offline");
  });

  it("rejects a request that never settles", async () => {
    jest.useFakeTimers();
    const hung = new Promise<string>(() => {});
    const raced = withBootstrapTimeout(hung, 15_000);
    // Without this the caller's promise never settles, its `finally` never
    // runs, and a display stays on its blank loading placeholder for good.
    jest.advanceTimersByTime(15_000);
    await expect(raced).rejects.toBeInstanceOf(BootstrapTimeoutError);
  });

  it("does not leave its timer running after the work settles", async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    await withBootstrapTimeout(Promise.resolve("done"), 15_000);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
