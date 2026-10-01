/** Shares one underlying event subscription between consumers in this renderer. */
export const createSharedEventSubscription = <T,>(
  start: (publish: (value: T) => void) => () => void,
) => {
  const listeners = new Map<(value: T) => void, number>();
  let stop: (() => void) | undefined;

  return {
    subscribe(listener: (value: T) => void): () => void {
      listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
      if (!stop) {
        stop = start((value) => {
          listeners.forEach((_count, current) => current(value));
        });
      }
      return () => {
        const count = listeners.get(listener) ?? 0;
        if (count > 1) listeners.set(listener, count - 1);
        else listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = undefined;
        }
      };
    },
  };
};
