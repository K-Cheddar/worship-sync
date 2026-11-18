import { webcrypto } from "node:crypto";

Object.assign(globalThis, {
  self: globalThis,
  window: {},
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  localStorage: (() => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
    };
  })(),
});
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
