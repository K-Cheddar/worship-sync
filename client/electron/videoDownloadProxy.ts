import { createServer, request as requestHttp } from "node:http";
import { createConnection } from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { validateExtractorRequestUrl } from "./videoDownloaderSecurity";
import type { SafeHttpLookupAll } from "./safeHttp";

const MAX_PROXY_CONNECTIONS = 12;

type VideoDownloadProxyOptions = {
  lookupAll?: SafeHttpLookupAll;
  requestHttp?: typeof requestHttp;
  createConnection?: typeof createConnection;
};

/** A per-job loopback proxy: validates every extractor request and pins DNS. */
export class VideoDownloadProxy {
  private readonly sockets = new Set<Duplex>();
  private server = createServer();
  private port = 0;
  private stopped = true;

  constructor(private readonly options: VideoDownloadProxyOptions = {}) {}

  get url() {
    if (!this.port) throw new Error("The video network proxy is not ready.");
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.server.on("request", (request, response) => {
      void this.forwardHttp(request, response);
    });
    this.server.on("connect", (request, clientSocket, head) => {
      this.track(clientSocket);
      void this.forwardConnect(request.url ?? "", clientSocket, head);
    });
    this.server.on("connection", (socket) => this.track(socket));
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        const address = this.server.address() as AddressInfo;
        this.port = address.port;
        resolve();
      });
    });
  }

  private track(socket: Duplex) {
    if (this.sockets.size >= MAX_PROXY_CONNECTIONS) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }

  private reject(response: import("node:http").ServerResponse, status = 403) {
    response.writeHead(status, { "content-type": "text/plain" });
    response.end("Request blocked by WorshipSync video download policy.");
  }

  private async forwardHttp(
    incoming: import("node:http").IncomingMessage,
    outgoing: import("node:http").ServerResponse,
  ) {
    if (incoming.headers["proxy-authorization"] || !incoming.url) {
      this.reject(outgoing);
      return;
    }
    try {
      const { url, address } = await validateExtractorRequestUrl(incoming.url, this.options.lookupAll);
      if (this.stopped || incoming.destroyed || outgoing.destroyed) return;
      if (url.protocol !== "http:") {
        this.reject(outgoing);
        return;
      }
      if (this.sockets.size > MAX_PROXY_CONNECTIONS) {
        this.reject(outgoing, 429);
        return;
      }
      const upstream = (this.options.requestHttp ?? requestHttp)(
        {
          protocol: "http:",
          hostname: url.hostname,
          port: url.port || 80,
          method: incoming.method,
          path: `${url.pathname}${url.search}`,
          headers: { ...incoming.headers, host: url.host },
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("socket", (socket) => this.track(socket));
      upstream.setTimeout(60_000, () => upstream.destroy(new Error("timeout")));
      upstream.on("error", () => {
        if (!outgoing.headersSent) this.reject(outgoing, 502);
        else outgoing.destroy();
      });
      incoming.pipe(upstream);
      outgoing.on("close", () => upstream.destroy());
      if (outgoing.destroyed) upstream.destroy();
    } catch {
      this.reject(outgoing);
    }
  }

  private async forwardConnect(authority: string, client: Duplex, head: Buffer) {
    try {
      if (!authority || authority.includes("@")) throw new Error("bad target");
      const target = new URL(`https://${authority}`);
      if ((target.port && target.port !== "443") || target.pathname !== "/" || target.search || target.hash) throw new Error("bad authority");
      const { address } = await validateExtractorRequestUrl(target.toString(), this.options.lookupAll);
      if (this.stopped || client.destroyed) return;
      const upstream = (this.options.createConnection ?? createConnection)({
        host: address.address,
        family: address.family,
        port: 443,
      });
      this.track(upstream);
      if (client.destroyed) {
        upstream.destroy();
        return;
      }
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.port = 0;
    if (this.server.listening) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
    this.server = createServer();
  }
}
