/**
 * Whether an already-open display window has to be rebuilt.
 *
 * Window keys outlive a display's render profile: an operator can change Lobby
 * from projector to monitor while its window is open. The route is decided when
 * the window is created, and stream windows are transparent — also fixed at
 * construction — so a changed surface cannot be handled by focusing or even by
 * reloading the URL.
 *
 * A caller with no surface (a plain reopen, or a built-in whose route is
 * implied) is not a change and must keep the existing window.
 */
export const shouldRebuildWindowForSurface = (
  previousSurface: string | undefined,
  requestedSurface: string | undefined,
): boolean =>
  Boolean(requestedSurface) && previousSurface !== requestedSurface;
