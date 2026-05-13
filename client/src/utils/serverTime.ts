let _offset = 0;

export const setServerTimeOffset = (offset: number): void => {
  _offset = offset;
};

export const serverNow = (): number => Date.now() + _offset;
