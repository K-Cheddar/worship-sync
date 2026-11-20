const DEVELOPMENT_RENDERER_ORIGIN = "https://local.worshipsync.net:3000";

/**
 * Local video frames are decoded into canvases for thumbnail generation. Keep
 * CORS access limited to the app renderer that owns those local assets.
 */
export const buildLocalAssetCorsHeaders = (
  origin: string | null,
  isPackaged: boolean,
): Record<string, string> => {
  const isAllowedOrigin = isPackaged
    ? origin === "null"
    : origin === DEVELOPMENT_RENDERER_ORIGIN;
  if (!origin || !isAllowedOrigin) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers":
      "Accept-Ranges, Content-Range, Content-Length",
    Vary: "Origin",
  };
};
