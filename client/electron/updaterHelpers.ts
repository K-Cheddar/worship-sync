/** Returns true only when newVersion is strictly greater than currentVersion (semver-style). */
export function isNewerVersion(
  newVersion: string,
  currentVersion: string,
): boolean {
  const v1Parts = newVersion.split(".").map(Number);
  const v2Parts = currentVersion.split(".").map(Number);
  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] ?? 0;
    const v2Part = v2Parts[i] ?? 0;
    if (v1Part > v2Part) return true;
    if (v1Part < v2Part) return false;
  }
  return false;
}

/** Suppress noisy code-signing / validation updater errors from the renderer toast path. */
export function shouldForwardUpdaterErrorToRenderer(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("code signature") && m.includes("validation")) return false;
  if (m.includes("not pass validation")) return false;
  if (m.includes("secerror") || m.includes("secerrordomain")) return false;
  if (m.includes("failed to verify") && m.includes("signature")) return false;
  return true;
}
