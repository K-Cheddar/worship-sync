import {
  isDesktopBrokerAuthCompleted,
  markDesktopBrokerAuthCompleted,
  readDesktopSsoCompleteFlashOnce,
  setDesktopSsoCompleteFlash,
} from "./desktopSsoBrowserSession";

const memoryStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => {
        delete store[key];
      });
    },
  };
};

describe("desktopSsoBrowserSession", () => {
  beforeEach(() => {
    Object.defineProperty(window, "sessionStorage", {
      value: memoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it("tracks completed desktop auth ids", () => {
    expect(isDesktopBrokerAuthCompleted("desktop-1")).toBe(false);
    markDesktopBrokerAuthCompleted(" desktop-1 ");
    expect(isDesktopBrokerAuthCompleted("desktop-1")).toBe(true);
  });

  it("returns the latest flash payload after multiple writes", () => {
    setDesktopSsoCompleteFlash("google");
    expect(readDesktopSsoCompleteFlashOnce()).toEqual({
      provider: "google",
      v: 1,
    });

    setDesktopSsoCompleteFlash("microsoft");
    expect(readDesktopSsoCompleteFlashOnce()).toEqual({
      provider: "microsoft",
      v: 1,
    });
  });
});
