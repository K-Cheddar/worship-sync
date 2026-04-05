import type { OverlayInfo, Presentation } from "../types";
import { getDefaultFormatting } from "./overlayUtils";

/** Overlay id embedded in a stream overlay quick link presentation. */
export const getOverlayIdFromPresentation = (
  p: Presentation | undefined
): string | null => {
  if (!p || p.type !== "overlay") return null;
  return (
    p.participantOverlayInfo?.id ||
    p.stbOverlayInfo?.id ||
    p.qrCodeOverlayInfo?.id ||
    p.imageOverlayInfo?.id ||
    null
  );
};

/**
 * Build the same Presentation snapshot Quick Link selection uses when linking an overlay.
 * Single source of truth for overlay → presentation mapping.
 */
export const presentationFromOverlayInfo = (overlay: OverlayInfo): Presentation => {
  const displayName =
    overlay.name ||
    (overlay as { description?: string }).description ||
    "";

  let presentationInfo: Presentation = {
    name: displayName,
    slide: null,
    type: "overlay",
  };

  const info: OverlayInfo = {
    id: overlay.id,
    type: overlay.type,
    duration: overlay.duration,
    formatting: {
      ...getDefaultFormatting(overlay.type || "participant"),
      ...overlay.formatting,
    },
  };

  if (overlay.type === "participant") {
    presentationInfo = {
      ...presentationInfo,
      participantOverlayInfo: {
        ...info,
        name: overlay.name,
        event: overlay.event,
        title: overlay.title,
      },
    };
  }

  if (overlay.type === "stick-to-bottom") {
    presentationInfo = {
      ...presentationInfo,
      stbOverlayInfo: {
        ...info,
        heading: overlay.heading,
        subHeading: overlay.subHeading,
      },
    };
  }

  if (overlay.type === "qr-code") {
    presentationInfo = {
      ...presentationInfo,
      qrCodeOverlayInfo: {
        ...info,
        url: overlay.url,
        description: overlay.description,
      },
    };
  }

  if (overlay.type === "image") {
    presentationInfo = {
      ...presentationInfo,
      imageOverlayInfo: {
        ...info,
        imageUrl: overlay.imageUrl,
      },
    };
  }

  return presentationInfo;
};

/**
 * For overlay quick links, prefer live overlay data from `overlays.list` so edits stay in sync
 * without writing duplicate snapshots back into preferences on every overlay change.
 */
export const mergeStoredPresentationWithLiveOverlay = (
  stored: Presentation | undefined,
  overlaysList: OverlayInfo[]
): Presentation | undefined => {
  if (!stored) return undefined;
  const id = getOverlayIdFromPresentation(stored);
  if (!id) return stored;
  const live = overlaysList.find((o) => o.id === id);
  if (!live) return stored;
  return presentationFromOverlayInfo(live);
};
