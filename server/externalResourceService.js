import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import axios from "axios";
import {
  EXTERNAL_RESOURCE_PROVIDER_LABELS,
  resolveExternalResourceProvider,
} from "./externalResourceProviders.js";
import {
  ExternalResourceError,
  contentRangeTotal,
  createByteLimitTransform,
  createExternalResourceNetwork,
  defaultExternalResourceLookup,
  drainResponse,
  headerValue,
  parseContentLength,
  readResponsePrefix,
  validateExternalResourceUrl,
} from "./externalResourceNetwork.js";
export { ExternalResourceError, validateExternalResourceUrl } from "./externalResourceNetwork.js";

export const EXTERNAL_RESOURCE_TOKEN_TTL_MS = 15 * 60 * 1000;
export const EXTERNAL_RESOURCE_CACHE_TTL_MS = 10 * 60 * 1000;
export const EXTERNAL_RESOURCE_MAX_BYTES = 500 * 1024 * 1024;

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

const isHtmlResponse = (response) => {
  const mime = normalizeMimeType(headerValue(response?.headers, "content-type"));
  return mime === "text/html" || mime === "application/xhtml+xml";
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
  if (/sharinglinkexpired|expired|invalidlink|invalid-link/.test(pathAndQuery) || status === 404 || /link has expired|sharing link is invalid|link is no longer available/.test(bodyText)) {
    return "This SharePoint sharing link may be expired or invalid.";
  }
  if (status === 403 || /accessdenied|access-denied|unauthorized/.test(pathAndQuery) || /access denied|you don.t have permission/.test(bodyText)) {
    return "This SharePoint file isn’t publicly accessible.";
  }
  if (isSuccessful(response) && (isHtmlResponse(response) || !bodyText)) {
    return "This file can be viewed in SharePoint, but SharePoint did not provide downloadable file access for an in-app preview.";
  }
  return "The SharePoint link did not resolve to a downloadable file.";
};

const isSuccessful = (response) => Number(response?.status || 0) >= 200 && Number(response?.status || 0) < 300;
const shouldRetryMetadataWithGet = (response) => {
  const status = Number(response?.status || 0);
  if (status === 405 || status === 501) return true;
  if (status < 200 || status >= 300) return false;
  return !headerValue(response?.headers, "content-type");
};

const buildDescriptor = ({ originalUrl, provider, mediaId, candidateUrl, finalUrl, mimeType, fileName, title, mediaType, reason }) => {
  const previewType = provider === "youtube"
    ? "youtube"
    : mediaType === "web"
      ? "web"
      : ["image", "audio", "video", "document"].includes(mediaType)
        ? mediaType
        : "unsupported";
  const canPreview = previewType !== "unsupported";
  const sourceKind = provider === "youtube"
    ? "youtube"
    : mediaType === "web"
      ? "web"
      : mediaType !== "unknown" || !reason
        ? "file"
        : "unavailable";
  return {
    originalUrl,
    externalUrl: originalUrl,
    provider,
    sourceKind,
    title: title || fileName || EXTERNAL_RESOURCE_PROVIDER_LABELS[provider] || "Content preview",
    ...(fileName ? { filename: fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    mediaType,
    previewType,
    previewUrl: sourceKind === "web" || sourceKind === "youtube" ? (finalUrl || candidateUrl) : null,
    // Deprecated API compatibility fields. Runtime decisions use sourceKind.
    requiresProxy: canPreview && sourceKind === "file",
    canPreview,
    ...(mediaId ? { mediaId } : {}),
    ...(reason ? { reason } : {}),
    // Probe redirects may be short-lived signed URLs. Always retrieve from the
    // strategy's stable starting URL and validate its redirects again at use time.
    _proxyTargetUrl: candidateUrl,
  };
};

export const createExternalResourceService = ({
  httpClient = axios,
  lookup = defaultExternalResourceLookup,
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
  const { requestFollowingRedirects } = createExternalResourceNetwork({ httpClient, lookup });

  const requestMetadata = async ({ url, retrievalStrategy, intent = "file-probe" }) => {
    const requestHeaders = { Accept: "*/*", "User-Agent": "WorshipSync-resource-resolver/1", ...(intent === "view-access" ? { "Accept-Encoding": "identity" } : {}) };
    let result = retrievalStrategy === "metadata-probe"
      ? await requestFollowingRedirects({ url, method: "HEAD", headers: requestHeaders })
      : await requestFollowingRedirects({ url, method: "GET", headers: { ...requestHeaders, ...(intent === "file-probe" ? { Range: "bytes=0-0" } : {}) }, responseType: "stream" });
    if (retrievalStrategy === "metadata-probe" && shouldRetryMetadataWithGet(result.response)) {
      drainResponse(result.response);
      result = await requestFollowingRedirects({
        url,
        method: "GET",
        headers: { ...requestHeaders, Range: "bytes=0-0" },
        responseType: "stream",
      });
    }
    return result;
  };

  const describeProbeResult = async ({ originalUrl, provider, mediaId, candidateUrl, result, expectedMimeType, failureReason }) => {
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
    if (expectedMimeType && mimeType !== expectedMimeType) {
      return buildDescriptor({ originalUrl, provider, mediaId, candidateUrl, finalUrl: result.finalUrl, mimeType, fileName,
        mediaType: "unknown", reason: failureReason });
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
        reason: reason || failureReason || `The ${EXTERNAL_RESOURCE_PROVIDER_LABELS[provider] || "resource"} link could not be read.`,
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
    if (provider === "sharepoint" && mediaType === "web") {
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
  };

  const probe = async ({ originalUrl, provider, mediaId, candidateUrl, retrievalStrategy, expectedMimeType, failureReason }) => {
    if (provider !== "sharepoint") {
      const result = await requestMetadata({ url: candidateUrl, retrievalStrategy });
      return describeProbeResult({ originalUrl, provider, mediaId, candidateUrl, result, expectedMimeType, failureReason });
    }

    let candidateResult;
    try {
      candidateResult = await requestMetadata({ url: candidateUrl, retrievalStrategy: "get" });
    } catch (error) {
      if (error instanceof ExternalResourceError) throw error;
    }
    if (candidateResult) {
      const candidateDescriptor = await describeProbeResult({ originalUrl, provider, mediaId, candidateUrl, result: candidateResult });
      if (candidateDescriptor.sourceKind === "file") return candidateDescriptor;
    }

    // A failed download candidate does not establish whether the anonymous
    // sharing link itself is viewable. Recheck that original URL without credentials.
    const shareResult = await requestMetadata({ url: originalUrl, retrievalStrategy: "get", intent: "view-access" });
    const shareDescriptor = await describeProbeResult({ originalUrl, provider, mediaId, candidateUrl: originalUrl, result: shareResult });
    if (shareDescriptor.sourceKind === "file") return shareDescriptor;
    const reason = shareDescriptor.reason || sharePointHtmlReason({
      response: shareResult.response,
      finalUrl: shareResult.finalUrl,
    });
    return buildDescriptor({
      originalUrl,
      provider,
      mediaId,
      candidateUrl,
      finalUrl: shareResult.finalUrl,
      mimeType: shareDescriptor.mimeType,
      fileName: shareDescriptor.filename,
      mediaType: "unknown",
      reason,
    });
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
    delete descriptor._proxyTargetUrl;
    if (base.sourceKind === "file") {
      const expiresAt = now() + tokenTtlMs;
      const token = createExternalResourceProxyToken(tokenSecret, {
        t: base._proxyTargetUrl,
        n: crypto.randomUUID(),
        p: base.provider,
        sk: base.sourceKind,
        mt: base.mediaType,
        pt: base.previewType,
        m: base.mimeType || "",
        f: base.filename || "",
      }, expiresAt);
      descriptor.previewUrl = `${proxyBasePath}?token=${encodeURIComponent(token)}`;
      descriptor.expiresAt = new Date(expiresAt).toISOString();
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
    if (payload.sk !== "file" && !(payload.sk === undefined && ["image", "audio", "video", "document", "docx", "text"].includes(payload.pt))) {
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
    const limiter = createByteLimitTransform(maxBytes);
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
