/**
 * Open Graph HTML for public share link previews.
 *
 * Public pages boot a BrowserRouter shell on path URLs (`/services/...`).
 * Chat crawlers never execute the SPA, so this module matches those paths and
 * returns crawler-readable meta. Humans receive the normal SPA `index.html`.
 */

const DEFAULT_DESCRIPTION = "From planning to presentation - worship in sync.";
const DEFAULT_IMAGE_PATH = "/logo-wide-container.png";
const OG_IMAGE_WIDTH = "1200";
const OG_IMAGE_HEIGHT = "630";

const RESERVED_BOARD_SEGMENTS = new Set(["controller", "display"]);

/** User-Agent fragments used by link-preview crawlers (WhatsApp, Slack, etc.). */
const LINK_PREVIEW_CRAWLER_PATTERN =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|SkypeUriPreview|Googlebot|bingbot|Applebot|Embedly|Quora Link Preview|outbrain|Pinterest|redditbot|Showyoubot|DuckDuckBot|MetaInspector|iframely/i;

/** @typedef {"invite" | "service" | "schedule-response" | "team-schedule" | "team-intake" | "board" | "board-present"} PublicShareKind */

/** @type {Record<PublicShareKind, { title: string, description: string }>} */
const META_BY_KIND = {
  invite: {
    title: "You're invited | WorshipSync",
    description: "Accept your invitation to join WorshipSync.",
  },
  service: {
    title: "Service plan | WorshipSync",
    description: "Open this shared service plan.",
  },
  "schedule-response": {
    title: "Can you serve? | WorshipSync",
    description: "Confirm whether you can serve on this schedule.",
  },
  "team-schedule": {
    title: "Team schedule | WorshipSync",
    description: "View the shared team schedule.",
  },
  "team-intake": {
    title: "Team signup | WorshipSync",
    description: "Share your details and availability.",
  },
  board: {
    title: "Discussion board | WorshipSync",
    description: "Join the conversation on this board.",
  },
  "board-present": {
    title: "Board presentation | WorshipSync",
    description: "View the live board presentation.",
  },
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizePathname = (pathname) => {
  const raw = String(pathname || "").trim() || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
};

/**
 * @param {string} pathname
 * @param {string} [search] including leading `?` or empty
 * @returns {{
 *   kind: PublicShareKind,
 *   canonicalPath: string,
 *   hashTarget: string,
 *   param?: string,
 * } | null}
 */
export const matchPublicShareRoute = (pathname, search = "") => {
  const path = normalizePathname(pathname);
  const query = String(search || "");
  const querySuffix = query.startsWith("?") ? query : query ? `?${query}` : "";

  if (path === "/invite") {
    return {
      kind: "invite",
      canonicalPath: "/invite",
      hashTarget: `/#/invite${querySuffix}`,
    };
  }

  let match = path.match(/^\/services\/([^/]+)$/);
  if (match) {
    const param = match[1];
    return {
      kind: "service",
      canonicalPath: `/services/${param}`,
      hashTarget: `/#/services/${param}${querySuffix}`,
      param,
    };
  }

  match = path.match(/^\/schedule-response\/([^/]+)$/);
  if (match) {
    const param = match[1];
    return {
      kind: "schedule-response",
      canonicalPath: `/schedule-response/${param}`,
      hashTarget: `/#/schedule-response/${param}${querySuffix}`,
      param,
    };
  }

  match = path.match(/^\/teams\/schedule\/([^/]+)$/);
  if (match) {
    const param = match[1];
    return {
      kind: "team-schedule",
      canonicalPath: `/teams/schedule/${param}`,
      hashTarget: `/#/teams/schedule/${param}${querySuffix}`,
      param,
    };
  }

  if (path === "/teams/intake") {
    return {
      kind: "team-intake",
      canonicalPath: "/teams/intake",
      hashTarget: `/#/teams/intake${querySuffix}`,
    };
  }

  match = path.match(/^\/teams\/intake\/([^/]+)$/);
  if (match) {
    const param = match[1];
    return {
      kind: "team-intake",
      canonicalPath: `/teams/intake/${param}`,
      hashTarget: `/#/teams/intake/${param}${querySuffix}`,
      param,
    };
  }

  match = path.match(/^\/boards\/present\/([^/]+)$/);
  if (match) {
    const param = match[1];
    if (RESERVED_BOARD_SEGMENTS.has(param)) return null;
    return {
      kind: "board-present",
      canonicalPath: `/boards/present/${param}`,
      hashTarget: `/#/boards/present/${param}${querySuffix}`,
      param,
    };
  }

  match = path.match(/^\/boards\/([^/]+)$/);
  if (match) {
    const param = match[1];
    if (RESERVED_BOARD_SEGMENTS.has(param)) return null;
    return {
      kind: "board",
      canonicalPath: `/boards/${param}`,
      hashTarget: `/#/boards/${param}${querySuffix}`,
      param,
    };
  }

  return null;
};

/**
 * @param {PublicShareKind} kind
 * @param {{ title?: string, description?: string }} [overrides]
 */
export const resolvePublicShareMeta = (kind, overrides = {}) => {
  const defaults = META_BY_KIND[kind] || {
    title: "WorshipSync",
    description: DEFAULT_DESCRIPTION,
  };
  const title = String(overrides.title || "").trim() || defaults.title;
  const description =
    String(overrides.description || "").trim() || defaults.description;
  return { title, description };
};

/**
 * @param {{
 *   title: string,
 *   description: string,
 *   canonicalUrl: string,
 *   imageUrl: string,
 * }} options
 */
export const renderPublicShareHtml = ({
  title,
  description,
  canonicalUrl,
  imageUrl,
}) => {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeCanonical = escapeHtml(canonicalUrl);
  const safeImage = escapeHtml(imageUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
  <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${safeCanonical}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${safeImage}" />
  <link rel="canonical" href="${safeCanonical}" />
</head>
<body>
  <p><a href="${safeCanonical}">Open in WorshipSync</a></p>
</body>
</html>`;
};

export const isLinkPreviewCrawler = (userAgent) =>
  LINK_PREVIEW_CRAWLER_PATTERN.test(String(userAgent || ""));

export const getDefaultPublicShareImagePath = () => DEFAULT_IMAGE_PATH;

/**
 * Absolute HTTPS URL for the shared OG image.
 * @param {string} appBaseUrl no trailing slash
 */
export const buildPublicShareImageUrl = (appBaseUrl) => {
  const base =
    String(appBaseUrl || "").replace(/\/$/, "") ||
    "https://www.worshipsync.net";
  return `${base}${DEFAULT_IMAGE_PATH}`;
};
