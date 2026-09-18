import {
  getDevicePairingApprovalUrlParseError,
  parseDevicePairingApprovalUrl,
} from "./devicePairingQr";

describe("parseDevicePairingApprovalUrl", () => {
  it("accepts a local approval QR URL", () => {
    expect(
      parseDevicePairingApprovalUrl(
        "http://localhost/#/device-pairing/approve/devicePairing_abc-123",
      ),
    ).toEqual({ requestId: "devicePairing_abc-123" });
  });

  it("accepts the production approval QR URL", () => {
    expect(
      parseDevicePairingApprovalUrl(
        "https://www.worshipsync.net/#/device-pairing/approve/devicePairing_abc-123",
      ),
    ).toEqual({ requestId: "devicePairing_abc-123" });
  });

  it("accepts the production apex-domain alias", () => {
    expect(
      parseDevicePairingApprovalUrl(
        "https://worshipsync.net/#/device-pairing/approve/devicePairing_abc-123",
      ),
    ).toEqual({ requestId: "devicePairing_abc-123" });
  });

  it.each([
    "https://example.com/#/device-pairing/approve/devicePairing_abc-123",
    "http://localhost/#/device-pairing/approve/devicePairing_abc/123",
    "http://localhost/#/workstation/pair",
    "https://worshipsync.net/#/device-pairing/approve/devicePairing_abc/123",
    "https://worshipsync.net/#/device-pairing/approve/devicePairing_abc%2F123",
    "not a url",
  ])("rejects a non-device-pairing URL", (value) => {
    expect(parseDevicePairingApprovalUrl(value)).toBeNull();
  });

  it("reports why a decoded QR URL was rejected without exposing its contents", () => {
    expect(getDevicePairingApprovalUrlParseError("https://example.com/#/device-pairing/approve/devicePairing_abc-123")).toBe("invalid_origin");
    expect(getDevicePairingApprovalUrlParseError("https://worshipsync.net/#/workstation/pair")).toBe("invalid_path");
    expect(getDevicePairingApprovalUrlParseError("https://worshipsync.net/#/device-pairing/approve/devicePairing_abc%20def")).toBe("invalid_request_id");
    expect(getDevicePairingApprovalUrlParseError("not a url")).toBe("invalid_url");
  });
});
