let _offset = 0;
const offsetListeners = new Set<() => void>();

export const setServerTimeOffset = (offset: number): void => {
  if (_offset === offset) return;
  _offset = offset;
  [...offsetListeners].forEach((listener) => listener());
};

export const getServerTimeOffset = (): number => _offset;

export const subscribeServerTimeOffset = (listener: () => void) => {
  offsetListeners.add(listener);
  return () => {
    offsetListeners.delete(listener);
  };
};

export const serverNow = (): number => Date.now() + _offset;

export const serverDate = (): Date => new Date(serverNow());
