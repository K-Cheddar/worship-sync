import { BrowserWindow } from "electron";
import { createDisplayWindow } from "./windowHelpers";

jest.mock("electron", () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn(),
    loadFile: jest.fn(),
  })),
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
