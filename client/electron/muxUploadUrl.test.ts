import { validateMuxUploadUrl, MuxUploadUrlValidationError } from "./muxUploadUrl";
import type { SafeHttpLookupAll } from "./safeHttp";

const publicLookup: SafeHttpLookupAll = async () => [
  { address: "8.8.8.8", family: 4 },
];

describe("Mux Direct Upload URL validation", () => {
  it.each([
    "https://storage.googleapis.com/video-storage/upload?Signature=signed-value",
    "https://upload.mux.com/upload-id?token=signed-value",
    "https://uploads.mux.com/upload-id?token=signed-value",
    "https://us-east-1.uploads.mux.com/upload-id?token=signed-value",
  ])("accepts documented legacy and current destinations (%s)", async (url) => {
    await expect(validateMuxUploadUrl(url, publicLookup)).resolves.toMatchObject({
      url,
      address: { address: "8.8.8.8", family: 4 },
    });
  });

  it.each([
    "https://uploads.mux.com.attacker.example/upload",
    "https://storage.googleapis.com.attacker.example/upload",
    "https://mux.com/upload",
    "https://upload-mux.com/upload",
  ])("rejects deceptive or unapproved hostname %s", async (url) => {
    await expect(validateMuxUploadUrl(url, publicLookup)).rejects.toMatchObject({
      name: "MuxUploadUrlValidationError",
      category: "host-not-allowed",
    });
  });

  it.each([
    ["http://upload.mux.com/upload", "https-required"],
    ["https://user:secret@upload.mux.com/upload", "credentials-not-allowed"],
    ["https://@upload.mux.com/upload", "credentials-not-allowed"],
    ["https://upload.mux.com:8443/upload", "port-not-allowed"],
    ["not a URL", "malformed-url"],
  ] as const)("rejects an unsafe URL form (%s)", async (url, category) => {
    await expect(validateMuxUploadUrl(url, publicLookup)).rejects.toMatchObject({ category });
  });

  it.each([
    ["127.0.0.1", 4],
    ["10.0.0.8", 4],
    ["::1", 6],
    ["::ffff:192.168.1.5", 6],
  ] as const)("rejects allowed hostname resolving to private address %s", async (address, family) => {
    const lookupAll: SafeHttpLookupAll = async () => [{ address, family }];
    await expect(validateMuxUploadUrl("https://upload.mux.com/upload", lookupAll))
      .rejects.toMatchObject({ category: "unsafe-address", hostname: "upload.mux.com" });
  });

  it("reports DNS failures without retaining the signed URL", async () => {
    const lookupAll: SafeHttpLookupAll = async () => {
      throw Object.assign(new Error("DNS failed for signed URL"), { code: "ENOTFOUND" });
    };
    const url = "https://upload.mux.com/upload?Signature=do-not-log";

    try {
      await validateMuxUploadUrl(url, lookupAll);
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(MuxUploadUrlValidationError);
      expect(error).toMatchObject({ category: "dns-resolution-failed", hostname: "upload.mux.com" });
      expect((error as Error).message).not.toContain("do-not-log");
    }
  });
});
