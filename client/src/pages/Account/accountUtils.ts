import { getPlatformDisplayLabel } from "../../utils/deviceInfo";
import type {
  DisplayDevice,
  HumanDevice,
  MemberAccessOption,
  WorkstationDevice,
} from "./accountTypes";

export const memberAccessOptions: {
  value: MemberAccessOption;
  label: string;
}[] = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "music", label: "Music" },
  { value: "full", label: "Full" },
];

/** Human-readable label for the normalized Controller capability. */
export const formatMemberAccessLabel = (value?: string): string => {
  const access = toMemberAccessOption(value);
  return access === "none"
    ? "No controller access"
    : `${access[0].toUpperCase()}${access.slice(1)} controller`;
};

export const formatLastSeenLabel = (value?: string | null) => {
  if (!value) return "Last seen unknown";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Last seen unknown";
  return `Last seen ${new Date(value).toLocaleString()}`;
};

export const formatTrustedDeviceTitle = (device: HumanDevice) => {
  const label = String(device.label || "").trim();
  const platformLabel = getPlatformDisplayLabel(device.platformType);
  if (!label) {
    return `${platformLabel} device`;
  }
  if (
    /^win/i.test(label) ||
    /^mac/i.test(label) ||
    /^linux/i.test(label) ||
    /^iphone|^ipad|^android/i.test(label) ||
    label === platformLabel
  ) {
    return `${platformLabel} device`;
  }
  if (label === "Trusted device") {
    return `${platformLabel} device`;
  }
  return label;
};

export const formatSurfaceTypeLabel = (surfaceType?: string | null) => {
  const normalized = String(surfaceType || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Display";
  if (normalized === "stream-info") return "Stream info";
  if (normalized === "projector-display") return "Projector (display output)";
  if (normalized === "projector") return "Projector (full frame)";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const getTrustedDeviceOwnerLabel = (device: HumanDevice) =>
  device.user?.displayName?.trim() ||
  device.user?.email?.trim() ||
  "Unknown user";

export const getWorkstationRevokeMessage = (ws: WorkstationDevice) => {
  const label = ws.label.trim() || "Unnamed workstation";
  const lastOp = ws.lastOperatorName?.trim();
  if (lastOp) {
    return `Revoked shared workstation “${label}” (last used by ${lastOp}).`;
  }
  return `Revoked shared workstation “${label}”.`;
};

export const getDisplayRevokeMessage = (display: DisplayDevice) => {
  const label = display.label.trim() || "Unnamed display";
  const surface = formatSurfaceTypeLabel(display.surfaceType);
  return `Revoked ${surface} screen “${label}”.`;
};

export const getTrustedDeviceRevokeMessage = (device: HumanDevice) => {
  const owner = getTrustedDeviceOwnerLabel(device);
  const title = formatTrustedDeviceTitle(device);
  return `Revoked trusted sign-in for ${owner} on ${title}.`;
};

export const formatChurchStatusLabel = (status: string): string => {
  if (status === "active") return "Active";
  if (status === "needs-admin") return "Needs an admin";
  return status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const formatAccountError = (
  error: unknown,
  fallback: string,
): string => {
  const raw =
    error instanceof Error ? error.message.trim() : String(error).trim();
  if (!raw) return fallback;
  if (raw === "Request failed") {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (
    raw.length < 160 &&
    !raw.includes("at ") &&
    !raw.toLowerCase().includes("stack")
  ) {
    return raw;
  }
  return fallback;
};

export const toMemberAccessOption = (value?: string): MemberAccessOption => {
  if (value === "member") return "none";
  if (value === "full" || value === "music" || value === "view" || value === "none") {
    return value;
  }
  return "none";
};
