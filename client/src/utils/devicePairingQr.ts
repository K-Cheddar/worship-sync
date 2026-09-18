const APPROVAL_PATH = /^\/device-pairing\/approve\/([^/?#]+)$/;
const REQUEST_ID = /^[A-Za-z0-9_-]+$/;
const TRUSTED_APP_ORIGINS = new Set([
  "https://worshipsync.net",
  "https://www.worshipsync.net",
  "https://local.worshipsync.net:3000",
  "http://localhost:3000",
  "https://localhost:3000",
  "http://127.0.0.1:3000",
  "https://127.0.0.1:3000",
]);

export type DevicePairingQrParseError =
  | "invalid_url"
  | "invalid_origin"
  | "invalid_path"
  | "invalid_request_id";

const inspectDevicePairingApprovalUrl = (
  value: string,
): { requestId: string } | { error: DevicePairingQrParseError } => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { error: "invalid_url" };
  }

  const allowedOrigins = new Set(TRUSTED_APP_ORIGINS);
  if (typeof window !== "undefined") allowedOrigins.add(window.location.origin);
  if (!allowedOrigins.has(parsed.origin)) return { error: "invalid_origin" };

  const match = parsed.hash.slice(1).match(APPROVAL_PATH);
  if (!match?.[1]) return { error: "invalid_path" };

  let requestId = "";
  try {
    requestId = decodeURIComponent(match[1]);
  } catch {
    return { error: "invalid_request_id" };
  }
  return REQUEST_ID.test(requestId) ? { requestId } : { error: "invalid_request_id" };
};

export const getDevicePairingApprovalUrlParseError = (
  value: string,
): DevicePairingQrParseError | null => {
  const result = inspectDevicePairingApprovalUrl(value);
  return "error" in result ? result.error : null;
};

export const parseDevicePairingApprovalUrl = (value: string): { requestId: string } | null => {
  const result = inspectDevicePairingApprovalUrl(value);
  return "requestId" in result ? result : null;
};
