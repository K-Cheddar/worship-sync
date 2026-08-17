import type { BrowserWindow, WebContents } from "electron";

type ControllerWindowLike = Pick<BrowserWindow, "isDestroyed"> & {
  webContents: Pick<WebContents, "id" | "isDestroyed">;
};

/** Privileged file mutations belong to the controller renderer only. */
export const isTrustedControllerIpcSender = (
  sender: Pick<WebContents, "id">,
  controllerWindow: ControllerWindowLike | null,
) =>
  Boolean(
    controllerWindow &&
    !controllerWindow.isDestroyed() &&
    !controllerWindow.webContents.isDestroyed() &&
    sender.id === controllerWindow.webContents.id,
  );
