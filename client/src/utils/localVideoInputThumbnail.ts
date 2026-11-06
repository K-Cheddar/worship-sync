export const LOCAL_VIDEO_INPUT_THUMBNAIL_MAX_WIDTH = 640;
export const LOCAL_VIDEO_INPUT_THUMBNAIL_MAX_HEIGHT = 360;

export type LocalVideoThumbnailFrame = {
  blob: Blob;
  width: number;
  height: number;
};
const encodeCanvas = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | undefined>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ?? undefined), type, quality);
    } catch {
      resolve(undefined);
    }
  });

/** Encode one user-requested frame from the preview already on screen. */
export const captureLocalVideoInputThumbnail = async (
  source: HTMLVideoElement | HTMLImageElement,
): Promise<LocalVideoThumbnailFrame> => {
  const isVideo = source instanceof HTMLVideoElement;
  const width = isVideo ? source.videoWidth : source.naturalWidth;
  const height = isVideo ? source.videoHeight : source.naturalHeight;
  if (
    width <= 0 ||
    height <= 0 ||
    (isVideo && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
  ) {
    throw new Error("The video input has not produced a frame yet.");
  }

  const scale = Math.min(
    1,
    LOCAL_VIDEO_INPUT_THUMBNAIL_MAX_WIDTH / width,
    LOCAL_VIDEO_INPUT_THUMBNAIL_MAX_HEIGHT / height,
  );
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The thumbnail image could not be prepared.");
    context.drawImage(source, 0, 0, outputWidth, outputHeight);
    const webpBlob = await encodeCanvas(canvas, "image/webp", 0.86);
    const blob = webpBlob?.type === "image/webp"
      ? webpBlob
      : await encodeCanvas(canvas, "image/jpeg", 0.9);
    if (blob?.type !== "image/webp" && blob?.type !== "image/jpeg") {
      throw new Error("The video frame could not be encoded as WebP or JPEG.");
    }
    return { blob, width: outputWidth, height: outputHeight };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};
