import {
  getDefaultFormatting,
  loadOverlayForSelection,
  normalizeOverlayForSync,
} from "./overlayUtils";
import {
  defaultImageOverlayStyles,
  defaultParticipantOverlayStyles,
  defaultQrCodeOverlayStyles,
  defaultStbOverlayStyles,
} from "../components/DisplayWindow/defaultOverlayStyles";

describe("overlayUtils", () => {
  it("returns participant defaults for participant and unknown types", () => {
    expect(getDefaultFormatting("participant")).toBe(
      defaultParticipantOverlayStyles,
    );
    expect(getDefaultFormatting("unknown")).toBe(
      defaultParticipantOverlayStyles,
    );
  });

  it("returns stick-to-bottom defaults", () => {
    expect(getDefaultFormatting("stick-to-bottom")).toBe(
      defaultStbOverlayStyles,
    );
  });

  it("returns qr code defaults", () => {
    expect(getDefaultFormatting("qr-code")).toBe(defaultQrCodeOverlayStyles);
  });

  it("returns image defaults", () => {
    expect(getDefaultFormatting("image")).toBe(defaultImageOverlayStyles);
  });

  it("normalizeOverlayForSync merges type defaults with stored formatting", () => {
    const normalized = normalizeOverlayForSync({
      id: "ov-1",
      name: "Welcome",
      type: "participant",
      heading: "Hi",
      formatting: { bottom: 12 },
    } as Parameters<typeof normalizeOverlayForSync>[0]);
    expect(normalized.formatting.bottom).toBe(12);
    expect(normalized.formatting.backgroundColor).toBe(
      defaultParticipantOverlayStyles.backgroundColor,
    );
  });

  it("loadOverlayForSelection reads overlay-{id} and normalizes", async () => {
    const get = jest.fn().mockResolvedValue({
      _id: "overlay-abc",
      id: "abc",
      name: "QR",
      type: "qr-code",
      url: "https://example.com",
      formatting: { bottom: 9 },
    });
    const loaded = await loadOverlayForSelection({ get }, "abc");
    expect(get).toHaveBeenCalledWith("overlay-abc");
    expect(loaded?.id).toBe("abc");
    expect(loaded?.type).toBe("qr-code");
    expect(loaded?.formatting.bottom).toBe(9);
    expect(loaded?.formatting.backgroundColor).toBe(
      defaultQrCodeOverlayStyles.backgroundColor,
    );
  });

  it("loadOverlayForSelection returns undefined when the doc is missing", async () => {
    const get = jest.fn().mockResolvedValue(undefined);
    await expect(
      loadOverlayForSelection({ get }, "missing"),
    ).resolves.toBeUndefined();
  });

  it("loadOverlayForSelection propagates pouch get failures", async () => {
    const get = jest.fn().mockRejectedValue(new Error("missing"));
    await expect(loadOverlayForSelection({ get }, "boom")).rejects.toThrow(
      "missing",
    );
  });
});
