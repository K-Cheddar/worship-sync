import {
  defaultParticipantOverlayStyles,
  defaultStbOverlayStyles,
} from "../components/DisplayWindow/defaultOverlayStyles";
import { defaultQrCodeOverlayStyles } from "../components/DisplayWindow/defaultOverlayStyles";
import { defaultImageOverlayStyles } from "../components/DisplayWindow/defaultOverlayStyles";
import { OverlayFormatting } from "../types";

export const getDefaultFormatting = (type: string): OverlayFormatting => {
  switch (type) {
    case "participant":
      return defaultParticipantOverlayStyles;
    case "stick-to-bottom":
      return defaultStbOverlayStyles;
    case "qr-code":
      return defaultQrCodeOverlayStyles;
    case "image":
      return defaultImageOverlayStyles;
  }

  return defaultParticipantOverlayStyles;
};
