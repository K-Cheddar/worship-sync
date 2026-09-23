import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

export const MAX_SAFE_HTTP_REDIRECTS = 5;

type ResolvedAddress = { address: string; family: 4 | 6 };
type LookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ResolvedAddress[]>;
type RequestFactory = (
  url: string,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

const ipv4ToNumber = (address: string) => {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => value * 256 + part, 0);
};

const ipv4InRange = (address: string, start: number, end: number) => {
  const value = ipv4ToNumber(address);
  return value !== null && value >= start && value <= end;
};

const ipv6ToBigInt = (address: string) => {
  const withoutZone = address.toLowerCase().split("%")[0];
  if (!withoutZone || withoutZone.includes("%")) return null;

  let normalized = withoutZone;
  const embeddedIpv4 = normalized.match(/(^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embeddedIpv4) {
    const ipv4 = ipv4ToNumber(embeddedIpv4[2]);
    if (ipv4 === null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    normalized = `${normalized.slice(0, embeddedIpv4.index)}${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (
    [...left, ...right].some(
      (part) => !/^[0-9a-f]{1,4}$/.test(part),
    )
  ) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    parseInt(part, 16),
  );
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
};

const ipv6InRange = (address: bigint, prefix: bigint, bits: number) => {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (address & mask) === prefix;
};

const isProhibitedIpv4 = (address: string) =>
  ipv4InRange(address, 0x00000000, 0x00ffffff) || // unspecified
  ipv4InRange(address, 0x0a000000, 0x0affffff) || // RFC1918
  ipv4InRange(address, 0x64400000, 0x647fffff) || // shared address space
  ipv4InRange(address, 0x7f000000, 0x7fffffff) || // loopback
  ipv4InRange(address, 0xa9fe0000, 0xa9feffff) || // link-local
  ipv4InRange(address, 0xac100000, 0xac1fffff) || // RFC1918
  ipv4InRange(address, 0xc0000000, 0xc00000ff) || // IETF protocol assignments
  ipv4InRange(address, 0xc0000200, 0xc00002ff) || // TEST-NET-1
  ipv4InRange(address, 0xc0a80000, 0xc0a8ffff) || // RFC1918
  ipv4InRange(address, 0xc6120000, 0xc613ffff) || // benchmarking
  ipv4InRange(address, 0xc6336400, 0xc63364ff) || // TEST-NET-2
  ipv4InRange(address, 0xcb007100, 0xcb0071ff) || // TEST-NET-3
  ipv4InRange(address, 0xe0000000, 0xffffffff); // multicast/reserved

export const isProhibitedIpAddress = (address: string) => {
  const family = isIP(address);
  if (family === 4) return isProhibitedIpv4(address);
  if (family !== 6) return true;

  const parsed = ipv6ToBigInt(address);
  if (parsed === null) return true;

  const mappedIpv4 = parsed >> 0n;
  if ((parsed >> 32n) === 0xffffn) {
    const mapped = [
      Number((mappedIpv4 >> 24n) & 0xffn),
      Number((mappedIpv4 >> 16n) & 0xffn),
      Number((mappedIpv4 >> 8n) & 0xffn),
      Number(mappedIpv4 & 0xffn),
    ].join(".");
    if (isProhibitedIpv4(mapped)) return true;
  }

  return (
    parsed === 0n || // unspecified
    parsed === 1n || // loopback
    ipv6InRange(parsed, 0xfc000000000000000000000000000000n, 7) || // unique-local
    ipv6InRange(parsed, 0xfe800000000000000000000000000000n, 10) || // link-local
    ipv6InRange(parsed, 0xff000000000000000000000000000000n, 8) || // multicast
    ipv6InRange(parsed, 0x20010db8000000000000000000000000n, 32) || // documentation
    ipv6InRange(parsed, 0x20010000000000000000000000000000n, 32) // ORCHIDv2/reserved
  );
};

const defaultLookupAll: LookupAll = async (hostname, options) =>
  (await dns.lookup(hostname, options)) as ResolvedAddress[];

export const validateSafeHttpUrl = async (
  rawUrl: string,
  lookupAll: LookupAll = defaultLookupAll,
) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid media URL");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(parsed.protocol) || !hostname) {
    throw new Error("Only public HTTP and HTTPS media URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Media URLs cannot contain credentials");
  }

  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : await lookupAll(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isProhibitedIpAddress(address))) {
    throw new Error("Media URL resolves to a private or local network");
  }
  return {
    url: parsed.toString(),
    address: addresses[0],
  };
};

export const safeHttpGet = async (
  initialUrl: string,
  {
    headers = {},
    maxRedirects = MAX_SAFE_HTTP_REDIRECTS,
    lookupAll = defaultLookupAll,
    requestFactory,
    timeoutMs = 300000,
  }: {
    headers?: Record<string, string>;
    maxRedirects?: number;
    lookupAll?: LookupAll;
    requestFactory?: RequestFactory;
    timeoutMs?: number;
  } = {},
) => {
  let targetUrl = initialUrl;
  let redirectsLeft = maxRedirects;
  const request = requestFactory || ((url, options, callback) => {
    const client = new URL(url).protocol === "https:" ? https : http;
    return client.get(url, options, callback);
  });

  while (true) {
    const validated = await validateSafeHttpUrl(targetUrl, lookupAll);
    const response = await new Promise<{
      response: IncomingMessage;
      request: ClientRequest;
    }>((resolve, reject) => {
      const socketLookup = (
        _hostname: string,
        _options: object,
        callback: (error: Error | null, address?: string, family?: number) => void,
      ) => callback(null, validated.address.address, validated.address.family);
      const clientRequest = request(validated.url, {
        headers,
        lookup: socketLookup,
      }, (nextResponse) => resolve({ response: nextResponse, request: clientRequest }));
      clientRequest.once("error", reject);
      clientRequest.setTimeout(timeoutMs, () =>
        clientRequest.destroy(new Error("Media download timeout")),
      );
    });

    const location = response.response.headers.location;
    if (![301, 302, 303, 307, 308].includes(response.response.statusCode || 0) || !location) {
      return { ...response, url: validated.url };
    }
    response.response.resume();
    if (redirectsLeft <= 0) throw new Error("Too many redirects");
    targetUrl = new URL(location, validated.url).toString();
    redirectsLeft -= 1;
  }
};
