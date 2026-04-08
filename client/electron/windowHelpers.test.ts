import { BrowserWindow, shell } from "electron";
import {
  createDisplayWindow,
  setupSharedSessionWindowOpenHandler,
  shouldUseSharedSessionChildWindow,
} from "./windowHelpers";

jest.mock("electron", () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn(),
    loadFile: jest.fn(),
  })),
  shell: {
    openExternal: jest.fn(),
  },
}));

describe("createDisplayWindow", () => {
  it("disables background throttling so videos keep playing when unfocused", () => {
    createDisplayWindow({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      route: "/projector-full",
      isDev: true,
      dirname: "C:/app/dist-electron/main",
    });

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          backgroundThrottling: false,
        }),
      })
    );
  });
});

describe("shouldUseSharedSessionChildWindow", () => {
  it("allows same-app file URLs to share the session partition", () => {
    expect(
      shouldUseSharedSessionChildWindow(
        "file:///C:/app/index.html#/home",
        "file:///C:/app/index.html#/monitor"
      )
    ).toBe(true);
  });

  it("blocks external URLs from inheriting the app session", () => {
    expect(
      shouldUseSharedSessionChildWindow(
        "file:///C:/app/index.html#/home",
        "https://github.com/K-Cheddar/worship-sync/releases/latest"
      )
    ).toBe(false);
  });
});

describe("setupSharedSessionWindowOpenHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps same-app child windows in the shared partition", () => {
    const setWindowOpenHandler = jest.fn();
    const webContents = {
      getURL: () => "file:///C:/app/index.html#/home",
      setWindowOpenHandler,
    } as any;

    setupSharedSessionWindowOpenHandler(
      webContents,
      "C:/app/dist-electron/main"
    );

    const handler = setWindowOpenHandler.mock.calls[0][0];
    const result = handler({ url: "file:///C:/app/index.html#/monitor" });

    expect(result).toEqual(
      expect.objectContaining({
        action: "allow",
        overrideBrowserWindowOptions: expect.objectContaining({
          webPreferences: expect.objectContaining({
            partition: "persist:worshipsync",
          }),
        }),
      })
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("opens external URLs outside the app and denies the popup", () => {
    const setWindowOpenHandler = jest.fn();
    const webContents = {
      getURL: () => "file:///C:/app/index.html#/home",
      setWindowOpenHandler,
    } as any;

    setupSharedSessionWindowOpenHandler(
      webContents,
      "C:/app/dist-electron/main"
    );

    const handler = setWindowOpenHandler.mock.calls[0][0];
    const result = handler({
      url: "https://github.com/K-Cheddar/worship-sync/releases/latest",
    });

    expect(result).toEqual({ action: "deny" });
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest"
    );
  });
});
