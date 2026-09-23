const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const EXTERNAL_RESOURCE_PROVIDER_LABELS = Object.freeze({
  worshipsync: "WorshipSync",
  youtube: "YouTube",
  dropbox: "Dropbox",
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  box: "Box",
  direct: "Direct media",
  web: "Web",
  unknown: "Resource",
});

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);
const DROPBOX_HOSTS = new Set([
  "dropbox.com",
  "www.dropbox.com",
  "dl.dropboxusercontent.com",
]);
const GOOGLE_DRIVE_HOSTS = new Set([
  "drive.google.com",
  "drive.usercontent.google.com",
  "docs.google.com",
]);
const ONEDRIVE_HOSTS = new Set(["1drv.ms", "onedrive.live.com", "onedrive.com"]);
const BOX_HOSTS = new Set([
  "box.com",
  "www.box.com",
  "app.box.com",
  "public.boxcloud.com",
]);

const isSharePointHost = (hostname) =>
  hostname === "sharepoint.com" || hostname.endsWith(".sharepoint.com");

const copyWithQuery = (url, update) => {
  const candidate = new URL(url.toString());
  update(candidate.searchParams);
  return candidate.toString();
};

const parseYouTubeId = (url) => {
  const pathParts = url.pathname.split("/").filter(Boolean);
  const candidate = url.hostname.toLowerCase() === "youtu.be" ||
    url.hostname.toLowerCase() === "www.youtu.be"
    ? pathParts[0]
    : url.pathname === "/watch"
      ? url.searchParams.get("v")
      : ["embed", "shorts", "live"].includes(pathParts[0])
        ? pathParts[1]
        : null;
  return YOUTUBE_VIDEO_ID_PATTERN.test(candidate || "") ? candidate : "";
};

const googleDriveFileId = (url) =>
  url.pathname.match(/\/file\/d\/([^/]+)/i)?.[1] ||
  url.searchParams.get("id") ||
  "";

const googleDocumentCandidate = (url) => {
  const documentMatch = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/i);
  if (!documentMatch) return null;
  const [, kind, id] = documentMatch;
  if (kind.toLowerCase() === "presentation") {
    return `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/export/pdf`;
  }
  return `https://docs.google.com/${kind.toLowerCase()}/d/${encodeURIComponent(id)}/export?format=pdf`;
};

const providerResolvers = [
  {
    provider: "youtube",
    matches: (url) => YOUTUBE_HOSTS.has(url.hostname.toLowerCase()),
    resolve: (url) => {
      const mediaId = parseYouTubeId(url);
      return mediaId
        ? {
            candidateUrl: `https://www.youtube.com/watch?v=${mediaId}`,
            mediaId,
          }
        : null;
    },
  },
  {
    provider: "dropbox",
    matches: (url) => DROPBOX_HOSTS.has(url.hostname.toLowerCase()),
    resolve: (url) => ({
      candidateUrl: copyWithQuery(url, (params) => {
        params.delete("dl");
        params.set("raw", "1");
      }),
    }),
  },
  {
    provider: "google-drive",
    matches: (url) => GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase()),
    resolve: (url) => {
      const documentCandidate = googleDocumentCandidate(url);
      if (documentCandidate) return { candidateUrl: documentCandidate };
      if (url.hostname.toLowerCase() === "drive.google.com") {
        const fileId = googleDriveFileId(url);
        if (fileId) {
          return {
            candidateUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
            mediaId: fileId,
          };
        }
      }
      return { candidateUrl: url.toString() };
    },
  },
  {
    provider: "onedrive",
    matches: (url) => ONEDRIVE_HOSTS.has(url.hostname.toLowerCase()),
    resolve: (url) => ({
      candidateUrl: copyWithQuery(url, (params) => params.set("download", "1")),
    }),
  },
  {
    provider: "sharepoint",
    matches: (url) => isSharePointHost(url.hostname.toLowerCase()),
    resolve: (url) => ({
      candidateUrl: copyWithQuery(url, (params) => params.set("download", "1")),
    }),
  },
  {
    provider: "box",
    matches: (url) =>
      BOX_HOSTS.has(url.hostname.toLowerCase()) ||
      url.hostname.toLowerCase().endsWith(".boxcloud.com"),
    resolve: (url) => ({
      candidateUrl: copyWithQuery(url, (params) => params.set("download", "1")),
    }),
  },
];

/**
 * Selects a provider strategy and produces the candidate URL to probe.
 * Provider resolvers only normalize public share URLs; they never carry
 * credentials or decide whether an upstream resource is previewable.
 */
export const resolveExternalResourceProvider = (value) => {
  const url = value instanceof URL ? value : new URL(value);
  for (const resolver of providerResolvers) {
    if (!resolver.matches(url)) continue;
    const result = resolver.resolve(url);
    if (result) return { provider: resolver.provider, ...result };
  }
  return { provider: "direct", candidateUrl: url.toString() };
};
