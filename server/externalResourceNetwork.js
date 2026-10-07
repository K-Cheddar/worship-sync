import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Transform } from "node:stream";

const RESOLVE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
const asString = (value) => (typeof value === "string" ? value : "");

export class ExternalResourceError extends Error {
  constructor(message, { statusCode = 400, code = "external_resource_error" } = {}) {
    super(message);
    this.name = "ExternalResourceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const ipv4Parts = (value) => {
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
};

const isBlockedIpv4 = (value) => {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
};

const ipv6ToBigInt = (value) => {
  const pieces = value.toLowerCase().split("%", 1)[0].split("::");
  if (pieces.length > 2) return null;
  const expand = (part) => {
    if (!part) return [];
    const output = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const parts = ipv4Parts(piece);
        if (!parts) return null;
        output.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) output.push(Number.parseInt(piece, 16));
      else return null;
    }
    return output;
  };
  const left = expand(pieces[0]);
  const right = expand(pieces[1] || "");
  if (!left || !right || (pieces.length === 1 && left.length !== 8) || left.length + right.length > 8) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    .reduce((result, group) => (result << 16n) | BigInt(group), 0n);
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
  return value === 0n || value === 1n || firstSeven === 0b1111110n || firstTen === 0b1111111010n ||
    firstTen === 0b1111111011n || first === 0xffn || (value >> 96n) === 0n ||
    (value >> 96n) === 0x20010db8n || ((value >> 96n) === 0xffffn && isBlockedIpv4([
      Number((mappedIpv4 >> 24n) & 255n), Number((mappedIpv4 >> 16n) & 255n),
      Number((mappedIpv4 >> 8n) & 255n), Number(mappedIpv4 & 255n),
    ].join(".")));
};

const blockedHostname = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") ||
    normalized.endsWith(".internal") || normalized.endsWith(".lan") || normalized === "metadata.google.internal" ||
    normalized === "metadata" || normalized === "instance-data.ec2.internal";
};

const lookupAddresses = async (lookup, hostname) => {
  // Keep all-address resolution: rejecting a host if any answer is private prevents DNS rebinding/mixed answers.
  const result = await lookup(hostname, { all: true, verbatim: true });
  const records = Array.isArray(result) ? result : [result];
  const addresses = records.map((record) => typeof record === "string" ? record : record?.address).filter(Boolean);
  if (!addresses.length || addresses.some(isBlockedIp)) {
    throw new ExternalResourceError("That resource host is not publicly reachable.", { statusCode: 400, code: "blocked_host" });
  }
  return addresses;
};

export const defaultExternalResourceLookup = (hostname, options) => dns.lookup(hostname, options);

export const validateExternalResourceUrl = async (value, { lookup = defaultExternalResourceLookup } = {}) => {
  let parsed;
  try { parsed = new URL(asString(value).trim()); }
  catch { throw new ExternalResourceError("Enter a valid resource URL.", { code: "invalid_url" }); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ExternalResourceError("Only public HTTP and HTTPS resources can be previewed.", { code: "unsafe_url" });
  }
  if (parsed.port && !["80", "443"].includes(parsed.port)) {
    throw new ExternalResourceError("That resource uses an unsupported port.", { code: "unsafe_port" });
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (blockedHostname(hostname) || (net.isIP(hostname) && isBlockedIp(hostname))) {
    throw new ExternalResourceError("That resource host is not publicly reachable.", { statusCode: 400, code: "blocked_host" });
  }
  await lookupAddresses(lookup, hostname);
  return parsed.toString();
};

const createSafeLookup = (lookup) => async (hostname, options = {}, callback) => {
  try {
    const addresses = await lookupAddresses(lookup, hostname);
    const records = addresses.map((address) => ({ address, family: net.isIP(address) }));
    const matchingRecords = options.family
      ? records.filter((record) => record.family === options.family)
      : records;
    if (!matchingRecords.length) {
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}${options.family ? ` (IPv${options.family})` : ""}`);
      error.code = "ENOTFOUND";
      error.hostname = hostname;
      throw error;
    }
    if (options.all === true) {
      callback(null, matchingRecords);
      return;
    }
    const { address, family } = matchingRecords[0];
    callback(null, address, family);
  } catch (error) { callback(error); }
};

export const headerValue = (headers, name) => {
  if (!headers) return "";
  if (typeof headers.get === "function") return asString(headers.get(name));
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? asString(headers[key]) : "";
};

export const isRedirect = (status) => [301, 302, 303, 307, 308].includes(Number(status));
export const drainResponse = (response) => { if (response?.data && typeof response.data.destroy === "function") response.data.destroy(); };

export const parseContentLength = (value) => {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
export const contentRangeTotal = (value) => {
  const match = asString(value).match(/^bytes\s+\d+-\d+\/(\d+|\*)$/i);
  return !match || match[1] === "*" ? null : Number.parseInt(match[1], 10);
};

export const readResponsePrefix = async (response, maxBytes = 4096) => {
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
      chunks.push(chunk.subarray(0, maxBytes - size));
      size += Math.min(chunk.length, maxBytes - size);
    }
  } finally {
    if (size >= maxBytes) await iterator.return?.();
    drainResponse(response);
  }
  return Buffer.concat(chunks, size).toString("utf8").toLowerCase();
};

export const createByteLimitTransform = (maxBytes) => {
  let streamedBytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      streamedBytes += chunk.length;
      if (streamedBytes > maxBytes) {
        callback(new ExternalResourceError("That resource is too large to preview.", { statusCode: 413, code: "resource_too_large" }));
        return;
      }
      callback(null, chunk, encoding);
    },
  });
};

export const createExternalResourceNetwork = ({ httpClient, lookup = defaultExternalResourceLookup }) => {
  const safeLookup = createSafeLookup(lookup);
  const httpAgent = new http.Agent({ lookup: safeLookup });
  const httpsAgent = new https.Agent({ lookup: safeLookup });
  const request = async ({ url, method, headers = {}, responseType }) => {
    const safeUrl = await validateExternalResourceUrl(url, { lookup });
    return httpClient.request({ url: safeUrl, method, headers, timeout: RESOLVE_TIMEOUT_MS, maxRedirects: 0,
      responseType, decompress: false, proxy: false, validateStatus: () => true, httpAgent, httpsAgent });
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
  return { requestFollowingRedirects };
};
