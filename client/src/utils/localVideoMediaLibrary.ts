import type {
  LocalVideoInputMediaSource,
  MediaType,
  Presentation,
} from "../types";
import { getOrCreateDeviceId } from "./authStorage";
import { getTrustedDeviceLabel } from "./deviceInfo";
import generateRandomId from "./generateRandomId";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "./localVideoCapturePool";
import {
  buildLocalVideoInputPresentation,
  getLocalVideoSourceErrorMessage,
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "./localVideoInput";
import { createNewSlide } from "./slideCreation";
import { DEFAULT_FONT_PX } from "../constants";

/** Match ItemSlides handoff so capture stays warm while displays attach. */
export const LOCAL_VIDEO_TRANSMIT_HANDOFF_MS = 5_000;

export const isLocalVideoInputMedia = (
  media: Pick<MediaType, "localVideoInput"> | null | undefined,
): media is Pick<MediaType, "localVideoInput"> & {
  localVideoInput: LocalVideoInputMediaSource;
} => Boolean(media?.localVideoInput?.kind === "local-video-input");

/** Media that can be sent live or used as a custom-item source. */
export const mediaHasSendableContent = (
  media: Pick<MediaType, "background" | "localVideoInput"> | null | undefined,
) => Boolean(media && (isLocalVideoInputMedia(media) || media.background));

export const mediaSourceFromLocalVideoMedia = (
  media: MediaType,
): LocalVideoInputMediaSource | undefined =>
  isLocalVideoInputMedia(media) ? media.localVideoInput : undefined;

export type LocalVideoSendBuildResult =
  | {
      ok: true;
      presentation: Presentation & { outputIds: string[] };
      sourceId: string;
    }
  | { ok: false; message: string };

/** Build the live presentation payload used by Media send and item slides. */
export const buildLocalVideoInputSendPresentation = (args: {
  source: LocalVideoInputMediaSource;
  name: string;
  outputIds: string[];
  brightness?: number;
}): LocalVideoSendBuildResult => {
  const localVideoInput = buildLocalVideoInputPresentation(
    args.source,
    getOrCreateDeviceId(),
    getTrustedDeviceLabel(),
  );
  if (!localVideoInput) {
    return {
      ok: false,
      message: isDesktopCaptureKind(args.source.captureKind)
        ? `Share ${args.source.label} again on this computer, then try again.`
        : `Relink ${args.source.label} on this computer, then try again.`,
    };
  }

  const slide = createNewSlide({
    type: "Section",
    name: "Section 1",
    fontSize: DEFAULT_FONT_PX,
    words: ["", ""],
    background: "",
    mediaSource: args.source,
    brightness: args.brightness,
  });

  return {
    ok: true,
    sourceId: args.source.sourceId,
    presentation: {
      slide,
      type: "local-video-input",
      name: args.name,
      outputIds: args.outputIds,
      localVideoInput,
    } as Presentation & { outputIds: string[] },
  };
};

/**
 * Warm capture, then run `send`. Mirrors ItemSlides so the display layer can
 * attach before the temporary transmit consumer releases.
 */
export const sendLocalVideoInputWithWarmCapture = async (args: {
  sourceId: string;
  captureKind: LocalVideoInputMediaSource["captureKind"];
  send: () => void;
  onError: (message: string) => void;
}): Promise<void> => {
  const binding = resolveLocalVideoInputBinding(args.sourceId);
  if (!binding) {
    args.onError(
      isDesktopCaptureKind(args.captureKind)
        ? "Share this screen or window again on this computer, then try again."
        : "Relink this input on this computer, then try again.",
    );
    return;
  }

  const transmitConsumerId = `media-transmit:${args.sourceId}:${generateRandomId()}`;
  const releaseTransmitCapture = () => {
    window.setTimeout(() => {
      void releaseWarmLocalVideoCapture(args.sourceId, transmitConsumerId);
    }, LOCAL_VIDEO_TRANSMIT_HANDOFF_MS);
  };

  try {
    await acquireWarmLocalVideoCapture(
      args.sourceId,
      binding,
      true,
      transmitConsumerId,
    );
    try {
      args.send();
    } finally {
      releaseTransmitCapture();
    }
  } catch (error: unknown) {
    await releaseWarmLocalVideoCapture(args.sourceId, transmitConsumerId);
    if (error instanceof LocalVideoCaptureOwnedError) {
      args.send();
      return;
    }
    args.onError(getLocalVideoSourceErrorMessage(error, args.captureKind));
  }
};
