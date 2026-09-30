import { createSharedEventSubscription } from "./rendererSubscription";

describe("shared renderer event subscription", () => {
  it("keeps one upstream subscription until the last local consumer leaves", () => {
    let publish: ((value: number) => void) | undefined;
    const start = jest.fn((callback: (value: number) => void) => {
      publish = callback;
      return jest.fn();
    });
    const listenerHub = createSharedEventSubscription(start);
    const first = jest.fn();
    const second = jest.fn();

    const removeFirst = listenerHub.subscribe(first);
    const removeSecond = listenerHub.subscribe(second);
    publish?.(1);
    removeFirst();
    publish?.(2);
    removeSecond();

    expect(start).toHaveBeenCalledTimes(1);
    expect(first.mock.calls).toEqual([[1]]);
    expect(second.mock.calls).toEqual([[1], [2]]);
    expect(start.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh upstream subscription after a full unmount and remount", () => {
    const stop = jest.fn();
    const start = jest.fn(() => stop);
    const listenerHub = createSharedEventSubscription<number>(start);
    const remove = listenerHub.subscribe(jest.fn());
    remove();
    listenerHub.subscribe(jest.fn());

    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
