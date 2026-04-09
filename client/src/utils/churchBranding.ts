import type {
  ChurchBrandColor,
  ChurchBranding,
  ChurchLogoAsset,
} from "../api/authTypes";

export const BRANDING_MAX_TEXT_LENGTH = 1000;
export const BRANDING_MAX_COLORS = 6;
export const BRANDING_MAX_LABEL_LENGTH = 40;
export const BRAND_HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Fixed grid slot for the branding editor; `null` = unused cell (not saved). */
export type BrandColorSlot = ChurchBrandColor | null;

export const padBrandColorsToSlots = (
  colors: ChurchBrandColor[],
): BrandColorSlot[] => {
  const out: BrandColorSlot[] = colors
    .slice(0, BRANDING_MAX_COLORS)
    .map((c) => c);
  while (out.length < BRANDING_MAX_COLORS) {
    out.push(null);
  }
  return out.slice(0, BRANDING_MAX_COLORS);
};

export const compactBrandColorSlots = (
  slots: BrandColorSlot[],
): ChurchBrandColor[] =>
  slots.filter((slot): slot is ChurchBrandColor => slot !== null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizePositiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
};

const isAllowedCloudinaryHost = (hostname: string): boolean => {
  const normalized = String(hostname || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "cloudinary.com" || normalized.endsWith(".cloudinary.com")
  );
};

const deriveCloudinaryPublicIdFromUrl = (value: string): string | null => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(value || "").trim());
  } catch {
    return null;
  }

  if (
    !/^https?:$/.test(parsedUrl.protocol) ||
    !isAllowedCloudinaryHost(parsedUrl.hostname)
  ) {
    return null;
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  const uploadIndex = segments.indexOf("upload");
  if (uploadIndex === -1) {
    return null;
  }

  const tail = segments.slice(uploadIndex + 1);
  if (tail.length === 0) {
    return null;
  }

  const versionIndex = tail.findIndex((segment) => /^v\d+$/.test(segment));
  const publicIdSegments =
    versionIndex >= 0 ? tail.slice(versionIndex + 1) : tail;

  if (publicIdSegments.length === 0) {
    return null;
  }

  const lastSegment = publicIdSegments[publicIdSegments.length - 1];
  const normalizedLastSegment = lastSegment.replace(/\.[^/.]+$/, "");
  if (!normalizedLastSegment) {
    return null;
  }

  const normalizedSegments = [
    ...publicIdSegments.slice(0, -1),
    normalizedLastSegment,
  ].filter(Boolean);

  return normalizedSegments.length > 0 ? normalizedSegments.join("/") : null;
};

const normalizeLogoAsset = (value: unknown): ChurchLogoAsset | null => {
  if (!isRecord(value)) {
    return null;
  }

  const url = String(value.url || "").trim();
  const format = String(value.format || "")
    .trim()
    .toLowerCase();

  if (!url) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (
    !/^https?:$/.test(parsedUrl.protocol) ||
    !isAllowedCloudinaryHost(parsedUrl.hostname)
  ) {
    return null;
  }

  const derivedPublicId = deriveCloudinaryPublicIdFromUrl(url);
  if (!derivedPublicId) {
    return null;
  }

  const width = normalizePositiveInteger(value.width);
  const height = normalizePositiveInteger(value.height);

  return {
    url,
    publicId: derivedPublicId,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(format ? { format } : {}),
  };
};

const normalizeColor = (
  value: unknown,
  seenLabels: Set<string>,
): ChurchBrandColor | null => {
  if (!isRecord(value)) {
    return null;
  }

  const colorValue = String(value.value || "").trim();
  if (!BRAND_HEX_COLOR_RE.test(colorValue)) {
    return null;
  }

  const rawLabel = String(value.label || "").trim();
  if (!rawLabel) {
    return { value: colorValue };
  }

  if (rawLabel.length > BRANDING_MAX_LABEL_LENGTH) {
    return null;
  }

  const labelKey = rawLabel.toLowerCase();
  if (seenLabels.has(labelKey)) {
    return null;
  }
  seenLabels.add(labelKey);

  return {
    label: rawLabel,
    value: colorValue,
  };
};

export const emptyChurchBranding = (): ChurchBranding => ({
  mission: "",
  vision: "",
  logos: {
    square: null,
    wide: null,
  },
  colors: [],
});

export const normalizeChurchBranding = (value: unknown): ChurchBranding => {
  const source =
    isRecord(value) && isRecord(value.branding) ? value.branding : value;
  const safeSource = isRecord(source) ? source : {};
  const logos = isRecord(safeSource.logos) ? safeSource.logos : {};
  const rawColors = Array.isArray(safeSource.colors) ? safeSource.colors : [];
  const seenLabels = new Set<string>();

  return {
    mission: String(safeSource.mission || "")
      .trim()
      .slice(0, BRANDING_MAX_TEXT_LENGTH),
    vision: String(safeSource.vision || "")
      .trim()
      .slice(0, BRANDING_MAX_TEXT_LENGTH),
    logos: {
      square: normalizeLogoAsset(logos.square),
      wide: normalizeLogoAsset(logos.wide),
    },
    colors: rawColors
      .slice(0, BRANDING_MAX_COLORS)
      .map((color) => normalizeColor(color, seenLabels))
      .filter((color): color is ChurchBrandColor => Boolean(color)),
  };
};

export const getChurchBrandColorLabel = (
  color: ChurchBrandColor,
  index: number,
) => {
  const label = String(color.label || "").trim();
  return label || `Color ${index + 1}`;
};

export const serializeChurchBranding = (branding: ChurchBranding) =>
  JSON.stringify(branding);
