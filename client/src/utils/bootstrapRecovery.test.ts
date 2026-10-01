import {
  BOOTSTRAP_RELOAD_FLAG,
  isModuleLoadError,
  loadBootstrapModule,
  loadSelectedBootstrapModule,
  normalizeBootstrapPathname,
} from "./bootstrapRecovery";

const noWait = async () => {};

describe("bootstrap module recovery", () => {
  let reload: jest.Mock;
  let storage: Storage;

  beforeEach(() => {
    window.sessionStorage.clear();
    storage = window.sessionStorage;
    reload = jest.fn();
  });

  it("loads the public root on the first try", async () => {
    const publicModule = { default: "PublicRoot" };
    const publicLoader = jest.fn().mockResolvedValue(publicModule);
    const operatorLoader = jest.fn();

    await expect(
      loadSelectedBootstrapModule(
        true,
        { public: publicLoader, operator: operatorLoader },
        { reload, storage, wait: noWait },
      ),
    ).resolves.toEqual({ status: "loaded", module: publicModule });

    expect(publicLoader).toHaveBeenCalledTimes(1);
    expect(operatorLoader).not.toHaveBeenCalled();
  });

  it("loads the operator root on the first try", async () => {
    const operatorModule = { default: "OperatorRoot" };
    const publicLoader = jest.fn();
    const operatorLoader = jest.fn().mockResolvedValue(operatorModule);

    await expect(
      loadSelectedBootstrapModule(
        false,
        { public: publicLoader, operator: operatorLoader },
        { reload, storage, wait: noWait },
      ),
    ).resolves.toEqual({ status: "loaded", module: operatorModule });

    expect(operatorLoader).toHaveBeenCalledTimes(1);
    expect(publicLoader).not.toHaveBeenCalled();
  });

  it("retries once and succeeds after a transient module failure", async () => {
    const module = { default: "Root" };
    const load = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Importing a module script failed."))
      .mockResolvedValue(module);

    await expect(
      loadBootstrapModule(load, { reload, storage, wait: noWait }),
    ).resolves.toEqual({ status: "loaded", module });
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("requests one guarded reload after the retry also fails", async () => {
    const load = jest.fn().mockRejectedValue(new Error("Failed to load module script"));
    const failures: string[] = [];

    const result = await loadBootstrapModule(load, {
      reload,
      storage,
      wait: noWait,
      onFailure: (stage) => {
        failures.push(stage);
      },
    });

    expect(result.status).toBe("failed");
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(BOOTSTRAP_RELOAD_FLAG)).toBe("1");
    expect(failures).toEqual(["first failure", "retry failure"]);
  });

  it("does not reload again when the bootstrap marker already exists", async () => {
    storage.setItem(BOOTSTRAP_RELOAD_FLAG, "1");
    const load = jest.fn().mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    const failures: string[] = [];

    const result = await loadBootstrapModule(load, {
      reload,
      storage,
      wait: noWait,
      onFailure: (stage) => {
        failures.push(stage);
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      stage: "post-reload retry failure",
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    expect(failures).toEqual([
      "post-reload failure",
      "post-reload retry failure",
    ]);
  });

  it("provides both errors when a retry failure requires reload", async () => {
    const firstError = new Error("Importing a module script failed.");
    const retryError = new Error("Failed to load module script");
    const load = jest
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(retryError);
    const failures: Array<[string, unknown, unknown?]> = [];

    await loadBootstrapModule(load, {
      reload,
      storage,
      wait: noWait,
      onFailure: (stage, error, previousError) => {
        failures.push([stage, error, previousError]);
      },
    });

    expect(failures).toEqual([
      ["first failure", firstError, undefined],
      ["retry failure", retryError, firstError],
    ]);
  });

  it("does not retry or reload for a non-module startup error", async () => {
    const error = new Error("Unexpected startup configuration error");
    const load = jest.fn().mockRejectedValue(error);

    await expect(
      loadBootstrapModule(load, { reload, storage, wait: noWait }),
    ).resolves.toEqual({ status: "failed", error, stage: "first failure" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the reload marker after a successful bootstrap load", async () => {
    storage.setItem(BOOTSTRAP_RELOAD_FLAG, "1");

    await loadBootstrapModule(
      async () => ({ default: "Root" }),
      { reload, storage, wait: noWait },
    );

    expect(storage.getItem(BOOTSTRAP_RELOAD_FLAG)).toBeNull();
  });

  it("fails closed when session storage throws", async () => {
    const blockedStorage = {
      getItem: jest.fn(() => {
        throw new Error("Storage is blocked");
      }),
      setItem: jest.fn(() => {
        throw new Error("Storage is blocked");
      }),
      removeItem: jest.fn(),
    } as unknown as Storage;
    const load = jest.fn().mockRejectedValue(new Error("Importing a module script failed"));

    const firstResult = await loadBootstrapModule(load, {
      reload,
      storage: blockedStorage,
      wait: noWait,
    });
    const secondResult = await loadBootstrapModule(load, {
      reload,
      storage: blockedStorage,
      wait: noWait,
    });

    expect(firstResult.status).toBe("failed");
    expect(secondResult.status).toBe("failed");
    expect(load).toHaveBeenCalledTimes(4);
    expect(blockedStorage.setItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("recognizes Safari and Chromium dynamic import failure messages", () => {
    expect(isModuleLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
  });

  it("normalizes tokenized public routes before recording diagnostic paths", () => {
    expect(normalizeBootstrapPathname("/teams/schedule/secret-share-token"))
      .toBe("/teams/schedule/:token");
    expect(normalizeBootstrapPathname("/services/private-share-id"))
      .toBe("/services/:shareId");
    expect(normalizeBootstrapPathname("/a/private-token"))
      .toBe("/a/:token");
    expect(normalizeBootstrapPathname("/sms-opt-in/private-church-id"))
      .toBe("/sms-opt-in/:churchId");
    expect(normalizeBootstrapPathname("/boards/controller"))
      .toBe("/boards/controller");
    expect(normalizeBootstrapPathname("/boards/display"))
      .toBe("/boards/display");
    expect(normalizeBootstrapPathname("/boards/example-alias"))
      .toBe("/boards/:aliasId");
    expect(normalizeBootstrapPathname("/boards/present/example-alias"))
      .toBe("/boards/present/:aliasId");
    expect(normalizeBootstrapPathname("/controller"))
      .toBe("/controller");
  });
});
