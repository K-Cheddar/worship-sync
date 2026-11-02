import type { BrowserWindow, WebContents } from "electron";

type TrustedWindowLike = Pick<BrowserWindow, "isDestroyed"> & {
  webContents: Pick<WebContents, "id" | "isDestroyed">;
};

export const isTrustedWindowIpcSender = (
  sender: Pick<WebContents, "id">,
  window: TrustedWindowLike | null,
) =>
  Boolean(
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    sender.id === window.webContents.id,
  );

/** Privileged file mutations belong to the controller renderer only. */
export const isTrustedControllerIpcSender = (
  sender: Pick<WebContents, "id">,
  controllerWindow: TrustedWindowLike | null,
) => isTrustedWindowIpcSender(sender, controllerWindow);

/** Cache warming is allowed only from a live renderer owned by WorshipSync. */
export const isTrustedWorshipSyncIpcSender = (
  sender: Pick<WebContents, "id">,
  windows: ReadonlyArray<TrustedWindowLike | null>,
) => windows.some((window) => isTrustedWindowIpcSender(sender, window));

/**
 * Display outputs may restore a saved share from its source id/name, while
 * thumbnails remain limited to the controller and capture host picker.
 */
export const isTrustedDesktopCaptureIpcSender = (
  sender: Pick<WebContents, "id">,
  controllerWindow: TrustedWindowLike | null,
  captureHostWindow: TrustedWindowLike | null,
  displayWindows: ReadonlyArray<TrustedWindowLike | null>,
  withThumbnails = false,
) => {
  if (
    isTrustedWorshipSyncIpcSender(sender, [controllerWindow, captureHostWindow])
  ) {
    return true;
  }
  return (
    !withThumbnails && isTrustedWorshipSyncIpcSender(sender, displayWindows)
  );
};
