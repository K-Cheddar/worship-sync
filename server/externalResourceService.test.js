import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
  ExternalResourceError,
  createExternalResourceProxyToken,
  createExternalResourceService,
  validateExternalResourceUrl,
  verifyExternalResourceProxyToken,
} from "./externalResourceService.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

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

const proxyOutput = () => {
  const chunks = [];
  const output = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
  output.status = (status) => { output.statusCode = status; return output; };
  output.json = (value) => { output.body = value; return output; };
  output.setHeader = (name, value) => { output.headers[name.toLowerCase()] = String(value); };
  output.headers = {};
  output.bodyChunks = chunks;
  return output;
};

test("PDF proxy rejects a MIME swap to SVG or HTML after the resolver probe", async (t) => {
  for (const getMime of ["image/svg+xml", "text/html"]) {
    await t.test(getMime, async () => {
      const client = createMockClient((config) => config.method === "HEAD"
        ? response(200, { "content-type": "application/pdf" })
        : response(200, { "content-type": getMime }, Readable.from([Buffer.from("active")])));
      const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
      const descriptor = await service.resolve("https://files.example.test/guide.pdf");
      const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
      const output = proxyOutput();
      await service.handleProxy({ ip: "203.0.113.1", query: { token }, method: "GET", headers: {} }, output);
      assert.equal(output.statusCode, 415);
      assert.equal(Buffer.concat(output.bodyChunks).length, 0);
    });
  }
});

test("PDF proxy preserves a valid PDF response and adds nosniff", async () => {
  const client = createMockClient((config) => config.method === "HEAD"
    ? response(200, { "content-type": "application/pdf" })
    : response(200, { "content-type": "application/pdf", "content-length": "4" }, Readable.from([Buffer.from("%PDF")])));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://files.example.test/guide.pdf");
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  const output = proxyOutput();
  await service.handleProxy({ ip: "203.0.113.1", query: { token }, method: "GET", headers: {} }, output);
  assert.equal(output.statusCode, 200);
  assert.equal(output.headers["content-type"], "application/pdf");
  assert.equal(output.headers["x-content-type-options"], "nosniff");
  assert.equal(Buffer.concat(output.bodyChunks).toString(), "%PDF");
});

test("PDF proxy forwards valid byte ranges without changing the authorized MIME", async () => {
  const client = createMockClient((config) => config.method === "HEAD"
    ? response(200, { "content-type": "application/pdf" })
    : response(206, {
      "content-type": "application/pdf",
      "content-range": "bytes 0-2/100",
      "content-length": "3",
      "accept-ranges": "bytes",
    }, Readable.from([Buffer.from("%PD")])));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://files.example.test/guide.pdf");
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  const output = proxyOutput();
  await service.handleProxy({ ip: "203.0.113.1", query: { token }, method: "GET", headers: { range: "bytes=0-2" } }, output);
  assert.equal(client.calls.at(-1).headers.Range, "bytes=0-2");
  assert.equal(output.statusCode, 206);
  assert.equal(output.headers["content-type"], "application/pdf");
  assert.equal(output.headers["content-range"], "bytes 0-2/100");
  assert.equal(output.headers["x-content-type-options"], "nosniff");
  assert.equal(Buffer.concat(output.bodyChunks).toString(), "%PD");
});

test("proxy keeps authorized image, audio, video, and document MIME classes working", async (t) => {
  for (const [fileName, mimeType] of [
    ["slide.png", "image/png"],
    ["track.mp3", "audio/mpeg"],
    ["clip.mp4", "video/mp4"],
    ["notes.txt", "text/plain"],
    ["guide.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ]) {
    await t.test(mimeType, async () => {
      const client = createMockClient((config) => response(200, { "content-type": mimeType },
        config.method === "GET" ? Readable.from([Buffer.from("file")]) : null));
      const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
      const descriptor = await service.resolve(`https://files.example.test/${fileName}`);
      const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
      const output = proxyOutput();
      await service.handleProxy({ ip: "203.0.113.2", query: { token }, method: "GET", headers: {} }, output);
      assert.equal(output.statusCode, 200);
      assert.equal(output.headers["content-type"], mimeType);
      assert.equal(output.headers["x-content-type-options"], "nosniff");
      assert.equal(Buffer.concat(output.bodyChunks).toString(), "file");
    });
  }
});

test("cached Google exports proxy from the stable URL and follow fresh redirects", async () => {
  const stableUrl = "https://docs.google.com/document/d/doc-id/export?format=pdf";
  let redirectNumber = 0;
  const client = createMockClient((config) => {
    if (config.url === stableUrl) {
      redirectNumber += 1;
      return response(302, { location: `https://download.example.test/export-${redirectNumber}.pdf` });
    }
    assert.equal(config.url, `https://download.example.test/export-${redirectNumber}.pdf`);
    return response(200, { "content-type": "application/pdf" }, Readable.from([Buffer.from("%PDF")]));
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  for (const opening of [1, 2]) {
    const descriptor = await service.resolve("https://docs.google.com/document/d/doc-id/edit");
    assert.equal(descriptor.sourceKind, "file");
    const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
    const verified = verifyExternalResourceProxyToken("secret", token);
    assert.equal(verified.payload.t, stableUrl);
    assert.equal(Date.parse(descriptor.expiresAt), verified.payload.exp);
    const chunks = [];
    const output = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    output.status = (status) => { output.statusCode = status; return output; };
    output.setHeader = () => {};
    await service.handleProxy({ method: "GET", query: { token }, headers: {}, ip: "test" }, output);
    assert.equal(output.statusCode, 200);
    assert.equal(Buffer.concat(chunks).toString(), "%PDF");
    assert.equal(redirectNumber, opening + 1); // One metadata probe, then fresh proxy redirects.
  }
  assert.equal(client.calls.length, 6);
});

test("SharePoint viewer access is non-ranged and reads only a bounded HTML prefix", async () => {
  const originalUrl = "https://church.sharepoint.com/:b:/s/team/Eview?e=token";
  let viewerBody;
  const client = createMockClient((config) => {
    if (config.headers.Range) return response(403, { "content-type": "text/html" }, Readable.from(["Access denied"]));
    viewerBody = Readable.from([Buffer.from("Anonymous viewer" + " ".repeat(5000)), Buffer.from("Access denied")]);
    return response(200, { "content-type": "text/html" }, viewerBody);
  });
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve(originalUrl);
  assert.match(descriptor.reason, /can be viewed in SharePoint/);
  assert.equal(descriptor.previewUrl, null);
  assert.equal(descriptor.originalUrl, originalUrl);
  assert.equal(client.calls[1].headers.Range, undefined);
  assert.equal(viewerBody.destroyed, true);
});

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

test("uses a direct ranged GET for Google Docs, Sheets, and Slides PDF exports", async () => {
  for (const [url, path] of [
    ["https://docs.google.com/document/d/doc-id/edit", "/document/d/doc-id/export?format=pdf"],
    ["https://docs.google.com/spreadsheets/d/sheet-id/edit", "/spreadsheets/d/sheet-id/export?format=pdf"],
    ["https://docs.google.com/presentation/d/slide-id/edit", "/presentation/d/slide-id/export/pdf"],
  ]) {
    const client = createMockClient((config) => response(206, {
      "content-type": "application/pdf",
      "content-range": "bytes 0-0/120",
    }, Readable.from([Buffer.from("%")])));
    const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
    const descriptor = await service.resolve(url);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].method, "GET");
    assert.equal(client.calls[0].headers.Range, "bytes=0-0");
    assert.equal(new URL(client.calls[0].url).pathname + new URL(client.calls[0].url).search, path);
    assert.equal(descriptor.provider, "google-drive");
    assert.equal(descriptor.sourceKind, "file");
    assert.equal(descriptor.mimeType, "application/pdf");
  }
});

test("uses a ranged GET for ordinary Google Drive files", async () => {
  const client = createMockClient(() => response(200, { "content-type": "application/pdf" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://drive.google.com/file/d/ordinary-id/view");
  assert.equal(client.calls[0].method, "GET");
  assert.equal(client.calls[0].headers.Range, "bytes=0-0");
  assert.equal(descriptor.sourceKind, "file");
  assert.equal(descriptor.previewType, "document");
});

test("resolves a downloadable anonymous SharePoint file and preserves its sharing URL", async () => {
  const originalUrl = "https://church.sharepoint.com/:b:/s/team/Efile?e=share-token";
  const client = createMockClient(() => response(206, {
    "content-type": "application/pdf",
    "content-disposition": 'attachment; filename="guide.pdf"',
    "content-range": "bytes 0-0/200",
  }, Readable.from([Buffer.from("%")])));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });

  const descriptor = await service.resolve(originalUrl);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, "GET");
  assert.equal(client.calls[0].headers.Range, "bytes=0-0");
  assert.equal(new URL(client.calls[0].url).searchParams.get("e"), "share-token");
  assert.equal(new URL(client.calls[0].url).searchParams.get("download"), "1");
  assert.equal(descriptor.provider, "sharepoint");
  assert.equal(descriptor.originalUrl, originalUrl);
  assert.equal(descriptor.externalUrl, originalUrl);
  assert.equal(descriptor.mediaType, "document");
  assert.equal(descriptor.previewType, "document");
  assert.equal(descriptor.canPreview, true);
  assert.equal(descriptor.requiresProxy, true);
  assert.equal(descriptor.filename, "guide.pdf");
  assert.match(descriptor.previewUrl, /^\/api\/resources\/proxy\?token=/);
});

test("uses ranged GETs for hosted providers and follows validated file redirects", async (t) => {
  for (const originalUrl of [
    "https://www.dropbox.com/scl/fi/id/guide?dl=0",
    "https://drive.google.com/file/d/guide/view",
    "https://1drv.ms/u/s!guide",
    "https://church.sharepoint.com/:b:/s/team/Eguide?e=share-token",
    "https://app.box.com/s/public-file",
  ]) {
    await t.test(originalUrl, async () => {
      const finalUrl = "https://files.example.test/guide.pdf";
      const client = createMockClient((config) => {
        if (config.url !== finalUrl) return response(302, { location: finalUrl });
        return response(206, { "content-type": "application/pdf", "content-range": "bytes 0-0/200" }, Readable.from([Buffer.from("%") ]));
      });
      const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
      const descriptor = await service.resolve(originalUrl);
      assert.deepEqual(client.calls.map(({ method }) => method), ["GET", "GET"]);
      assert.equal(client.calls[0].headers.Range, "bytes=0-0");
      assert.equal(client.calls[0].headers.Cookie, undefined);
      assert.equal(client.calls[0].headers.Authorization, undefined);
      assert.equal(descriptor.previewType, "document");
      assert.equal(descriptor.requiresProxy, true);
      const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
      assert.equal(verifyExternalResourceProxyToken("secret", token).payload.t, client.calls[0].url);
    });
  }
});

test("falls back to web only after a hosted-file GET confirms HTML", async () => {
  const client = createMockClient(() => response(200, { "content-type": "text/html" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://drive.google.com/file/d/guide/view");
  assert.deepEqual(client.calls.map(({ method }) => method), ["GET"]);
  assert.equal(descriptor.previewType, "web");
  assert.equal(descriptor.requiresProxy, false);
});

test("resolves an anonymous SharePoint share page when its file candidate redirects to bytes", async () => {
  const originalUrl = "https://church.sharepoint.com/:b:/s/team/Efile?e=share-token";
  const finalUrl = "https://church.sharepoint.com/sites/public/guide.pdf?download-token=abc";
  const client = createMockClient((config) => {
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
  assert.deepEqual(client.calls.map(({ method }) => method), ["GET", "GET"]);
  assert.equal(client.calls[0].headers.Range, "bytes=0-0");
  assert.equal(client.calls[0].headers.Cookie, undefined);
  assert.equal(client.calls[0].headers.Authorization, undefined);
  assert.equal(descriptor.originalUrl, originalUrl);
  assert.equal(descriptor.provider, "sharepoint");
  assert.equal(descriptor.mediaType, "document");
  assert.equal(descriptor.previewType, "document");
  assert.equal(descriptor.canPreview, true);
  assert.equal(descriptor.requiresProxy, true);
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  assert.equal(verifyExternalResourceProxyToken("secret", token).payload.t, client.calls[0].url);
});

test("reports SharePoint sign-in only when the original share URL redirects to Microsoft authentication", async () => {
  const client = createMockClient((config) => {
    if (config.url.includes("download=1")) return response(403, { "content-type": "text/html" }, Readable.from([Buffer.from("Access denied")]));
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

test("does not confuse denied file download with anonymous view access", async () => {
  const originalUrl = "https://church.sharepoint.com/:b:/s/team/Eview?e=preserved-token&web=1";
  const candidateUrl = new URL(originalUrl);
  candidateUrl.searchParams.set("download", "1");
  const client = createMockClient((config) => config.url === candidateUrl.toString()
    ? response(403, { "content-type": "text/html" }, Readable.from([Buffer.from("Download is blocked")] ))
    : response(200, { "content-type": "text/html" }, Readable.from([Buffer.from("Anonymous viewer")])));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve(originalUrl);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].url, originalUrl);
  assert.equal(client.calls[0].headers.Range, "bytes=0-0");
  assert.equal(client.calls[1].headers.Range, undefined);
  assert.equal(descriptor.sourceKind, "unavailable");
  assert.equal(descriptor.reason, "This file can be viewed in SharePoint, but SharePoint did not provide downloadable file access for an in-app preview.");
  assert.doesNotMatch(descriptor.reason, /don’t have access/i);
  assert.equal(descriptor.originalUrl, originalUrl);
  assert.equal(descriptor.externalUrl, originalUrl);
  assert.equal(descriptor.previewUrl, null);
  for (const call of client.calls) {
    assert.equal(call.headers.Cookie, undefined);
    assert.equal(call.headers.Authorization, undefined);
  }
  assert.equal(new URL(client.calls[0].url).searchParams.get("e"), "preserved-token");
  assert.equal(new URL(client.calls[0].url).searchParams.get("web"), "1");
});

test("reports SharePoint denial and expired links from the original public share URL", async () => {
  const accessDeniedClient = createMockClient((config) => config.url.includes("download=1")
    ? response(403, { "content-type": "text/html" })
    : response(403, { "content-type": "text/html" }, Readable.from([Buffer.from("Access denied")])));
  const accessDeniedService = createExternalResourceService({ httpClient: accessDeniedClient, lookup: publicLookup, tokenSecret: "secret" });
  const accessDenied = await accessDeniedService.resolve("https://church.sharepoint.com/:b:/s/team/Edenied?e=token");
  assert.equal(accessDenied.canPreview, false);
  assert.equal(accessDenied.reason, "This SharePoint file isn’t publicly accessible.");

  const expiredClient = createMockClient((config) => response(
    config.url.includes("download=1") ? 403 : 200,
    { "content-type": "text/html" },
    Readable.from([Buffer.from(config.url.includes("download=1") ? "Download denied" : "This sharing link has expired")]),
  ));
  const expiredService = createExternalResourceService({ httpClient: expiredClient, lookup: publicLookup, tokenSecret: "secret" });
  const expired = await expiredService.resolve("https://church.sharepoint.com/:b:/s/team/Eexpired?e=token");
  assert.equal(expired.canPreview, false);
  assert.equal(expired.reason, "This SharePoint sharing link may be expired or invalid.");

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

test("returns unknown successful files as file sources without deciding client renderer support", async () => {
  const client = createMockClient(() => response(200, { "content-type": "application/octet-stream" }));
  const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await service.resolve("https://cdn.example.test/download?id=unknown");
  assert.equal(descriptor.sourceKind, "file");
  assert.match(descriptor.previewUrl, /^\/api\/resources\/proxy\?token=/);
  assert.equal(descriptor.canPreview, false); // Deprecated compatibility field only.
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

test("safe agent lookup honors the all-address callback contract and reports address family", async () => {
  const lookupCalls = [];
  const lookup = async (hostname, options) => {
    lookupCalls.push({ hostname, options });
    return [{ address: "93.184.216.34", family: 4 }];
  };
  const client = createMockClient(() => response(200, { "content-type": "image/png" }));
  const service = createExternalResourceService({ httpClient: client, lookup, tokenSecret: "secret" });
  await service.resolve("https://images.example.test/picture.png");
  const safeLookup = client.calls[0].httpsAgent.options.lookup;
  const allResult = await new Promise((resolve, reject) => {
    safeLookup("images.example.test", { all: true }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(allResult, {
    address: [{ address: "93.184.216.34", family: 4 }],
    family: undefined,
  });
  const singleResult = await new Promise((resolve, reject) => {
    safeLookup("images.example.test", { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(singleResult, { address: "93.184.216.34", family: 4 });
  assert.ok(lookupCalls.some(({ options }) => options.all === true && options.verbatim === true));
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
  assert.equal(output.headers["x-content-type-options"], "nosniff");
  assert.equal(Buffer.concat(chunks).toString(), "abc");
});

test("proxy keeps the probed media class across active-content swaps and redirects", async () => {
  const mismatches = [
    { name: "PDF to SVG", url: "https://files.example.test/guide.pdf", probe: "application/pdf", responseType: "image/svg+xml" },
    { name: "PDF to HTML", url: "https://files.example.test/guide.pdf", probe: "application/pdf", responseType: "text/html" },
    { name: "image to HTML", url: "https://files.example.test/photo.png", probe: "image/png", responseType: "text/html" },
    { name: "image to SVG", url: "https://files.example.test/photo.png", probe: "image/png", responseType: "image/svg+xml" },
    { name: "audio to HTML", url: "https://files.example.test/song.mp3", probe: "audio/mpeg", responseType: "text/html" },
    { name: "video to HTML", url: "https://files.example.test/clip.mp4", probe: "video/mp4", responseType: "text/html" },
  ];

  for (const mismatch of mismatches) {
    const client = createMockClient((config) => config.method === "HEAD"
      ? response(200, { "content-type": mismatch.probe })
      : response(200, { "content-type": mismatch.responseType }, Readable.from([Buffer.from("active content")])),
    );
    const service = createExternalResourceService({ httpClient: client, lookup: publicLookup, tokenSecret: "secret" });
    const descriptor = await service.resolve(mismatch.url);
    const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
    const chunks = [];
    const output = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    output.status = (status) => { output.statusCode = status; return output; };
    output.json = (value) => { output.body = value; return output; };
    output.setHeader = (name, value) => { output.headers[name.toLowerCase()] = String(value); };
    output.headers = {};

    await service.handleProxy({ ip: "203.0.113.9", socket: {}, query: { token }, method: "GET", headers: {} }, output);

    assert.equal(output.statusCode, 415, mismatch.name);
    assert.deepEqual(chunks, [], mismatch.name);
  }

  const redirectingClient = createMockClient((config) => {
    if (config.method === "HEAD") return response(200, { "content-type": "image/jpeg" });
    if (config.url === "https://files.example.test/photo.jpg") return response(302, { location: "https://cdn.example.test/not-an-image" });
    return response(200, { "content-type": "text/html" }, Readable.from([Buffer.from("sign-in page")]));
  });
  const redirectingService = createExternalResourceService({ httpClient: redirectingClient, lookup: publicLookup, tokenSecret: "secret" });
  const descriptor = await redirectingService.resolve("https://files.example.test/photo.jpg");
  const token = new URL(descriptor.previewUrl, "https://worshipsync.test").searchParams.get("token");
  const redirectOutput = new Writable({ write(chunk, encoding, callback) { callback(); } });
  redirectOutput.status = (status) => { redirectOutput.statusCode = status; return redirectOutput; };
  redirectOutput.json = (value) => { redirectOutput.body = value; return redirectOutput; };
  redirectOutput.setHeader = () => {};
  await redirectingService.handleProxy({ ip: "203.0.113.9", socket: {}, query: { token }, method: "GET", headers: {} }, redirectOutput);
  assert.equal(redirectOutput.statusCode, 415, "a redirect cannot change the authorized media class");
});
