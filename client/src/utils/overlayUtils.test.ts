import { getDefaultFormatting } from "./overlayUtils";
import {
  defaultImageOverlayStyles,
  defaultParticipantOverlayStyles,
  defaultQrCodeOverlayStyles,
  defaultStbOverlayStyles,
} from "../components/DisplayWindow/defaultOverlayStyles";

describe("overlayUtils", () => {
  it("returns participant defaults for participant and unknown types", () => {
    expect(getDefaultFormatting("participant")).toBe(defaultParticipantOverlayStyles);
    expect(getDefaultFormatting("unknown")).toBe(defaultParticipantOverlayStyles);
  });

  it("returns stick-to-bottom defaults", () => {
    expect(getDefaultFormatting("stick-to-bottom")).toBe(defaultStbOverlayStyles);
  });

  it("returns qr code defaults", () => {
    expect(getDefaultFormatting("qr-code")).toBe(defaultQrCodeOverlayStyles);
  });

  it("returns image defaults", () => {
    expect(getDefaultFormatting("image")).toBe(defaultImageOverlayStyles);
  });
});
