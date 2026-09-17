import { parseDevicePairingApprovalUrl } from "./devicePairingQr";

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

  it.each([
    "https://example.com/#/device-pairing/approve/devicePairing_abc-123",
    "http://localhost/#/device-pairing/approve/devicePairing_abc/123",
    "http://localhost/#/workstation/pair",
    "not a url",
  ])("rejects a non-device-pairing URL", (value) => {
    expect(parseDevicePairingApprovalUrl(value)).toBeNull();
  });
});
