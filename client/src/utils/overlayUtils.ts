import {
  defaultParticipantOverlayStyles,
  defaultStbOverlayStyles,
} from "../components/DisplayWindow/defaultOverlayStyles";
import { defaultQrCodeOverlayStyles } from "../components/DisplayWindow/defaultOverlayStyles";
import { defaultImageOverlayStyles } from "../components/DisplayWindow/defaultOverlayStyles";
import { DBOverlay, OverlayFormatting, OverlayInfo } from "../types";

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

/** Normalized overlay shape for Redux and remote sync (matches overlaySlice `selectOverlay`). */
export function normalizeOverlayForSync(
  overlay: DBOverlay | OverlayInfo,
): OverlayInfo {
  const type = overlay.type || "participant";
  return {
    id: overlay.id || "",
    name: overlay.name || "",
    type,
    duration: overlay.duration || 0,
    imageUrl: overlay.imageUrl || "",
    heading: overlay.heading || "",
    subHeading: overlay.subHeading || "",
    event: overlay.event || "",
    title: overlay.title || "",
    url: overlay.url || "",
    description: overlay.description || "",
    time: overlay.time,
    formatting: {
      ...getDefaultFormatting(type),
      ...overlay.formatting,
    },
    createdAt: overlay.createdAt,
    updatedAt: overlay.updatedAt,
    createdBy: overlay.createdBy,
    updatedBy: overlay.updatedBy,
  };
}
