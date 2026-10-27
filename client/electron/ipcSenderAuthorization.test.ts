import {
  isTrustedControllerIpcSender,
  isTrustedDesktopCaptureIpcSender,
  isTrustedWorshipSyncIpcSender,
} from "./ipcSenderAuthorization";

const windowLike = ({
  id = 1,
  windowDestroyed = false,
  contentsDestroyed = false,
} = {}) => ({
  isDestroyed: () => windowDestroyed,
  webContents: {
    id,
    isDestroyed: () => contentsDestroyed,
  },
});

describe("isTrustedControllerIpcSender", () => {
  it("allows only the live controller webContents", () => {
    expect(isTrustedControllerIpcSender({ id: 1 }, windowLike())).toBe(true);
    expect(isTrustedControllerIpcSender({ id: 2 }, windowLike())).toBe(false);
    expect(
      isTrustedControllerIpcSender(
        { id: 1 },
        windowLike({ windowDestroyed: true }),
      ),
    ).toBe(false);
    expect(
      isTrustedControllerIpcSender(
        { id: 1 },
        windowLike({ contentsDestroyed: true }),
      ),
    ).toBe(false);
    expect(isTrustedControllerIpcSender({ id: 1 }, null)).toBe(false);
  });

  it("allows only a live webContents from the known WorshipSync windows", () => {
    expect(
      isTrustedWorshipSyncIpcSender(
        { id: 2 },
        [windowLike({ id: 1 }), windowLike({ id: 2 })],
      ),
    ).toBe(true);
    expect(
      isTrustedWorshipSyncIpcSender(
        { id: 3 },
        [windowLike({ id: 1 }), windowLike({ id: 2 })],
      ),
    ).toBe(false);
    expect(
      isTrustedWorshipSyncIpcSender(
        { id: 2 },
        [windowLike({ id: 2, windowDestroyed: true })],
      ),
    ).toBe(false);
  });

  it("allows trusted display outputs to restore source ids and names", () => {
    const controller = windowLike({ id: 1 });
    const captureHost = windowLike({ id: 2 });
    const projector = windowLike({ id: 3 });
    const monitor = windowLike({ id: 4 });
    const stream = windowLike({ id: 5 });
    const displayWindows = [projector, monitor, stream];

    displayWindows.forEach((outputWindow) => {
      expect(
        isTrustedDesktopCaptureIpcSender(
          { id: outputWindow.webContents.id },
          controller,
          captureHost,
          displayWindows,
        ),
      ).toBe(true);
    });
  });

  it("denies unknown senders and keeps thumbnails limited to controller and capture host", () => {
    const controller = windowLike({ id: 1 });
    const captureHost = windowLike({ id: 2 });
    const projector = windowLike({ id: 3 });
    const displayWindows = [projector];

    expect(
      isTrustedDesktopCaptureIpcSender(
        { id: 4 },
        controller,
        captureHost,
        displayWindows,
      ),
    ).toBe(false);
    expect(
      isTrustedDesktopCaptureIpcSender(
        { id: 3 },
        controller,
        captureHost,
        displayWindows,
        true,
      ),
    ).toBe(false);
    expect(
      isTrustedDesktopCaptureIpcSender(
        { id: 1 },
        controller,
        captureHost,
        displayWindows,
        true,
      ),
    ).toBe(true);
    expect(
      isTrustedDesktopCaptureIpcSender(
        { id: 2 },
        controller,
        captureHost,
        displayWindows,
        true,
      ),
    ).toBe(true);
  });
});
