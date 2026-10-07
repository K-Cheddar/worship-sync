import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
  ExternalResourceError,
  createSafeLookup,
  createExternalResourceProxyToken,
  createExternalResourceService,
  validateExternalResourceUrl,
  verifyExternalResourceProxyToken,
} from "./externalResourceService.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const callLookup = (lookup, hostname, options) => new Promise((resolve, reject) => {
  lookup(hostname, options, (...args) => {
    if (args[0]) reject(args[0]);
    else resolve(args.slice(1));
  });
});

const response = (status, headers = {}, data = null) => ({ status, headers, data });

const createMockClient = (handler) => {
  const calls = [];
  return {
    calls,
    request: async (config) => {
      calls.push(config);
      return handler(config);
    },
  };
};

test("resolves the first-class providers and uses provider-specific candidates", async () => {
  const client = createMockClient((config) => response(200, { "content-type": "video/mp4" }));
  const service = createExternalResourceService({
    httpClient: client,
    lookup: publicLookup,
    tokenSecret: "test-secret",
  });

  const cases = [
    ["dropbox", "https://www.dropbox.com/scl/fi/id/clip.mp4?dl=0", "raw=1"],
    ["google-drive", "https://drive.google.com/file/d/drive-file/view", "export=download"],
    ["onedrive", "https://1drv.ms/u/s!file", "download=1"],
    ["sharepoint", "https://church.sharepoint.com/:v:/s/team/Evideo", "download=1"],
    ["box", "https://app.box.com/s/public-file", "public-file"],
  ];

  for (const [provider, url, expectedCandidate] of cases) {
    const descriptor = await service.resolve(url);
    assert.equal(descriptor.provider, provider);
    assert.equal(descriptor.previewType, "video");
    assert.equal(descriptor.requiresProxy, true);
    assert.match(client.calls.at(-1).url, new RegExp(expectedCandidate));
  }

  const youtube = await service.resolve("https://youtu.be/abcdefghijk");
  assert.equal(youtube.provider, "youtube");
  assert.equal(youtube.previewType, "youtube");
  assert.equal(youtube.mediaId, "abcdefghijk");
  assert.equal(youtube.requiresProxy, false);
});

test("detects provider media types from metadata for images, audio, and documents", async () => {
  const client = createMockClient((config) => {
    const headers = config.url.includes("drive.google.com")
      ? { "content-type": "application/pdf", "content-disposition": 'inline; filename="guide.pdf"' }
      : config.url.includes("dropbox.com")
        ? { "content-type": "image/png" }
        : { "content-type": "audio/mpeg" };
    return response(200, headers);
  });
  const service = createExternalResourceService({
    httpClient: client,
    lookup: publicLookup,
    tokenSecret: "secret",
  });

  await assert.doesNotReject(async () => {
    const [dropbox, drive, oneDrive] = await Promise.all([
      service.resolve("https://www.dropbox.com/scl/fi/id/photo.png?dl=0"),
      service.resolve("https://drive.google.com/file/d/guide/view"),
      service.resolve("https://1drv.ms/u/s!audio"),
    ]);
    assert.equal(dropbox.previewType, "image");
    assert.equal(drive.previewType, "document");
    assert.equal(drive.filename, "guide.pdf");
    assert.equal(oneDrive.previewType, "audio");
  });
});

test("probes native Google Docs, Sheets, and Slides exports with a streaming GET first", async () => {
  const cases = [
    ["https://docs.google.com/document/d/doc-id/edit", "https://docs.google.com/document/d/doc-id/export?format=pdf"],
    ["https://docs.google.com/spreadsheets/d/sheet-id/edit", "https://docs.google.com/spreadsheets/d/sheet-id/export?format=pdf"],
    ["https://docs.google.com/presentation/d/slides-id/edit", "https://docs.google.com/presentation/d/slides-id/export/pdf"],
  ];
  for (const [originalUrl, candidateUrl] of cases) {
    let responseStream;
    const client = createMockClient((config) => {
      assert.equal(config.method, "GET");
      assert.equal(config.responseType, "stream");
      assert.equal(config.headers.Range, "bytes=0-0");
      responseStream = Readable.from([Buffer.from("%PDF-1.7")]);
      return response(200, { "content-type": "application/pdf", "content-length": "100" }, responseStream);
    });
    const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
    const descriptor = await service.resolve(originalUrl);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].url, candidateUrl);
    assert.equal(descriptor.previewType, "document");
    assert.equal(descriptor.canPreview, true);
    assert.equal(descriptor.requiresProxy, true);
    assert.match(descriptor.previewUrl, /^\/api\/resources\/proxy\?token=/);
    assert.equal(responseStream.destroyed, true);
  }
});

test("follows native Google export redirects through validated requests", async () => {
  const originalUrl = "https://docs.google.com/document/d/doc-id/edit";
  const exportUrl = "https://docs.google.com/document/d/doc-id/export?format=pdf";
  const finalUrl = "https://download.example.test/export.pdf";
  const client = createMockClient((config) => config.url === exportUrl
    ? response(302, { location: finalUrl })
    : response(200, { "content-type": "application/pdf" }, Readable.from([Buffer.from("%PDF")])));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });

  const descriptor = await service.resolve(originalUrl);
  assert.deepEqual(client.calls.map(({ method }) => method), ["GET", "GET"]);
  assert.ok(client.calls.every(({ maxRedirects }) => maxRedirects === 0));
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  assert.equal(verifyExternalResourceProxyToken("secret", token).payload.t, finalUrl);
});

test("rejects unsafe redirects from native Google export endpoints", async () => {
  const exportUrl = "https://docs.google.com/document/d/doc-id/export?format=pdf";
  const client = createMockClient(() => response(302, { location: "http://127.0.0.1/private" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  await assert.rejects(
    () => service.resolve("https://docs.google.com/document/d/doc-id/edit"),
    (error) => error instanceof ExternalResourceError && error.code === "blocked_host",
  );
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].url, exportUrl);
});

test("does not expose native Google HTML, login, error, or non-PDF responses as previews", async (t) => {
  for (const [name, status, contentType] of [
    ["HTML", 200, "text/html"],
    ["login", 401, "text/html"],
    ["blocked", 403, "text/html"],
    ["non-PDF", 200, "application/octet-stream"],
  ]) {
    await t.test(name, async () => {
      const client = createMockClient(() => response(status, { "content-type": contentType }, Readable.from([Buffer.from("response body")])));
      const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
      const descriptor = await service.resolve("https://docs.google.com/document/d/private-id/edit");
      assert.deepEqual(client.calls.map(({ method }) => method), ["GET"]);
      assert.equal(descriptor.canPreview, false);
      assert.equal(descriptor.previewType, "unsupported");
      assert.equal(descriptor.previewUrl, null);
      assert.equal(descriptor.requiresProxy, false);
      assert.match(descriptor.reason, /could not be exported for preview/i);
    });
  }
});

test("logs safe provider probe diagnostics without private sharing URLs", async () => {
  const client = createMockClient(() => {
    const error = new Error("request failed for https://docs.google.com/export?token=private-sharing-token");
    error.name = "AxiosError";
    error.code = "ECONNRESET";
    throw error;
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const priorWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const descriptor = await service.resolve("https://docs.google.com/document/d/private-id/edit?sharing=private-sharing-token");
    assert.equal(descriptor.canPreview, false);
  } finally {
    console.warn = priorWarn;
  }
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "[external-resource] Provider probe failed");
  assert.deepEqual(warnings[0][1], {
    provider: "google-drive",
    stage: "direct_get",
    errorType: "AxiosError",
    code: "ECONNRESET",
  });
  assert.doesNotMatch(JSON.stringify(warnings), /private-sharing-token/);
});

test("ordinary uploaded Google Drive files keep their HEAD-first behavior", async () => {
  const client = createMockClient((config) => response(200, { "content-type": "application/pdf" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://drive.google.com/file/d/uploaded-file/view");
  assert.equal(client.calls[0].method, "HEAD");
  assert.equal(descriptor.previewType, "document");
  assert.equal(descriptor.canPreview, true);
});

test("other hosted providers retain HEAD-first probing", async (t) => {
  for (const url of [
    "https://www.dropbox.com/scl/fi/id/clip.mp4?dl=0",
    "https://1drv.ms/u/s!file",
    "https://app.box.com/s/public-file",
  ]) {
    await t.test(url, async () => {
      const client = createMockClient(() => response(200, { "content-type": "video/mp4" }));
      const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
      await service.resolve(url);
      assert.equal(client.calls[0].method, "HEAD");
      assert.equal(client.calls.length, 1);
    });
  }
});

test("uses conclusive SharePoint HEAD metadata without a GET probe", async () => {
  const originalUrl = "https://church.sharepoint.com/:b:/s/team/Efile?e=share-token";
  const client = createMockClient((config) => response(200, {
    "content-type": "application/pdf",
    "content-disposition": 'attachment; filename="guide.pdf"',
  }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });

  const descriptor = await service.resolve(originalUrl);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, "HEAD");
  assert.equal(new URL(client.calls[0].url).searchParams.get("e"), "share-token");
  assert.equal(new URL(client.calls[0].url).searchParams.get("download"), "1");
  assert.equal(descriptor.provider, "sharepoint");
  assert.equal(descriptor.originalUrl, originalUrl);
  assert.equal(descriptor.mediaType, "document");
  assert.equal(descriptor.previewType, "document");
  assert.equal(descriptor.canPreview, true);
  assert.equal(descriptor.requiresProxy, true);
  assert.equal(descriptor.filename, "guide.pdf");
  assert.match(descriptor.previewUrl, /^\/api\/resources\/proxy\?token=/);
});

test("probes HTML HEAD responses for every hosted-file provider and follows GET redirects", async (t) => {
  for (const originalUrl of [
    "https://www.dropbox.com/scl/fi/id/guide?dl=0",
    "https://drive.google.com/file/d/guide/view",
    "https://1drv.ms/u/s!guide",
    "https://app.box.com/s/public-file",
  ]) {
    await t.test(originalUrl, async () => {
      const finalUrl = "https://files.example.test/guide.pdf";
      const client = createMockClient((config) => {
        if (config.method === "HEAD") return response(200, { "content-type": "text/html" });
        if (config.url !== finalUrl) return response(302, { location: finalUrl });
        return response(206, { "content-type": "application/pdf", "content-range": "bytes 0-0/200" }, Readable.from([Buffer.from("%") ]));
      });
      const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
      const descriptor = await service.resolve(originalUrl);
      assert.deepEqual(client.calls.map(({ method }) => method), ["HEAD", "GET", "GET"]);
      assert.equal(client.calls[1].headers.Range, "bytes=0-0");
      assert.equal(client.calls[1].headers.Cookie, undefined);
      assert.equal(client.calls[1].headers.Authorization, undefined);
      assert.equal(descriptor.previewType, "document");
      assert.equal(descriptor.requiresProxy, true);
      const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
      assert.equal(verifyExternalResourceProxyToken("secret", token).payload.t, finalUrl);
    });
  }
});

test("falls back to web only after a hosted-file GET confirms HTML", async () => {
  const client = createMockClient(() => response(200, { "content-type": "text/html" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://drive.google.com/file/d/guide/view");
  assert.deepEqual(client.calls.map(({ method }) => method), ["HEAD", "GET"]);
  assert.equal(descriptor.previewType, "web");
  assert.equal(descriptor.requiresProxy, false);
});

test("retries inconclusive SharePoint HTML HEAD with a ranged GET and follows public file redirects", async () => {
  const originalUrl = "https://church.sharepoint.com/:b:/s/team/Efile?e=share-token";
  const finalUrl = "https://church.sharepoint.com/sites/public/guide.pdf?download-token=abc";
  const client = createMockClient((config) => {
    if (config.method === "HEAD") return response(200, { "content-type": "text/html" });
    if (config.url === new URL(originalUrl).toString().replace("?e=share-token", "?e=share-token&download=1")) {
      return response(302, { location: finalUrl });
    }
    return response(206, {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="guide.pdf"',
      "content-range": "bytes 0-0/200",
    }, Readable.from([Buffer.from("%")]));
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });

  const descriptor = await service.resolve(originalUrl);
  assert.deepEqual(client.calls.map(({ method }) => method), ["HEAD", "GET", "GET"]);
  assert.equal(client.calls[1].headers.Range, "bytes=0-0");
  assert.equal(client.calls[1].headers.Cookie, undefined);
  assert.equal(client.calls[1].headers.Authorization, undefined);
  assert.equal(descriptor.originalUrl, originalUrl);
  assert.equal(descriptor.provider, "sharepoint");
  assert.equal(descriptor.mediaType, "document");
  assert.equal(descriptor.previewType, "document");
  assert.equal(descriptor.canPreview, true);
  assert.equal(descriptor.requiresProxy, true);
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  assert.equal(verifyExternalResourceProxyToken("secret", token).payload.t, finalUrl);
});

test("returns a sign-in reason when a SharePoint share redirects to Microsoft authentication", async () => {
  const client = createMockClient((config) => {
    if (config.method === "HEAD") return response(200, { "content-type": "text/html" });
    if (config.url.includes("church.sharepoint.com")) {
      return response(302, { location: "https://login.microsoftonline.com/common/oauth2/authorize" });
    }
    return response(200, { "content-type": "text/html" }, Readable.from([Buffer.from("login") ]));
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://church.sharepoint.com/:b:/s/team/Eprivate?e=private-token");

  assert.equal(descriptor.provider, "sharepoint");
  assert.equal(descriptor.canPreview, false);
  assert.equal(descriptor.previewType, "unsupported");
  assert.equal(descriptor.previewUrl, null);
  assert.equal(descriptor.reason, "This SharePoint link requires sign-in.");
});

test("returns useful reasons for SharePoint access denied, expired links, and unresolved HTML", async () => {
  const accessDeniedClient = createMockClient(() => response(403, { "content-type": "text/html" }));
  const accessDeniedService = createExternalResourceService({ httpClient: accessDeniedClient, lookup: publicLookup, tokenSecret: "secret" });
  const accessDenied = await accessDeniedService.resolve("https://church.sharepoint.com/:b:/s/team/Edenied?e=token");
  assert.equal(accessDenied.canPreview, false);
  assert.equal(accessDenied.reason, "You don’t have access to this SharePoint file.");

  const expiredClient = createMockClient((config) => response(
    200,
    { "content-type": "text/html" },
    config.method === "GET" ? Readable.from([Buffer.from("This sharing link has expired")]) : null,
  ));
  const expiredService = createExternalResourceService({ httpClient: expiredClient, lookup: publicLookup, tokenSecret: "secret" });
  const expired = await expiredService.resolve("https://church.sharepoint.com/:b:/s/team/Eexpired?e=token");
  assert.equal(expired.canPreview, false);
  assert.equal(expired.reason, "This SharePoint sharing link may be expired or invalid.");

  const htmlClient = createMockClient(() => response(200, { "content-type": "text/html" }));
  const htmlService = createExternalResourceService({ httpClient: htmlClient, lookup: publicLookup, tokenSecret: "secret" });
  const html = await htmlService.resolve("https://church.sharepoint.com/:f:/s/team/Efolder?e=token");
  assert.equal(html.canPreview, false);
  assert.equal(html.previewType, "unsupported");
  assert.equal(html.reason, "The SharePoint link did not resolve to a downloadable file.");
});

test("returns an external-only descriptor for private or inaccessible provider links", async () => {
  const client = createMockClient(() => response(403, { "content-type": "text/html" }));
  const service = createExternalResourceService({
    httpClient: client,
    lookup: publicLookup,
    tokenSecret: "secret",
  });

  const descriptor = await service.resolve("https://app.box.com/s/private-file");
  assert.equal(descriptor.provider, "box");
  assert.equal(descriptor.canPreview, false);
  assert.equal(descriptor.previewType, "unsupported");
  assert.equal(descriptor.previewUrl, null);
  assert.match(descriptor.reason, /Box/);
});

test("detects direct media and documents from HTTP metadata before URL extensions", async () => {
  const mimeByUrl = new Map([
    ["https://files.example.test/image", "image/png"],
    ["https://files.example.test/audio", "audio/mpeg"],
    ["https://files.example.test/video", "video/mp4"],
    ["https://files.example.test/document", "application/pdf"],
    ["https://files.example.test/page", "text/html"],
    ["https://files.example.test/filename.bin", "application/octet-stream"],
  ]);
  const client = createMockClient((config) => response(200, {
    "content-type": mimeByUrl.get(config.url),
    "content-disposition": config.url.endsWith("filename.bin") ? 'attachment; filename="notes.pdf"' : "",
  }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });

  assert.equal((await service.resolve("https://files.example.test/image")).mediaType, "image");
  assert.equal((await service.resolve("https://files.example.test/audio")).mediaType, "audio");
  assert.equal((await service.resolve("https://files.example.test/video")).mediaType, "video");
  assert.equal((await service.resolve("https://files.example.test/document")).mediaType, "document");
  const page = await service.resolve("https://files.example.test/page");
  assert.equal(page.previewType, "web");
  assert.equal(page.requiresProxy, false);
  assert.equal(page.previewUrl, "https://files.example.test/page");
  assert.equal((await service.resolve("https://files.example.test/filename.bin")).filename, "notes.pdf");
});

test("deduplicates concurrent metadata requests and caches only metadata, not proxy tokens", async () => {
  let calls = 0;
  const client = createMockClient(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return response(200, { "content-type": "video/mp4" });
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });

  const [first, second] = await Promise.all([
    service.resolve("https://files.example.test/clip.mp4"),
    service.resolve("https://files.example.test/clip.mp4"),
  ]);
  assert.equal(calls, 1);
  assert.notEqual(first.previewUrl, second.previewUrl);
  assert.equal(new URL(first.previewUrl, "https://worshipsync.test").searchParams.has("token"), true);
});

test("rejects unsafe schemes, local hosts, private addresses, and unsafe redirects", async () => {
  await assert.rejects(
    () => validateExternalResourceUrl("file:///etc/passwd", { lookup: publicLookup }),
    (error) => error.code === "unsafe_url",
  );
  await assert.rejects(
    () => validateExternalResourceUrl("http://127.0.0.1/file", { lookup: publicLookup }),
    (error) => error.code === "blocked_host",
  );
  await assert.rejects(
    () => validateExternalResourceUrl("http://metadata.google.internal/file", { lookup: publicLookup }),
    (error) => error.code === "blocked_host",
  );
  await assert.rejects(
    () => validateExternalResourceUrl("http://[fc00::1]/file", { lookup: publicLookup }),
    (error) => error.code === "blocked_host",
  );
  await assert.rejects(
    () => validateExternalResourceUrl("http://[fe80::1]/file", { lookup: publicLookup }),
    (error) => error.code === "blocked_host",
  );
  await assert.rejects(
    () => validateExternalResourceUrl("http://[2001:db8::1]/file", { lookup: publicLookup }),
    (error) => error.code === "blocked_host",
  );
  await assert.rejects(
    () => validateExternalResourceUrl("https://public.example.test/file", { lookup: async () => [{ address: "192.168.1.3", family: 4 }] }),
    (error) => error.code === "blocked_host",
  );

  const client = createMockClient((config) => config.url.includes("public.example")
    ? response(302, { location: "http://127.0.0.1/private" })
    : response(200, { "content-type": "video/mp4" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  await assert.rejects(() => service.resolve("https://public.example.test/file"), ExternalResourceError);
});

test("safe DNS lookup follows Node's all and single-address callback contracts", async () => {
  const safeLookup = createSafeLookup(async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);

  assert.deepEqual(await callLookup(safeLookup, "public.example.test", { all: true }), [[
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]]);
  assert.deepEqual(await callLookup(safeLookup, "public.example.test", { all: false }), ["93.184.216.34", 4]);
  assert.deepEqual(await callLookup(safeLookup, "public.example.test", {}), ["93.184.216.34", 4]);
});

test("safe DNS lookup selects only the requested address family", async () => {
  const safeLookup = createSafeLookup(async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);

  assert.deepEqual(await callLookup(safeLookup, "public.example.test", { family: 4 }), ["93.184.216.34", 4]);
  assert.deepEqual(await callLookup(safeLookup, "public.example.test", { family: 6 }), ["2606:2800:220:1:248:1893:25c8:1946", 6]);
  await assert.rejects(
    () => callLookup(safeLookup, "public.example.test", { family: 5 }),
    (error) => error.code === "ENOTFOUND" && error.hostname === "public.example.test",
  );
});

test("safe DNS lookup rejects blocked records, including mixed public and blocked results", async () => {
  for (const records of [
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ],
  ]) {
    const safeLookup = createSafeLookup(async () => records);
    await assert.rejects(
      () => callLookup(safeLookup, "public.example.test", { all: true }),
      (error) => error.code === "blocked_host",
    );
  }
});

test("proxy tokens are target-bound, signed, and expire", () => {
  const token = createExternalResourceProxyToken("secret", { t: "https://files.example.test/clip.mp4" }, 2_000);
  assert.equal(verifyExternalResourceProxyToken("secret", token, 1_000).valid, true);
  assert.equal(verifyExternalResourceProxyToken("secret", token, 2_000).reason, "expired");
  assert.equal(verifyExternalResourceProxyToken("wrong", token, 1_000).reason, "signature");
  const [body, signature] = token.split(".");
  assert.equal(verifyExternalResourceProxyToken("secret", `${body}x.${signature}`, 1_000).valid, false);
});

test("proxy forwards one range and streams safe response headers without buffering", async () => {
  const client = createMockClient((config) => {
    if (config.method === "HEAD") return response(200, { "content-type": "video/mp4" });
    return response(
      206,
      {
        "content-type": "video/mp4",
        "content-range": "bytes 0-2/3",
        "content-length": "3",
        "accept-ranges": "bytes",
      },
      Readable.from([Buffer.from("abc")]),
    );
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://files.example.test/clip.mp4");
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  const chunks = [];
  const output = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
  output.status = (status) => { output.statusCode = status; return output; };
  output.json = (value) => { output.body = value; return output; };
  output.setHeader = (name, value) => { output.headers[name.toLowerCase()] = String(value); };
  output.headers = {};
  const req = {
    ip: "203.0.113.9",
    socket: {},
    query: { token },
    method: "GET",
    headers: { range: "bytes=0-2" },
  };
  await service.handleProxy(req, output);
  assert.equal(client.calls.at(-1).headers.Range, "bytes=0-2");
  assert.equal(client.calls.at(-1).headers.Cookie, undefined);
  assert.equal(client.calls.at(-1).headers.Authorization, undefined);
  assert.equal(output.statusCode, 206);
  assert.equal(output.headers["content-range"], "bytes 0-2/3");
  assert.equal(Buffer.concat(chunks).toString(), "abc");
});
