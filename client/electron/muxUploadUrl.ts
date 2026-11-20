import { validateSafeHttpUrl, type SafeHttpLookupAll } from "./safeHttp";

export type MuxUploadUrlFailureCategory =
  | "malformed-url"
  | "https-required"
  | "credentials-not-allowed"
  | "port-not-allowed"
  | "host-not-allowed"
  | "dns-resolution-failed"
  | "unsafe-address";

export class MuxUploadUrlValidationError extends Error {
  constructor(
    readonly category: MuxUploadUrlFailureCategory,
    readonly hostname?: string,
  ) {
    super("The cloud upload address is invalid.");
    this.name = "MuxUploadUrlValidationError";
  }
}

const isMuxDirectUploadHostname = (hostname: string) =>
  hostname === "storage.googleapis.com" ||
  (hostname.length > ".mux.com".length && hostname.endsWith(".mux.com"));

export const validateMuxUploadUrl = async (
  rawUrl: unknown,
  lookupAll?: SafeHttpLookupAll,
) => {
  if (typeof rawUrl !== "string" || rawUrl.length > 8192) {
    throw new MuxUploadUrlValidationError("malformed-url");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new MuxUploadUrlValidationError("malformed-url");
  }

  const hostname = parsed.hostname.toLowerCase();
  const diagnosticHostname = hostname.replace(/[^a-z0-9.:[\]-]/g, "?").slice(0, 253);
  const rawAuthority = rawUrl.trim().match(/^https:\/\/([^/?#]*)/i)?.[1];
  if (parsed.protocol !== "https:") {
    throw new MuxUploadUrlValidationError("https-required", diagnosticHostname);
  }
  // URL normalizes empty userinfo such as `https://@host` away, so inspect the
  // original authority too instead of trusting URL.username/password alone.
  if (parsed.username || parsed.password || rawAuthority?.includes("@")) {
    throw new MuxUploadUrlValidationError("credentials-not-allowed", diagnosticHostname);
  }
  if (parsed.port && parsed.port !== "443") {
    throw new MuxUploadUrlValidationError("port-not-allowed", diagnosticHostname);
  }
  if (!isMuxDirectUploadHostname(hostname)) {
    throw new MuxUploadUrlValidationError("host-not-allowed", diagnosticHostname);
  }

  try {
    return await validateSafeHttpUrl(parsed.toString(), lookupAll);
  } catch (error) {
    const category = error instanceof Error && /private or local network/i.test(error.message)
      ? "unsafe-address"
      : "dns-resolution-failed";
    throw new MuxUploadUrlValidationError(category, diagnosticHostname);
  }
};
