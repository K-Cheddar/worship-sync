import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow, IpcMain, NativeImage } from "electron";
import {
  bindChatTaskbarLifecycle,
  createChatTaskbarController,
  findChatTaskbarOverlayIconPath,
  registerChatTaskbarIpcHandlers,
  type ChatTaskbarScope,
  type ChatTaskbarUnreadState,
} from "./chatTaskbar";

const scope: ChatTaskbarScope = { churchId: "church-1", actorId: "actor-1" };

const makeWindow = (id = 1) => {
  const window = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const webContents = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(webContents, {
    id,
    isDestroyed: () => false,
  });
  Object.assign(window, {
    isDestroyed: () => false,
    isFocused: jest.fn(() => false),
    setOverlayIcon: jest.fn(),
    flashFrame: jest.fn(),
    setProgressBar: jest.fn(),
    webContents,
  });
  return window as unknown as BrowserWindow;
};

const makeController = (
  window: BrowserWindow,
  platform = "win32",
) =>
  createChatTaskbarController({
    platform,
    getWindow: () => window,
    overlayIcon: { marker: "unread-icon" } as unknown as NativeImage,
  });

describe("chat taskbar controller", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows and clears the unread overlay without changing upload progress", () => {
    const window = makeWindow();
    const controller = makeController(window);

    expect(
      controller.setUnreadState({ scope, unread: true, revision: 1 }),
    ).toBe(true);
    expect(window.setOverlayIcon).toHaveBeenLastCalledWith(
      { marker: "unread-icon" },
      "Unread team chat messages",
    );

    expect(
      controller.setUnreadState({ scope, unread: false, revision: 2 }),
    ).toBe(true);
    expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
    expect(window.setProgressBar).not.toHaveBeenCalled();
  });

  it("rejects invalid and outdated status values", () => {
    const window = makeWindow();
    const controller = makeController(window);

    expect(controller.setUnreadState({ scope, unread: true, revision: 1 })).toBe(
      true,
    );
    expect(
      controller.setUnreadState({ scope, unread: true, revision: 1 }),
    ).toBe(false);
    expect(
      controller.setUnreadState({ scope, unread: 1, revision: 2 }),
    ).toBe(false);
    expect(
      controller.setUnreadState({
        scope: { churchId: "x".repeat(129), actorId: "actor-1" },
        unread: true,
        revision: 2,
      }),
    ).toBe(false);
    expect(window.setOverlayIcon).toHaveBeenCalledTimes(1);
  });

  it("retries an overlay update after a transient taskbar API failure", () => {
    const window = makeWindow();
    const controller = makeController(window);
    (window.setOverlayIcon as jest.Mock).mockImplementationOnce(() => {
      throw new Error("Taskbar unavailable");
    });

    expect(
      controller.setUnreadState({ scope, unread: true, revision: 1 }),
    ).toBe(false);
    expect(
      controller.setUnreadState({ scope, unread: true, revision: 2 }),
    ).toBe(true);
    expect(window.setOverlayIcon).toHaveBeenCalledTimes(2);
  });

  it("flashes only while unfocused, coalesces bursts, and stops after a bound", () => {
    jest.useFakeTimers();
    const window = makeWindow();
    const controller = makeController(window);
    controller.setUnreadState({ scope, unread: true, revision: 1 });

    (window.isFocused as jest.Mock).mockReturnValue(true);
    expect(controller.requestAttention(scope)).toBe(false);
    (window.isFocused as jest.Mock).mockReturnValue(false);
    expect(controller.requestAttention(scope)).toBe(true);
    expect(controller.requestAttention(scope)).toBe(false);
    expect(window.flashFrame).toHaveBeenCalledTimes(1);
    expect(window.flashFrame).toHaveBeenLastCalledWith(true);

    jest.advanceTimersByTime(8_000);
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
    expect(controller.requestAttention(scope)).toBe(true);
  });

  it("stops flashing on focus without clearing unread status", () => {
    const window = makeWindow();
    const controller = makeController(window);
    bindChatTaskbarLifecycle(window, controller);
    controller.setUnreadState({ scope, unread: true, revision: 1 });
    controller.requestAttention(scope);

    window.emit("focus");

    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
    expect(window.setOverlayIcon).toHaveBeenLastCalledWith(
      { marker: "unread-icon" },
      "Unread team chat messages",
    );
  });

  it.each([
    ["did-start-loading", "webContents"],
    ["render-process-gone", "webContents"],
    ["closed", "window"],
  ])("clears stale state on %s", (eventName, target) => {
    const window = makeWindow();
    const controller = makeController(window);
    bindChatTaskbarLifecycle(window, controller);
    controller.setUnreadState({ scope, unread: true, revision: 1 });
    controller.requestAttention(scope);

    const eventTarget =
      target === "window"
        ? window
        : (window.webContents as unknown as EventEmitter);
    eventTarget.emit(eventName);

    expect(window.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
    expect(
      controller.setUnreadState({ scope, unread: true, revision: 1 }),
    ).toBe(false);
    expect(
      controller.setUnreadState({ scope, unread: true, revision: 2 }),
    ).toBe(true);
  });

  it("clears on logout and rejects attention for a previous church or actor", () => {
    const window = makeWindow();
    const controller = makeController(window);
    const otherScope = { churchId: "church-2", actorId: "actor-2" };
    controller.setUnreadState({ scope, unread: true, revision: 1 });

    controller.setUnreadState({ scope: null, unread: false, revision: 2 });
    expect(controller.requestAttention(scope)).toBe(false);
    expect(
      controller.setUnreadState({ scope, unread: true, revision: 1 }),
    ).toBe(false);

    controller.setUnreadState({
      scope: otherScope,
      unread: false,
      revision: 3,
    });
    expect(controller.requestAttention(scope)).toBe(false);
  });

  it("ignores taskbar calls outside Windows", () => {
    const window = makeWindow();
    const controller = makeController(window, "darwin");

    expect(controller.setUnreadState({ scope, unread: true, revision: 1 })).toBe(
      false,
    );
    expect(controller.requestAttention(scope)).toBe(false);
    expect(window.setOverlayIcon).not.toHaveBeenCalled();
    expect(window.flashFrame).not.toHaveBeenCalled();
  });

  it("allows only the controller renderer to update or flash its taskbar", () => {
    const window = makeWindow(1);
    const controller = makeController(window);
    const handlers = new Map<
      string,
      (event: { sender: { id: number } }, value: unknown) => unknown
    >();
    const ipcMain = {
      handle: jest.fn((channel: string, handler: unknown) => {
        handlers.set(
          channel,
          handler as (event: { sender: { id: number } }, value: unknown) =>
            unknown,
        );
      }),
    } as unknown as Pick<IpcMain, "handle">;
    registerChatTaskbarIpcHandlers(ipcMain, () => window, controller);
    const update = handlers.get("set-chat-taskbar-unread")!;
    const attention = handlers.get("request-chat-taskbar-attention")!;
    const status: ChatTaskbarUnreadState = {
      scope,
      unread: true,
      revision: 1,
    };

    expect(update({ sender: { id: 2 } }, status)).toBe(false);
    expect(attention({ sender: { id: 3 } }, scope)).toBe(false);
    expect(window.setOverlayIcon).not.toHaveBeenCalled();
    expect(window.flashFrame).not.toHaveBeenCalled();

    expect(update({ sender: { id: 1 } }, status)).toBe(true);
    expect(attention({ sender: { id: 1 } }, scope)).toBe(true);
  });

  it("uses a packaged build resource PNG with a taskbar-sized canvas", () => {
    const png = readFileSync(
      join(__dirname, "../buildResources/chat-unread-overlay.png"),
    );
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(png.readUInt32BE(16)).toBe(16);
    expect(png.readUInt32BE(20)).toBe(16);
  });

  it("resolves the overlay from both packaged resources and the dev build", () => {
    const packagedPath = join(
      "C:\\Program Files\\WorshipSync\\resources",
      "buildResources",
      "chat-unread-overlay.png",
    );
    expect(
      findChatTaskbarOverlayIconPath({
        resourcesPath: "C:\\Program Files\\WorshipSync\\resources",
        appPath: "C:\\Program Files\\WorshipSync\\resources\\app.asar",
        mainDirectory: "C:\\Program Files\\WorshipSync\\resources\\app.asar\\dist-electron\\main",
        exists: (path) => path === packagedPath,
      }),
    ).toBe(packagedPath);

    const mainDirectory = join(__dirname, "../dist-electron/main");
    const developmentPath = join(
      __dirname,
      "../buildResources/chat-unread-overlay.png",
    );
    expect(
      findChatTaskbarOverlayIconPath({
        resourcesPath: "C:/missing-electron-resources",
        appPath: "C:/missing-app",
        mainDirectory,
        exists: (path) => path === developmentPath,
      }),
    ).toBe(developmentPath);
  });

  it("keeps buildResources in electron-builder extra resources", () => {
    const config = readFileSync(
      join(__dirname, "../electron-builder.config.js"),
      "utf8",
    );
    expect(config).toContain('"buildResources/**/*"');
  });
});
