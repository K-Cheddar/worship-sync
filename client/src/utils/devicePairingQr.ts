const APPROVAL_PATH = /^\/device-pairing\/approve\/([^/?#]+)$/;
const REQUEST_ID = /^[A-Za-z0-9_-]+$/;

export const parseDevicePairingApprovalUrl = (value: string): { requestId: string } | null => {
  try {
    const parsed = new URL(value.trim());
    const allowedOrigins = new Set(["https://www.worshipsync.net"]);
    if (typeof window !== "undefined") allowedOrigins.add(window.location.origin);
    if (!allowedOrigins.has(parsed.origin)) return null;
    const match = parsed.hash.slice(1).match(APPROVAL_PATH);
    const requestId = match?.[1] ? decodeURIComponent(match[1]) : "";
    return REQUEST_ID.test(requestId) ? { requestId } : null;
  } catch {
    return null;
  }
};
