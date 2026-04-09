const BRANDING_MAX_TEXT_LENGTH = 1000;
const BRANDING_MAX_COLORS = 6;
const BRANDING_MAX_LABEL_LENGTH = 40;
const BRAND_HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const BRAND_LOGO_FORMATS = new Set(["png", "jpg", "jpeg", "webp", "svg"]);

const createBrandingError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeTextField = (value, fieldName) => {
  const normalized = String(value || "").trim();
  if (normalized.length > BRANDING_MAX_TEXT_LENGTH) {
    throw createBrandingError(
      `${fieldName} must be ${BRANDING_MAX_TEXT_LENGTH} characters or less.`,
    );
  }
  return normalized;
};

const normalizePositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
};

const isAllowedCloudinaryHost = (hostname) => {
  const normalized = String(hostname || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "cloudinary.com" || normalized.endsWith(".cloudinary.com")
  );
};

const normalizeLogoAsset = (asset, slotName) => {
  if (asset == null) {
    return null;
  }
  if (!isRecord(asset)) {
    throw createBrandingError(`${slotName} logo is invalid.`);
  }

  const url = String(asset.url || "").trim();
  const publicId = String(asset.publicId || "").trim();
  const format = String(asset.format || "")
    .trim()
    .toLowerCase();

  if (!url || !publicId) {
    throw createBrandingError(`${slotName} logo is missing asset details.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw createBrandingError(`${slotName} logo URL is invalid.`);
  }

  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw createBrandingError(`${slotName} logo URL must use http or https.`);
  }

  if (!isAllowedCloudinaryHost(parsedUrl.hostname)) {
    throw createBrandingError(`${slotName} logo must use a Cloudinary URL.`);
  }

  if (format && !BRAND_LOGO_FORMATS.has(format)) {
    throw createBrandingError(`${slotName} logo format is not supported.`);
  }

  const width = normalizePositiveInteger(asset.width);
  const height = normalizePositiveInteger(asset.height);

  return {
    url,
    publicId,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(format ? { format } : {}),
  };
};

const normalizeColor = (color, index, seenLabels) => {
  if (!isRecord(color)) {
    throw createBrandingError(`Brand color ${index + 1} is invalid.`);
  }

  const value = String(color.value || "").trim();
  if (!BRAND_HEX_COLOR_RE.test(value)) {
    throw createBrandingError(
      `Brand color ${index + 1} must use #RRGGBB or #RRGGBBAA.`,
    );
  }

  const rawLabel = String(color.label || "").trim();
  if (rawLabel.length > BRANDING_MAX_LABEL_LENGTH) {
    throw createBrandingError(
      `Brand color labels must be ${BRANDING_MAX_LABEL_LENGTH} characters or less.`,
    );
  }

  if (rawLabel) {
    const labelKey = rawLabel.toLowerCase();
    if (seenLabels.has(labelKey)) {
      throw createBrandingError(
        "Brand color labels must be unique after trimming.",
      );
    }
    seenLabels.add(labelKey);
    return { label: rawLabel, value };
  }

  return { value };
};

export const createEmptyChurchBranding = () => ({
  mission: "",
  vision: "",
  logos: {
    square: null,
    wide: null,
  },
  colors: [],
});

export const getChurchBrandingPath = (churchId) =>
  `churches/${churchId}/data/branding`;

export const normalizeChurchBrandingForStorage = (input) => {
  const source =
    isRecord(input) && isRecord(input.branding) ? input.branding : input;

  if (source != null && !isRecord(source)) {
    throw createBrandingError("Branding payload is invalid.");
  }

  const safeSource = isRecord(source) ? source : {};
  const logos = isRecord(safeSource.logos) ? safeSource.logos : {};
  const rawColors = Array.isArray(safeSource.colors) ? safeSource.colors : [];

  if (rawColors.length > BRANDING_MAX_COLORS) {
    throw createBrandingError(
      `You can save up to ${BRANDING_MAX_COLORS} brand colors.`,
    );
  }

  const seenLabels = new Set();

  return {
    mission: normalizeTextField(safeSource.mission, "Mission"),
    vision: normalizeTextField(safeSource.vision, "Vision"),
    logos: {
      square: normalizeLogoAsset(logos.square, "Square"),
      wide: normalizeLogoAsset(logos.wide, "Wide"),
    },
    colors: rawColors.map((color, index) =>
      normalizeColor(color, index, seenLabels),
    ),
  };
};

export const churchBrandingLimits = {
  BRANDING_MAX_TEXT_LENGTH,
  BRANDING_MAX_COLORS,
  BRANDING_MAX_LABEL_LENGTH,
};
