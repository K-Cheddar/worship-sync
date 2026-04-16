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
