import * as serviceWorkerRegistration from "./serviceWorkerRegistration";

class MockServiceWorker extends EventTarget {
  state: ServiceWorkerState;

  postMessage = jest.fn();

  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }
}

class MockServiceWorkerRegistration extends EventTarget {
  installing: ServiceWorker | null = null;

  waiting: ServiceWorker | null = null;

  update = jest.fn<Promise<void>, []>(async () => {});
}

describe("checkForUpdate", () => {
  const originalServiceWorker = navigator.serviceWorker;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  it("activates a waiting worker and reloads at the explicit refresh point", async () => {
    const registration = new MockServiceWorkerRegistration();
    const waitingWorker = new MockServiceWorker("installed");
    registration.waiting = waitingWorker as unknown as ServiceWorker;

    const serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorkerContainer, "getRegistration", {
      value: jest.fn().mockResolvedValue(registration),
    });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorkerContainer,
    });

    const updatePromise = serviceWorkerRegistration.checkForUpdate();
    await Promise.resolve();

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });

    waitingWorker.state = "activated";
    waitingWorker.dispatchEvent(new Event("statechange"));

    await expect(updatePromise).resolves.toBe("updated");
  });

  it("returns upToDate when no service worker update is available", async () => {
    const registration = new MockServiceWorkerRegistration();

    const serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorkerContainer, "getRegistration", {
      value: jest.fn().mockResolvedValue(registration),
    });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorkerContainer,
    });

    const updatePromise = serviceWorkerRegistration.checkForUpdate();
    await Promise.resolve();
    jest.advanceTimersByTime(1500);
    await Promise.resolve();

    await expect(updatePromise).resolves.toBe("upToDate");
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("promotes a newly installed worker found during the manual check", async () => {
    const registration = new MockServiceWorkerRegistration();
    const installingWorker = new MockServiceWorker("installing");
    const waitingWorker = new MockServiceWorker("installed");
    waitingWorker.postMessage.mockImplementation(() => {
      waitingWorker.state = "activated";
      waitingWorker.dispatchEvent(new Event("statechange"));
    });
    registration.installing = installingWorker as unknown as ServiceWorker;

    registration.update.mockImplementation(async () => {
      registration.waiting = waitingWorker as unknown as ServiceWorker;
      installingWorker.state = "installed";
      installingWorker.dispatchEvent(new Event("statechange"));
    });

    const serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorkerContainer, "getRegistration", {
      value: jest.fn().mockResolvedValue(registration),
    });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorkerContainer,
    });

    await expect(serviceWorkerRegistration.checkForUpdate()).resolves.toBe(
      "updated",
    );

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
  });

  it("returns restartRequired when an update is found but does not take control", async () => {
    const registration = new MockServiceWorkerRegistration();
    const waitingWorker = new MockServiceWorker("installed");
    registration.waiting = waitingWorker as unknown as ServiceWorker;

    const serviceWorkerContainer = new EventTarget() as ServiceWorkerContainer;
    Object.defineProperty(serviceWorkerContainer, "getRegistration", {
      value: jest.fn().mockResolvedValue(registration),
    });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorkerContainer,
    });

    const updatePromise = serviceWorkerRegistration.checkForUpdate();
    await Promise.resolve();

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });

    jest.advanceTimersByTime(8000);
    await Promise.resolve();

    await expect(updatePromise).resolves.toBe("restartRequired");
  });
});
