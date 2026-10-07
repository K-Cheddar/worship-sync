import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import axios from "axios";
import {
  EXTERNAL_RESOURCE_PROVIDER_LABELS,
  resolveExternalResourceProvider,
} from "./externalResourceProviders.js";

export const EXTERNAL_RESOURCE_TOKEN_TTL_MS = 15 * 60 * 1000;
export const EXTERNAL_RESOURCE_CACHE_TTL_MS = 10 * 60 * 1000;
export const EXTERNAL_RESOURCE_MAX_BYTES = 500 * 1024 * 1024;

const MAX_REDIRECTS = 5;
const RESOLVE_TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 500;
const MAX_RATE_BUCKETS = 2_000;

const IMAGE_MIME = /^image\//i;
const AUDIO_MIME = /^audio\//i;
const VIDEO_MIME = /^video\//i;
const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/rtf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
]);

const EXTENSION_MEDIA_TYPES = {
  avif: "image",
  gif: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  webp: "image",
  aac: "audio",
  flac: "audio",
  m4a: "audio",
  mp3: "audio",
  oga: "audio",
  ogg: "audio",
  wav: "audio",
  m3u8: "video",
  mov: "video",
  mp4: "video",
  m4v: "video",
  ogv: "video",
  webm: "video",
  md: "document",
  pdf: "document",
  rtf: "document",
  doc: "document",
  docx: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  txt: "document",
};

const asString = (value) => (typeof value === "string" ? value : "");

export class ExternalResourceError extends Error {
  constructor(message, { statusCode = 400, code = "external_resource_error" } = {}) {
    super(message);
    this.name = "ExternalResourceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const normalizeMimeType = (value) => asString(value).split(";", 1)[0].trim().toLowerCase();

const cleanFileName = (value) => {
  const filename = asString(value).trim().replace(/[\\/\0]/g, "");
  if (!filename || filename === "." || filename === "..") return "";
  return filename.slice(0, 240);
};

const filenameFromContentDisposition = (value) => {
  const header = asString(value);
  const encoded = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return cleanFileName(decodeURIComponent(encoded.replace(/^"|"$/g, "")));
    } catch {
      return cleanFileName(encoded);
    }
  }
  return cleanFileName(header.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || header.match(/filename\s*=\s*([^;]+)/i)?.[1]);
};

const filenameFromUrl = (value) => {
  try {
    const pathname = new URL(value).pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || "";
    return cleanFileName(decodeURIComponent(filename));
  } catch {
    return "";
  }
};

const mediaTypeFor = (mimeType, filename, fallbackUrl) => {
  const mime = normalizeMimeType(mimeType);
  if (mime === "text/html" || mime === "application/xhtml+xml") return "web";
  if (IMAGE_MIME.test(mime)) return "image";
  if (AUDIO_MIME.test(mime)) return "audio";
  if (VIDEO_MIME.test(mime)) return "video";
  if (DOCUMENT_MIMES.has(mime)) return "document";
  const extension = (filename || filenameFromUrl(fallbackUrl)).toLowerCase().split(".").pop() || "";
  return EXTENSION_MEDIA_TYPES[extension] || "unknown";
};

const headerValue = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return asString(headers.get(name));
  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === lowerName);
  return key ? asString(headers[key]) : "";
};

const isRedirect = (status) => [301, 302, 303, 307, 308].includes(Number(status));

const ipv4Parts = (value) => {
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
};

const isBlockedIpv4 = (value) => {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const ipv6ToBigInt = (value) => {
  const normalized = value.toLowerCase().split("%", 1)[0];
  const pieces = normalized.split("::");
  if (pieces.length > 2) return null;
  const expand = (part) => {
    if (!part) return [];
    const output = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const parts = ipv4Parts(piece);
        if (!parts) return null;
        output.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) {
        output.push(Number.parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return output;
  };
  const left = expand(pieces[0]);
  const right = expand(pieces[1] || "");
  if (!left || !right || (pieces.length === 1 && left.length !== 8) || left.length + right.length > 8) return null;
  const groups = [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  return groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n);
};

const isBlockedIp = (address) => {
  if (net.isIP(address) === 4) return isBlockedIpv4(address);
  if (net.isIP(address) !== 6) return true;
  const value = ipv6ToBigInt(address);
  if (value === null) return true;
  const first = value >> 120n;
  const firstSeven = value >> 121n;
  const firstTen = value >> 118n;
  const mappedIpv4 = value >> 32n;
  return (
    value === 0n ||
    value === 1n ||
    firstSeven === 0b1111110n || // fc00::/7
    firstTen === 0b1111111010n || // fe80::/10
    firstTen === 0b1111111011n || // fec0::/10 (deprecated site-local)
    first === 0xffn || // multicast
    (value >> 96n) === 0n ||
    (value >> 96n) === 0x20010db8n || // documentation
    (value >> 96n) === 0xffffn && isBlockedIpv4([
      Number((mappedIpv4 >> 24n) & 255n),
      Number((mappedIpv4 >> 16n) & 255n),
      Number((mappedIpv4 >> 8n) & 255n),
      Number(mappedIpv4 & 255n),
    ].join("."))
  );
};

const blockedHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    normalized === "metadata.google.internal" ||
    normalized === "metadata" ||
    normalized === "instance-data.ec2.internal"
  );
};

const defaultLookup = (hostname, options) => dns.lookup(hostname, options);

const lookupRecords = async (lookup, hostname) => {
  const result = await lookup(hostname, { all: true, verbatim: true });
  const records = Array.isArray(result) ? result : [result];
  const validatedRecords = records.map((record) => {
    const address = typeof record === "string" ? record : record?.address;
    const family = net.isIP(address);
    return address ? { address, family } : null;
  }).filter(Boolean);
  if (!validatedRecords.length || validatedRecords.some(({ address }) => isBlockedIp(address))) {
    throw new ExternalResourceError("That resource host is not publicly reachable.", {
      statusCode: 400,
      code: "blocked_host",
    });
  }
  return validatedRecords;
};

export const validateExternalResourceUrl = async (value, { lookup = defaultLookup } = {}) => {
  const trimmed = asString(value).trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ExternalResourceError("Enter a valid resource URL.", { code: "invalid_url" });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ExternalResourceError("Only public HTTP and HTTPS resources can be previewed.", { code: "unsafe_url" });
  }
  if (parsed.port && !["80", "443"].includes(parsed.port)) {
    throw new ExternalResourceError("That resource uses an unsupported port.", { code: "unsafe_port" });
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (blockedHostname(hostname)) {
    throw new ExternalResourceError("That resource host is not allowed.", { code: "blocked_host" });
  }
  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw new ExternalResourceError("That resource host is not publicly reachable.", {
      statusCode: 400,
      code: "blocked_host",
    });
  }
  await lookupRecords(lookup, hostname);
  return parsed.toString();
};

const createLookupFamilyError = (hostname, family) => {
  const error = new Error(`getaddrinfo ENOTFOUND ${hostname}${family ? ` (IPv${family})` : ""}`);
  error.code = "ENOTFOUND";
  error.hostname = hostname;
  return error;
};

export const createSafeLookup = (lookup) => async (hostname, options = {}, callback) => {
  try {
    const records = await lookupRecords(lookup, hostname);
    const matchingRecords = options.family
      ? records.filter(({ family }) => family === options.family)
      : records;
    if (!matchingRecords.length) throw createLookupFamilyError(hostname, options.family);

    if (options.all === true) {
      callback(null, matchingRecords);
      return;
    }

    const { address, family } = matchingRecords[0];
    callback(null, address, family);
  } catch (error) {
    callback(error);
  }
};

const drainResponse = (response) => {
  const body = response?.data;
  if (body && typeof body.destroy === "function") body.destroy();
};

const readResponsePrefix = async (response, maxBytes = 4096) => {
  const body = response?.data;
  if (typeof body === "string") return body.slice(0, maxBytes).toLowerCase();
  if (Buffer.isBuffer(body)) return body.subarray(0, maxBytes).toString("utf8").toLowerCase();
  if (!body?.[Symbol.asyncIterator]) return "";
  const chunks = [];
  let size = 0;
  const iterator = body[Symbol.asyncIterator]();
  try {
    while (size < maxBytes) {
      const { value, done } = await iterator.next();
      if (done) break;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = maxBytes - size;
      chunks.push(chunk.subarray(0, remaining));
      size += Math.min(chunk.length, remaining);
    }
  } finally {
    if (size >= maxBytes) await iterator.return?.();
    drainResponse(response);
  }
  return Buffer.concat(chunks, size).toString("utf8").toLowerCase();
};

const createCache = () => new Map();

const rateLimiter = () => {
  const buckets = new Map();
  return (key, { limit, windowMs }) => {
    const now = Date.now();
    const prior = buckets.get(key) || [];
    const current = prior.filter((timestamp) => timestamp > now - windowMs);
    if (buckets.size > MAX_RATE_BUCKETS) {
      for (const [bucketKey, timestamps] of buckets) {
        if (!timestamps.some((timestamp) => timestamp > now - windowMs)) buckets.delete(bucketKey);
      }
    }
    if (current.length >= limit) return false;
    current.push(now);
    buckets.set(key, current);
    return true;
  };
};

const secretForEnvironment = () => {
  if (process.env.AUTH_EXTERNAL_RESOURCE_TOKEN_SECRET) return process.env.AUTH_EXTERNAL_RESOURCE_TOKEN_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_EXTERNAL_RESOURCE_TOKEN_SECRET is required in production.");
  }
  return crypto.createHash("sha256").update(`worshipsync:external-resource:${process.env.AUTH_SESSION_SECRET || "dev-auth-secret"}`).digest();
};

const encodeTokenPart = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decodeTokenPart = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
const signTokenPart = (secret, body) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

export const createExternalResourceProxyToken = (secret, payload, expiresAt = Date.now() + EXTERNAL_RESOURCE_TOKEN_TTL_MS) => {
  const body = encodeTokenPart({ ...payload, exp: expiresAt });
  return `${body}.${signTokenPart(secret, body)}`;
};

export const verifyExternalResourceProxyToken = (secret, token, now = Date.now()) => {
  const [body, signature, ...extra] = asString(token).split(".");
  if (!body || !signature || extra.length) return { valid: false, reason: "malformed" };
  const expected = signTokenPart(secret, body);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return { valid: false, reason: "signature" };
  }
  let payload;
  try {
    payload = decodeTokenPart(body);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!payload?.t || !Number.isFinite(payload.exp)) return { valid: false, reason: "malformed" };
  if (payload.exp <= now) return { valid: false, reason: "expired" };
  return { valid: true, payload };
};

const safeResponseContentType = (value) => {
  const mime = normalizeMimeType(value);
  return mime && mime !== "text/html" && mime !== "application/xhtml+xml" && !mime.includes("javascript")
    ? mime
    : "";
};

const parseContentLength = (value) => {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const contentRangeTotal = (value) => {
  const match = asString(value).match(/^bytes\s+\d+-\d+\/(\d+|\*)$/i);
  if (!match || match[1] === "*") return null;
  return Number.parseInt(match[1], 10);
};

const isHtmlResponse = (response) => {
  const mime = normalizeMimeType(headerValue(response?.headers, "content-type"));
  return mime === "text/html" || mime === "application/xhtml+xml";
};

const shouldProbeByGet = (response, { provider, candidateUrl, finalUrl }) => {
  const status = Number(response?.status || 0);
  if (status === 405 || status === 501) return true;
  if (provider === "sharepoint" && [401, 403].includes(status)) return true;
  if (status < 200 || status >= 300) return false;
  if (!headerValue(response?.headers, "content-type")) return true;
  const filename = filenameFromContentDisposition(headerValue(response?.headers, "content-disposition"));
  const expectedType = mediaTypeFor(
    headerValue(response?.headers, "content-type"),
    filename,
    finalUrl || candidateUrl,
  );
  const expectedFile = expectedType !== "unknown" && expectedType !== "web";
  const hostedFile = ["dropbox", "google-drive", "onedrive", "box", "sharepoint"].includes(provider);
  return (provider === "sharepoint" && (isHtmlResponse(response) || !expectedFile)) ||
    (isHtmlResponse(response) && (hostedFile || expectedFile));
};

const sharePointHtmlReason = ({ response, finalUrl, bodyText = "" }) => {
  const status = Number(response?.status || 0);
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    url = null;
  }
  const pathAndQuery = `${url?.pathname || ""}${url?.search || ""}`.toLowerCase();
  if (status === 401 || /login\.microsoftonline\.com|login\.live\.com|signin|authenticate/.test(url?.hostname + pathAndQuery) ||
      /sign in to your account|sign-in required|login to microsoft|need to sign in/.test(bodyText)) {
    return "This SharePoint link requires sign-in.";
  }
  if (status === 403 || /accessdenied|access-denied|unauthorized/.test(pathAndQuery) || /access denied|you don.t have permission/.test(bodyText)) {
    return "You don’t have access to this SharePoint file.";
  }
  if (/sharinglinkexpired|expired|invalidlink|invalid-link/.test(pathAndQuery) || status === 404 || /link has expired|sharing link is invalid|link is no longer available/.test(bodyText)) {
    return "This SharePoint sharing link may be expired or invalid.";
  }
  return "The SharePoint link did not resolve to a downloadable file.";
};

const isSuccessful = (response) => Number(response?.status || 0) >= 200 && Number(response?.status || 0) < 300;

const documentPreviewTypeFor = (mimeType, fileName, url) => {
  const mime = normalizeMimeType(mimeType);
  const byMime = {
    "application/pdf": "document", "application/x-pdf": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "text", "text/markdown": "text",
  };
  if (byMime[mime]) return byMime[mime];
  // Known unsupported MIME metadata must not be overridden by a filename.
  if (DOCUMENT_MIMES.has(mime)) return "unsupported";
  const extension = (fileName || filenameFromUrl(url)).toLowerCase().split(".").pop();
  return { pdf: "document", docx: "docx", txt: "text", md: "text" }[extension] || "unsupported";
};

const buildDescriptor = ({ originalUrl, provider, mediaId, candidateUrl, finalUrl, mimeType, fileName, title, mediaType, reason }) => {
  const previewType = provider === "youtube"
    ? "youtube"
    : mediaType === "web"
      ? "web"
      : mediaType === "document"
        ? documentPreviewTypeFor(mimeType, fileName, finalUrl || candidateUrl)
      : ["image", "audio", "video"].includes(mediaType)
        ? mediaType
        : "unsupported";
  const canPreview = previewType !== "unsupported";
  const requiresProxy = canPreview && !["youtube", "web"].includes(previewType);
  return {
    originalUrl,
    externalUrl: originalUrl,
    provider,
    title: title || fileName || EXTERNAL_RESOURCE_PROVIDER_LABELS[provider] || "Content preview",
    ...(fileName ? { filename: fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    mediaType,
    previewType,
    previewUrl: canPreview && !requiresProxy ? (finalUrl || candidateUrl) : null,
    requiresProxy,
    canPreview,
    ...(mediaId ? { mediaId } : {}),
    ...((reason || !canPreview) ? { reason: reason || "This file format isn’t supported for preview. Open or download the file to view it." } : {}),
    _upstreamUrl: finalUrl || candidateUrl,
  };
};

export const createExternalResourceService = ({
  httpClient = axios,
  lookup = defaultLookup,
  tokenSecret = secretForEnvironment(),
  now = () => Date.now(),
  cacheTtlMs = EXTERNAL_RESOURCE_CACHE_TTL_MS,
  maxCacheEntries = MAX_CACHE_ENTRIES,
  maxBytes = EXTERNAL_RESOURCE_MAX_BYTES,
  tokenTtlMs = EXTERNAL_RESOURCE_TOKEN_TTL_MS,
  proxyBasePath = "/api/resources/proxy",
} = {}) => {
  const cache = createCache();
  const pending = new Map();
  const checkRate = rateLimiter();
  const safeLookup = createSafeLookup(lookup);
  const httpAgent = new http.Agent({ lookup: safeLookup });
  const httpsAgent = new https.Agent({ lookup: safeLookup });

  const request = async ({ url, method, headers = {}, responseType }) => {
    const safeUrl = await validateExternalResourceUrl(url, { lookup });
    return httpClient.request({
      url: safeUrl,
      method,
      headers,
      timeout: RESOLVE_TIMEOUT_MS,
      maxRedirects: 0,
      responseType,
      decompress: false,
      proxy: false,
      validateStatus: () => true,
      httpAgent,
      httpsAgent,
    });
  };

  const requestFollowingRedirects = async ({ url, method, headers, responseType }) => {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await request({ url: currentUrl, method, headers, responseType });
      if (!isRedirect(response.status)) return { response, finalUrl: currentUrl };
      const location = headerValue(response.headers, "location");
      drainResponse(response);
      if (!location) throw new ExternalResourceError("The resource returned an invalid redirect.", { statusCode: 502, code: "invalid_redirect" });
      if (redirectCount === MAX_REDIRECTS) throw new ExternalResourceError("The resource redirected too many times.", { statusCode: 502, code: "redirect_limit" });
      currentUrl = new URL(location, currentUrl).toString();
    }
    throw new ExternalResourceError("The resource could not be reached.", { statusCode: 502, code: "redirect_limit" });
  };

  const probe = async ({ originalUrl, provider, mediaId, candidateUrl, probeWithGet = false, nativeGoogleDocument = false }) => {
    let stage = probeWithGet ? "direct_get" : "head";
    try {
      let result;
      const getOptions = {
        url: candidateUrl,
        method: "GET",
        headers: {
          Accept: "*/*",
          Range: "bytes=0-0",
          "User-Agent": "WorshipSync-resource-resolver/1",
        },
        responseType: "stream",
      };
      if (probeWithGet) {
        result = await requestFollowingRedirects(getOptions);
      } else {
        result = await requestFollowingRedirects({
          url: candidateUrl,
          method: "HEAD",
          headers: { Accept: "*/*", "User-Agent": "WorshipSync-resource-resolver/1" },
        });
        if (shouldProbeByGet(result.response, { provider, candidateUrl, finalUrl: result.finalUrl })) {
          drainResponse(result.response);
          stage = "fallback_get";
          result = await requestFollowingRedirects(getOptions);
        }
      }

      const response = result.response;
      const mimeType = normalizeMimeType(headerValue(response.headers, "content-type")) || undefined;
      const fileName = filenameFromContentDisposition(headerValue(response.headers, "content-disposition")) || filenameFromUrl(result.finalUrl) || undefined;
      const mediaType = mediaTypeFor(mimeType, fileName, result.finalUrl);
      const declaredLength = parseContentLength(headerValue(response.headers, "content-length"));
      const declaredTotal = contentRangeTotal(headerValue(response.headers, "content-range"));
      const htmlPrefix = provider === "sharepoint" && isHtmlResponse(response)
        ? await readResponsePrefix(response)
        : "";
      drainResponse(response);
      if (nativeGoogleDocument && (!isSuccessful(response) || mimeType !== "application/pdf")) {
        return buildDescriptor({
          originalUrl,
          provider,
          mediaId,
          candidateUrl,
          finalUrl: result.finalUrl,
          mimeType,
          fileName,
          mediaType: "unknown",
          reason: "This Google document could not be exported for preview.",
        });
      }
      if (!isSuccessful(response)) {
        const reason = provider === "sharepoint"
          ? sharePointHtmlReason({ response, finalUrl: result.finalUrl, bodyText: htmlPrefix })
          : undefined;
        return buildDescriptor({
          originalUrl,
          provider,
          mediaId,
          candidateUrl,
          finalUrl: result.finalUrl,
          mimeType,
          fileName,
          mediaType: "unknown",
          reason: reason || `The ${EXTERNAL_RESOURCE_PROVIDER_LABELS[provider] || "resource"} link could not be read.`,
        });
      }
      if ((declaredLength !== null && declaredLength > maxBytes) || (declaredTotal !== null && declaredTotal > maxBytes)) {
        return buildDescriptor({
          originalUrl,
          provider,
          mediaId,
          candidateUrl,
          finalUrl: result.finalUrl,
          mimeType,
          fileName,
          mediaType: "unknown",
          reason: "That resource is too large to preview.",
        });
      }
      if (provider === "sharepoint" && (mediaType === "web" || mediaType === "unknown")) {
        return buildDescriptor({
          originalUrl,
          provider,
          mediaId,
          candidateUrl,
          finalUrl: result.finalUrl,
          mimeType,
          fileName,
          mediaType: "unknown",
          reason: sharePointHtmlReason({ response, finalUrl: result.finalUrl, bodyText: htmlPrefix }),
        });
      }
      return buildDescriptor({ originalUrl, provider, mediaId, candidateUrl, finalUrl: result.finalUrl, mimeType, fileName, mediaType });
    } catch (error) {
      const safeCode = typeof error?.code === "string" && /^[A-Z0-9_-]{1,64}$/i.test(error.code) ? error.code : undefined;
      const statusValue = error?.statusCode || error?.response?.status;
      const safeStatus = Number.isInteger(Number(statusValue)) ? Number(statusValue) : undefined;
      console.warn("[external-resource] Provider probe failed", {
        provider,
        stage,
        errorType: typeof error?.name === "string" ? error.name.slice(0, 64) : "Error",
        ...(safeCode ? { code: safeCode } : {}),
        ...(safeStatus ? { status: safeStatus } : {}),
      });
      throw error;
    }
  };

  const resolveBase = async (originalUrl) => {
    const providerInfo = resolveExternalResourceProvider(originalUrl);
    if (providerInfo.provider === "youtube") {
      return buildDescriptor({
        originalUrl,
        provider: providerInfo.provider,
        mediaId: providerInfo.mediaId,
        candidateUrl: providerInfo.candidateUrl,
        finalUrl: providerInfo.candidateUrl,
        mediaType: "video",
        title: "YouTube video",
      });
    }
    try {
      return await probe({ originalUrl, ...providerInfo });
    } catch (error) {
      if (error instanceof ExternalResourceError) throw error;
      if (providerInfo.nativeGoogleDocument) {
        return buildDescriptor({
          originalUrl,
          provider: providerInfo.provider,
          candidateUrl: providerInfo.candidateUrl,
          mediaType: "unknown",
          reason: "This Google document could not be exported for preview.",
        });
      }
      return buildDescriptor({
        originalUrl,
        provider: providerInfo.provider,
        mediaId: providerInfo.mediaId,
        candidateUrl: providerInfo.candidateUrl,
        mediaType: "unknown",
        reason: "The resource could not be reached.",
      });
    }
  };

  const getBase = async (originalUrl) => {
    const cached = cache.get(originalUrl);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (pending.has(originalUrl)) return pending.get(originalUrl);
    const work = resolveBase(originalUrl).then((value) => {
      cache.delete(originalUrl);
      cache.set(originalUrl, { value, expiresAt: now() + cacheTtlMs });
      while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
      pending.delete(originalUrl);
      return value;
    }).catch((error) => {
      pending.delete(originalUrl);
      throw error;
    });
    pending.set(originalUrl, work);
    return work;
  };

  const decorate = (base) => {
    const descriptor = { ...base };
    delete descriptor._upstreamUrl;
    if (base.requiresProxy && base.canPreview) {
      const token = createExternalResourceProxyToken(tokenSecret, {
        t: base._upstreamUrl,
        n: crypto.randomUUID(),
        p: base.provider,
        mt: base.mediaType,
        pt: base.previewType,
        m: base.mimeType || "",
        f: base.filename || "",
      }, now() + tokenTtlMs);
      descriptor.previewUrl = `${proxyBasePath}?token=${encodeURIComponent(token)}`;
    }
    return descriptor;
  };

  const resolve = async (value) => {
    const originalUrl = await validateExternalResourceUrl(value, { lookup });
    return decorate(await getBase(originalUrl));
  };

  const handleProxy = async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(405).json({ error: "Only GET and HEAD preview requests are supported." });
    }
    const token = asString(req.query?.token);
    const requester = req.appSession?.actorId || req.ip || req.socket?.remoteAddress || "unknown";
    if (!checkRate(`proxy:${requester}`, { limit: 120, windowMs: 60_000 })) {
      return res.status(429).json({ error: "Too many preview requests. Try again shortly." });
    }
    const verified = verifyExternalResourceProxyToken(tokenSecret, token, now());
    if (!verified.valid) return res.status(401).json({ error: "This preview link has expired." });
    const payload = verified.payload;
    if (!["image", "audio", "video", "document", "docx", "text"].includes(payload.pt)) {
      return res.status(403).json({ error: "HTML resources are not proxied." });
    }
    const targetUrl = await validateExternalResourceUrl(payload.t, { lookup });
    const range = asString(req.headers?.range);
    if (range && !/^bytes=(?:\d+-\d*|\-\d+)(?:\s*)$/i.test(range)) {
      return res.status(416).json({ error: "Only one byte range can be requested." });
    }
    const responseResult = await requestFollowingRedirects({
      url: targetUrl,
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: {
        Accept: "*/*",
        "User-Agent": "WorshipSync-resource-proxy/1",
        ...(range ? { Range: range } : {}),
      },
      responseType: "stream",
    });
    const response = responseResult.response;
    const responseMime = safeResponseContentType(headerValue(response.headers, "content-type"));
    if (!responseMime && isSuccessful(response)) {
      drainResponse(response);
      return res.status(415).json({ error: "That resource is not a previewable media file." });
    }
    if (responseMime === "text/html" || responseMime === "application/xhtml+xml") {
      drainResponse(response);
      return res.status(415).json({ error: "HTML resources are not proxied." });
    }
    const contentLength = parseContentLength(headerValue(response.headers, "content-length"));
    const totalLength = contentRangeTotal(headerValue(response.headers, "content-range"));
    if ((contentLength !== null && contentLength > maxBytes) || (totalLength !== null && totalLength > maxBytes)) {
      drainResponse(response);
      return res.status(413).json({ error: "That resource is too large to preview." });
    }

    const status = Number(response.status || 502);
    const allowedStatus = status === 200 || status === 206 || status === 416 || status === 204;
    if (!allowedStatus) {
      drainResponse(response);
      return res.status(status >= 400 && status < 600 ? status : 502).json({ error: "The resource could not be loaded." });
    }

    const outputMime = responseMime || normalizeMimeType(payload.m) || "application/octet-stream";
    res.status(status);
    res.setHeader("Content-Type", outputMime);
    res.setHeader("Cache-Control", "private, max-age=60");
    const contentRange = headerValue(response.headers, "content-range");
    if (contentRange && /^bytes\s+\d+-\d+\/(?:\d+|\*)$/i.test(contentRange)) res.setHeader("Content-Range", contentRange);
    const acceptRanges = headerValue(response.headers, "accept-ranges");
    if (acceptRanges.toLowerCase() === "bytes") res.setHeader("Accept-Ranges", "bytes");
    if (contentLength !== null) res.setHeader("Content-Length", String(contentLength));
    if (req.method === "HEAD" || status === 204) {
      drainResponse(response);
      return res.end();
    }
    if (!response.data || typeof response.data.pipe !== "function") return res.end();
    let streamedBytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        streamedBytes += chunk.length;
        if (streamedBytes > maxBytes) {
          callback(new ExternalResourceError("That resource is too large to preview.", { statusCode: 413, code: "resource_too_large" }));
          return;
        }
        callback(null, chunk, encoding);
      },
    });
    try {
      await pipeline(response.data, limiter, res);
    } catch (error) {
      if (!res.headersSent) return res.status(error?.statusCode || 502).json({ error: "The resource could not be streamed." });
      res.destroy();
    }
  };

  const resolveRateLimited = async (value, key = "unknown") => {
    if (!checkRate(`resolve:${key}`, { limit: 30, windowMs: 60_000 })) {
      throw new ExternalResourceError("Too many preview requests. Try again shortly.", { statusCode: 429, code: "rate_limited" });
    }
    return resolve(value);
  };

  return {
    resolve,
    resolveRateLimited,
    handleProxy,
    validateUrl: (value) => validateExternalResourceUrl(value, { lookup }),
    checkRate,
  };
};
