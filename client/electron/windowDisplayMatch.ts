/**
 * Pure display-matching helpers for WindowStateManager.
 * Kept free of Electron APIs so unit tests can cover reboot ID remapping.
 */

export type DisplayBoundsLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayLike = {
  id: number;
  bounds: DisplayBoundsLike;
};

export const findDisplayById = <T extends DisplayLike>(
  displays: T[],
  displayId: number | undefined | null,
): T | undefined => {
  if (displayId === undefined || displayId === null) return undefined;
  return displays.find((d) => d.id === displayId);
};

export const findDisplayByBounds = <T extends DisplayLike>(
  displays: T[],
  bounds: DisplayBoundsLike | undefined,
): T | undefined => {
  if (!bounds) return undefined;
  const { x, y, width, height } = bounds;
  return displays.find((d) => {
    const b = d.bounds;
    return b.x === x && b.y === y && b.width === width && b.height === height;
  });
};

/**
 * Best guess of which screen a window belongs on when nothing is saved yet.
 *
 * The original surfaces keep their historical guesses. A window opened for a
 * display output has no history to go on, so it lands on the first secondary
 * screen rather than covering the operator's main screen.
 */
export const pickFallbackDisplay = <T extends DisplayLike>(
  displays: T[],
  windowType: string,
  primary: T,
): T => {
  if (displays.length > 1) {
    if (windowType === "projector") return displays[1];
    if (windowType === "monitor" || windowType === "board") {
      return displays.length > 2 ? displays[2] : displays[1];
    }
    return displays[1];
  }
  return primary;
};
