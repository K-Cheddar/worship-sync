import { EventEmitter } from "node:events";
import {
  isProhibitedIpAddress,
  safeHttpGet,
  validateSafeHttpUrl,
} from "./safeHttp";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 as const }];

const makeRequestFactory = (responses: Array<{ statusCode: number; location?: string }>) => {
  const urls: string[] = [];
  const requestFactory = jest.fn((url: string, _options, callback) => {
    urls.push(url);
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: (timeout: number, callback: () => void) => void;
      destroy: (error?: Error) => void;
    };
    request.setTimeout = jest.fn();
    request.destroy = jest.fn((error?: Error) => {
      if (error) request.emit("error", error);
    });
    const next = responses.shift();
    queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        headers: { location?: string };
        resume: () => void;
      };
      response.statusCode = next?.statusCode;
      response.headers = { location: next?.location };
      response.resume = jest.fn();
      callback(response);
    });
    return request;
  });
  return { requestFactory, urls };
};

describe("safe Electron media HTTP", () => {
  it("allows a public HTTP URL and a public redirect", async () => {
    await expect(validateSafeHttpUrl("https://cdn.example.com/start.mp4", publicLookup))
      .resolves.toMatchObject({ address: { address: "93.184.216.34", family: 4 } });

    const { requestFactory, urls } = makeRequestFactory([
      { statusCode: 302, location: "/final.mp4" },
      { statusCode: 200 },
    ]);
    await expect(safeHttpGet("https://cdn.example.com/start.mp4", {
      lookupAll: publicLookup,
      requestFactory,
    })).resolves.toMatchObject({ url: "https://cdn.example.com/final.mp4" });
    expect(urls).toEqual([
      "https://cdn.example.com/start.mp4",
      "https://cdn.example.com/final.mp4",
    ]);
  });

  it.each([
    "127.0.0.1",
    "10.10.10.10",
    "169.254.1.1",
    "[::1]",
    "[fc00::1]",
    "[fe80::1]",
  ])("rejects local or private destination %s", async (host) => {
    await expect(validateSafeHttpUrl(`http://${host}/media.mp4`)).rejects.toThrow(
      /private or local network/,
    );
  });

  it("rejects unsupported schemes and prohibited IP ranges", async () => {
    await expect(validateSafeHttpUrl("file:///etc/passwd")).rejects.toThrow(/HTTP and HTTPS/);
    expect(isProhibitedIpAddress("192.168.1.1")).toBe(true);
    expect(isProhibitedIpAddress("2001:db8::1")).toBe(true);
    expect(isProhibitedIpAddress("93.184.216.34")).toBe(false);
  });

  it("revalidates every redirect hop before opening the next request", async () => {
    const { requestFactory, urls } = makeRequestFactory([
      { statusCode: 302, location: "http://127.0.0.1/private.mp4" },
    ]);
    await expect(safeHttpGet("https://cdn.example.com/start.mp4", {
      lookupAll: publicLookup,
      requestFactory,
    })).rejects.toThrow(/private or local network/);
    expect(urls).toEqual(["https://cdn.example.com/start.mp4"]);
  });

  it("caps redirect depth", async () => {
    const { requestFactory } = makeRequestFactory([
      { statusCode: 302, location: "/one" },
      { statusCode: 302, location: "/two" },
      { statusCode: 302, location: "/three" },
    ]);
    await expect(safeHttpGet("https://cdn.example.com/start.mp4", {
      lookupAll: publicLookup,
      requestFactory,
      maxRedirects: 2,
    })).rejects.toThrow("Too many redirects");
  });
});
