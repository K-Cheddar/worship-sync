import {
  DESKTOP_SSO_COMPLETE_FLASH_KEY,
  getDesktopSsoCompleteReplaceHref,
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

  it("ignores blank ids and trims the completed-id list", () => {
    markDesktopBrokerAuthCompleted("   ");
    expect(isDesktopBrokerAuthCompleted("")).toBe(false);

    for (let i = 0; i < 45; i += 1) {
      markDesktopBrokerAuthCompleted(`id-${i}`);
    }
    expect(isDesktopBrokerAuthCompleted("id-0")).toBe(false);
    expect(isDesktopBrokerAuthCompleted("id-44")).toBe(true);
  });

  it("tolerates corrupt completed-id storage", () => {
    sessionStorage.setItem("ws-desktop-broker-completed-ids", "{not-json");
    expect(isDesktopBrokerAuthCompleted("desktop-1")).toBe(false);

    sessionStorage.setItem("ws-desktop-broker-completed-ids", '"oops"');
    markDesktopBrokerAuthCompleted("desktop-2");
    expect(isDesktopBrokerAuthCompleted("desktop-2")).toBe(true);
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

  it("reads a one-time flash from sessionStorage on a fresh module load", () => {
    jest.isolateModules(() => {
      sessionStorage.setItem(
        DESKTOP_SSO_COMPLETE_FLASH_KEY,
        JSON.stringify({ provider: "google", v: 1 }),
      );
      const fresh =
        require("./desktopSsoBrowserSession") as typeof import("./desktopSsoBrowserSession");
      expect(fresh.readDesktopSsoCompleteFlashOnce()).toEqual({
        provider: "google",
        v: 1,
      });
      expect(sessionStorage.getItem(DESKTOP_SSO_COMPLETE_FLASH_KEY)).toBeNull();
      expect(fresh.readDesktopSsoCompleteFlashOnce()).toEqual({
        provider: "google",
        v: 1,
      });
    });
  });

  it("clears invalid flash payloads and builds the desktop SSO href", () => {
    jest.isolateModules(() => {
      sessionStorage.setItem(
        DESKTOP_SSO_COMPLETE_FLASH_KEY,
        JSON.stringify({ provider: "twitter", v: 1 }),
      );
      const fresh =
        require("./desktopSsoBrowserSession") as typeof import("./desktopSsoBrowserSession");
      expect(fresh.readDesktopSsoCompleteFlashOnce()).toBeNull();
    });

    expect(getDesktopSsoCompleteReplaceHref()).toContain(
      "#/login/desktop-sso-complete",
    );
  });
});
