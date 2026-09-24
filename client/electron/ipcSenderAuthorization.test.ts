import {
  isTrustedControllerIpcSender,
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
});
