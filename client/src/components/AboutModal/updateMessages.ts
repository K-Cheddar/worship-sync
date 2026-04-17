/**
 * Operator-facing copy for auto-update flows (calm, actionable).
 * Raw updater messages are still logged in main; the UI prefers plain language.
 */
export function humanizeUpdateError(message: string): string {
  const m = message.trim();
  if (!m) {
    return "Could not reach the update server. Check your connection and try again.";
  }
  const lower = m.toLowerCase();
  if (lower.includes("not signed by the application owner")) {
    return "The downloaded update did not match the expected publisher. Try Check for updates again, or install manually from GitHub.";
  }
  if (
    lower.includes("code signature") ||
    lower.includes("not pass validation") ||
    lower.includes("secerrordomain")
  ) {
    return "This Mac build cannot install updates automatically yet. Use Download latest version to get the current release from GitHub.";
  }
  if (
    lower.includes("no update filepath") ||
    lower.includes("can't quit and install")
  ) {
    return "The installer is not ready yet. Try Check for updates, wait for the download to finish, then use Restart to install.";
  }
  if (
    lower.includes("net::") ||
    lower.includes("network") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("socket")
  ) {
    return "Could not reach the update server. Check your connection and try again.";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "Update information was not found. Try again later.";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "Could not access updates. Try again later or contact support.";
  }
  if (m.length > 160) {
    return `${m.slice(0, 157)}…`;
  }
  return m;
}
