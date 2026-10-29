import { createServer, request as requestHttp, type Server } from "node:http";
import { createConnection, createServer as createNetServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { VideoDownloadProxy } from "./videoDownloadProxy";

const publicAddress = [{ address: "8.8.8.8", family: 4 as const }];

const waitForSocketConnect = async (socket: Socket) => {
  if (socket.connecting) await once(socket, "connect");
};

const requestThroughProxy = (proxyUrl: string, targetUrl: string) => {
  const proxy = new URL(proxyUrl);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = requestHttp({
      hostname: proxy.hostname,
      port: proxy.port,
      method: "GET",
      path: targetUrl,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.once("error", reject);
    request.end();
  });
};

describe("VideoDownloadProxy network boundary", () => {
  let proxy: VideoDownloadProxy;
  let upstreamServer: Server;

  afterEach(async () => {
    await proxy?.stop();
    await new Promise<void>((resolve) => {
      if (!upstreamServer?.listening) return resolve();
      upstreamServer.close(() => resolve());
    });
  });

  it("forwards allowed public provider traffic and pins it to the validated DNS address", async () => {
    const dnsLookup = jest.fn(async () => publicAddress);
    let pinnedAddress: string | undefined;
    upstreamServer = createServer((request, response) => response.end(`allowed:${request.url}`));
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstreamServer.address() as AddressInfo).port;
    proxy = new VideoDownloadProxy({
      lookupAll: dnsLookup,
      requestHttp: ((rawOptions, callback) => {
        const options = rawOptions as import("node:http").RequestOptions;
        const lookup = options.lookup as (hostname: string, options: object, callback: (error: Error | null, address: string, family: number) => void) => void;
        lookup("www.youtube.com", {}, (error, address) => {
          if (error) throw error;
          pinnedAddress = address;
        });
        return requestHttp(`http://127.0.0.1:${upstreamPort}${options.path}`, {
          method: options.method,
          headers: options.headers,
        }, callback);
      }) as typeof requestHttp,
    });
    await proxy.start();

    await expect(requestThroughProxy(proxy.url, "http://www.youtube.com/watch?v=public")).resolves.toMatchObject({
      status: 200,
      body: "allowed:/watch?v=public",
    });
    expect(dnsLookup).toHaveBeenCalledWith("www.youtube.com", { all: true, verbatim: true });
    expect(pinnedAddress).toBe("8.8.8.8");
  });

  it("rejects disallowed hosts and provider names that resolve to private addresses", async () => {
    const dnsLookup = jest.fn(async (hostname: string) => hostname === "www.youtube.com"
      ? [{ address: "127.0.0.1", family: 4 as const }]
      : publicAddress);
    proxy = new VideoDownloadProxy({ lookupAll: dnsLookup });
    await proxy.start();

    const unsupported = await requestThroughProxy(proxy.url, "http://example.org/secret");
    const privateResolution = await requestThroughProxy(proxy.url, "http://www.youtube.com/private");
    expect(unsupported.status).toBe(403);
    expect(privateResolution.status).toBe(403);
    expect(dnsLookup).toHaveBeenCalledTimes(1);
  });

  it("revalidates a redirected provider hostname before forwarding its next request", async () => {
    const dnsLookup = jest.fn(async (hostname: string) => hostname === "www.youtube.com"
      ? publicAddress
      : [{ address: "10.0.0.4", family: 4 as const }]);
    upstreamServer = createServer((_request, response) => {
      response.writeHead(302, { location: "http://m.youtube.com/private" });
      response.end();
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstreamServer.address() as AddressInfo).port;
    proxy = new VideoDownloadProxy({
      lookupAll: dnsLookup,
      requestHttp: ((rawOptions, callback) => {
        const options = rawOptions as import("node:http").RequestOptions;
        return requestHttp(`http://127.0.0.1:${upstreamPort}${options.path}`, {
        method: options.method,
        headers: options.headers,
        }, callback);
      }) as typeof requestHttp,
    });
    await proxy.start();

    const redirect = await requestThroughProxy(proxy.url, "http://www.youtube.com/redirect");
    expect(redirect.status).toBe(302);
    const redirectedRequest = await requestThroughProxy(proxy.url, "http://m.youtube.com/private");
    expect(redirectedRequest.status).toBe(403);
    expect(dnsLookup.mock.calls.map(([hostname]) => hostname)).toEqual(["www.youtube.com", "m.youtube.com"]);
  });

  it("rejects malformed CONNECT authorities before opening an upstream tunnel", async () => {
    const connectUpstream = jest.fn(() => {
      throw new Error("should not be reached");
    }) as unknown as typeof createConnection;
    proxy = new VideoDownloadProxy({ lookupAll: async () => publicAddress, createConnection: connectUpstream });
    await proxy.start();
    const socket = createConnection(Number(new URL(proxy.url).port), "127.0.0.1");
    let response = "";
    socket.on("data", (chunk) => { response += chunk.toString(); });
    await waitForSocketConnect(socket);
    socket.write("CONNECT www.youtube.com/private HTTP/1.1\r\nHost: www.youtube.com\r\n\r\n");
    await once(socket, "close");
    expect(response).toContain("403 Forbidden");
    expect(connectUpstream).not.toHaveBeenCalled();
  });

  it("pins an allowed HTTPS CONNECT tunnel to the validated public address", async () => {
    const tunnelServer = createNetServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => tunnelServer.listen(0, "127.0.0.1", resolve));
    const tunnelPort = (tunnelServer.address() as AddressInfo).port;
    const connectUpstream = jest.fn(() => createConnection({ host: "127.0.0.1", port: tunnelPort }));
    proxy = new VideoDownloadProxy({ lookupAll: async () => publicAddress, createConnection: connectUpstream });
    await proxy.start();
    const socket = createConnection(Number(new URL(proxy.url).port), "127.0.0.1");
    let response = "";
    const established = new Promise<void>((resolve) => {
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes("200 Connection Established")) resolve();
      });
    });
    await waitForSocketConnect(socket);
    socket.write("CONNECT www.youtube.com:443 HTTP/1.1\r\nHost: www.youtube.com:443\r\n\r\n");
    await established;
    expect(response).toContain("200 Connection Established");
    expect(connectUpstream).toHaveBeenCalledWith({ host: "8.8.8.8", family: 4, port: 443 });
    socket.destroy();
    await proxy.stop();
    await new Promise<void>((resolve) => tunnelServer.close(() => resolve()));
  });

  it("blocks CONNECT when an allowed hostname resolves to loopback", async () => {
    const connectUpstream = jest.fn(() => {
      throw new Error("should not be reached");
    }) as unknown as typeof createConnection;
    proxy = new VideoDownloadProxy({
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
      createConnection: connectUpstream,
    });
    await proxy.start();
    const socket = createConnection(Number(new URL(proxy.url).port), "127.0.0.1");
    let response = "";
    socket.on("data", (chunk) => { response += chunk.toString(); });
    await waitForSocketConnect(socket);
    socket.write("CONNECT www.youtube.com:443 HTTP/1.1\r\nHost: www.youtube.com:443\r\n\r\n");
    await once(socket, "close");
    expect(response).toContain("403 Forbidden");
    expect(connectUpstream).not.toHaveBeenCalled();
  });

  it("does not open a validated upstream after cancellation closes the proxy", async () => {
    let resolveLookup!: (addresses: typeof publicAddress) => void;
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
    const pendingLookup = new Promise<typeof publicAddress>((resolve) => { resolveLookup = resolve; });
    const requestUpstream = jest.fn();
    proxy = new VideoDownloadProxy({
      lookupAll: async () => {
        markLookupStarted();
        return pendingLookup;
      },
      requestHttp: requestUpstream as unknown as typeof requestHttp,
    });
    await proxy.start();
    const request = requestThroughProxy(proxy.url, "http://www.youtube.com/video").catch(() => undefined);
    await lookupStarted;
    await proxy.stop();
    resolveLookup(publicAddress);
    await request;
    expect(requestUpstream).not.toHaveBeenCalled();
  });

  it("enforces the connection cap and closes sockets on shutdown", async () => {
    proxy = new VideoDownloadProxy();
    await proxy.start();
    const port = Number(new URL(proxy.url).port);
    const sockets = Array.from({ length: 13 }, () => createConnection(port, "127.0.0.1"));
    await Promise.all(sockets.slice(0, 12).map(waitForSocketConnect));
    const excess = sockets[12];
    if (!excess.destroyed) await once(excess, "close");
    expect(excess.destroyed).toBe(true);

    const clientClosed = sockets.map((socket) => socket.destroyed ? Promise.resolve() : once(socket, "close"));
    await proxy.stop();
    await Promise.all(clientClosed);
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
  });
});
