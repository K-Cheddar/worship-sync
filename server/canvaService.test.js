import assert from "node:assert/strict";
import test from "node:test";
import {
  createCanvaService,
  normalizeMuxStaticRenditions,
  safeCanvaReturnTo,
} from "./canvaService.js";

test("normalizes current and legacy Mux static rendition responses", () => {
  const files = [
    { name: "highest.mp4", resolution: "highest", status: "ready" },
  ];
  assert.deepEqual(
    normalizeMuxStaticRenditions({ static_renditions: { files } }),
    files,
  );
  assert.deepEqual(
    normalizeMuxStaticRenditions({
      static_renditions: [{ resolution: "highest", status: "ready" }],
    }),
    [{ resolution: "highest", status: "ready" }],
  );
});

test("safeCanvaReturnTo accepts only local application paths", () => {
  assert.equal(
    safeCanvaReturnTo("/account/integrations?source=canva#connection"),
    "/account/integrations?source=canva#connection",
  );

  for (const unsafeValue of [
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "/%2f%2fevil.example",
    "/%5c%5cevil.example",
    "https://evil.example",
    "/malformed%",
  ]) {
    assert.equal(
      safeCanvaReturnTo(unsafeValue),
      "/account/integrations",
      unsafeValue,
    );
  }
});

const createConnectedService = async ({
  designUpdatedAt = 100,
  designEditUrl = "https://www.canva.com/api/design/token/edit",
  exportJobForRequest = () => ({
    id: "export-1",
    status: "success",
    urls: ["https://document-export.canva.com/page-1.png"],
  }),
  uploadResultForUrl = () => ({
    asset_id: "asset-1",
    public_id: "worship-sync/canva/church-1/page-1",
    secure_url: "https://res.cloudinary.com/page-1.png",
    resource_type: "image",
    original_filename: "page-1",
    created_at: "2026-08-11T12:00:00Z",
    format: "png",
    width: 1920,
    height: 1080,
  }),
  muxClient = null,
  publicLinkResponseForUrl = () => null,
  exportStatusForJob = ({ jobId }) => ({
    id: jobId,
    status: "success",
    urls: ["https://document-export.canva.com/page-1.png"],
  }),
  wait = async () => {},
  now = () => Date.now(),
  exportCreationIntervalMs,
  exportDeadlineMs,
  exportConcurrency,
  muxProcessingConcurrency,
  muxProcessingDeadlineMs,
} = {}) => {
  const calls = [];
  let exportRequestCount = 0;
  const exportPollCounts = new Map();
  const httpClient = {
    async post(url, body) {
      calls.push({ method: "post", url, body });
      if (url.endsWith("/oauth/token")) {
        return {
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          },
        };
      }
      if (url.endsWith("/exports")) {
        const job = exportJobForRequest({
          body,
          index: exportRequestCount,
        });
        exportRequestCount += 1;
        return {
          data: { job },
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
    async get(url) {
      calls.push({ method: "get", url });
      const publicLinkResponse = publicLinkResponseForUrl(url);
      if (publicLinkResponse) return publicLinkResponse;
      if (url.endsWith("/users/me/profile")) {
        return { data: { profile: { display_name: "Church Creative" } } };
      }
      if (url.endsWith("/designs")) {
        return {
          data: {
            items: [
              {
                id: "DAF_design_1",
                title: "Sunday Welcome",
                thumbnail: { url: "https://example.test/thumb.png" },
                page_count: 2,
                updated_at: 100,
                urls: {
                  edit_url: "https://www.canva.com/api/design/token/edit",
                  view_url: "https://www.canva.com/api/design/token/view",
                },
              },
            ],
          },
        };
      }
      if (url.endsWith("/designs/DAF_design_1")) {
        return {
          data: {
            design: {
              id: "DAF_design_1",
              title: "Sunday Welcome",
              updated_at: designUpdatedAt,
              page_count: 2,
              urls: {
                edit_url: designEditUrl,
                view_url: "https://www.canva.com/api/design/token/view",
              },
            },
          },
        };
      }
      const exportJobMatch = url.match(/\/exports\/([^/]+)$/);
      if (exportJobMatch) {
        const jobId = decodeURIComponent(exportJobMatch[1]);
        const pollCount = (exportPollCounts.get(jobId) || 0) + 1;
        exportPollCounts.set(jobId, pollCount);
        return {
          data: {
            job: exportStatusForJob({ jobId, pollCount }),
          },
        };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
  };
  const uploaded = [];
  const service = createCanvaService({
    getFirestore: () => null,
    getRealtimeDatabase: () => null,
    getIntegrationsPath: (churchId) => `churches/${churchId}/data/integrations`,
    redirectBaseUrl: "https://worshipsync.test",
    httpClient,
    cloudinaryClient: {
      uploader: {
        async upload(url, options) {
          uploaded.push({ url, options });
          return uploadResultForUrl(url);
        },
      },
    },
    getMuxClient: () => muxClient,
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenEncryptionKey: "a-test-encryption-secret-that-is-not-checked-in",
    now,
    wait,
    ...(exportCreationIntervalMs === undefined
      ? {}
      : { exportCreationIntervalMs }),
    ...(exportDeadlineMs === undefined ? {} : { exportDeadlineMs }),
    ...(exportConcurrency === undefined ? {} : { exportConcurrency }),
    ...(muxProcessingConcurrency === undefined
      ? {}
      : { muxProcessingConcurrency }),
    ...(muxProcessingDeadlineMs === undefined
      ? {}
      : { muxProcessingDeadlineMs }),
  });
  const pending = await service.startConnect({
    churchId: "church-1",
    userId: "admin-1",
    returnTo: "/account/integrations",
  });
  const state = new URL(pending.authorizeUrl).searchParams.get("state");
  await service.completeConnect({ state, code: "authorization-code" });
  return { service, pending, calls, uploaded, httpClient };
};

test("Canva connect uses PKCE and records a church-scoped connection", async () => {
  const { service, pending } = await createConnectedService();
  const authorizeUrl = new URL(pending.authorizeUrl);
  assert.equal(authorizeUrl.origin, "https://www.canva.com");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(
    authorizeUrl.searchParams.get("scope") || "",
    /design:content:read/,
  );

  const status = await service.getStatusForChurch({ churchId: "church-1" });
  assert.equal(status.connected, true);
  assert.equal(status.accountLabel, "Church Creative");

  const connectStatus = await service.getConnectStatus({
    churchId: "church-1",
    connectRequestId: pending.connectRequestId,
    connectRequestSecret: pending.connectRequestSecret,
  });
  assert.equal(connectStatus.status, "completed");
});

test("Canva design browsing normalizes stable design metadata", async () => {
  const { service } = await createConnectedService();
  const designs = await service.listDesigns({ churchId: "church-1" });
  assert.equal(designs.items[0].title, "Sunday Welcome");
  assert.equal(designs.items[0].pageCount, 2);
  assert.equal(
    designs.items[0].editUrl,
    "https://www.canva.com/api/design/token/edit",
  );
});

test("Canva getDesign maps inaccessible designs to a share-with-account message", async () => {
  const { service, httpClient } = await createConnectedService();
  const originalGet = httpClient.get.bind(httpClient);
  httpClient.get = async (url) => {
    if (String(url).includes("/designs/DAF_missing")) {
      const error = new Error("Not found");
      error.response = { status: 404, data: {} };
      throw error;
    }
    return originalGet(url);
  };

  await assert.rejects(
    () =>
      service.getDesign({
        churchId: "church-1",
        designId: "DAF_missing",
      }),
    (error) => {
      assert.match(
        String(error.message),
        /could not find this design.*connected to WorshipSync/i,
      );
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test("Canva loads fresh metadata for a saved design source", async () => {
  const { service } = await createConnectedService({ designUpdatedAt: 101 });
  const design = await service.getDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
  });

  assert.equal(design.id, "DAF_design_1");
  assert.equal(design.updatedAt, 101);
  assert.equal(design.editUrl, "https://www.canva.com/api/design/token/edit");
});

test("Canva rejects untrusted design URLs before returning them to clients", async () => {
  const { service } = await createConnectedService({
    designEditUrl: "https://evil.example/design/token/edit",
  });
  const design = await service.getDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
  });

  assert.equal(design.editUrl, "");
});

test("Canva PNG imports are copied to Cloudinary instead of storing export URLs", async () => {
  const { service, uploaded } = await createConnectedService();
  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "png",
  });

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].url, "https://document-export.canva.com/page-1.png");
  assert.equal(result.assets[0].kind, "image");
  assert.equal(
    result.assets[0].data.secure_url,
    "https://res.cloudinary.com/page-1.png",
  );
  assert.equal(
    result.assets[0].data.canvaImportKey,
    "canva:DAF_design_1:rev:100:png:1",
  );
  assert.deepEqual(result.assets[0].data.canvaSource, {
    designId: "DAF_design_1",
    designTitle: "Sunday Welcome",
    revision: 100,
    format: "png",
    pageNumbers: [1],
  });
});

test("Canva PNG cancellation stops uploads for remaining pages", async () => {
  let cancelled = false;
  const uploaded = [];
  const { service } = await createConnectedService({
    exportJobForRequest: ({ body }) => ({
      id: "export-png-cancelled",
      status: "success",
      urls: body.format.pages.map(
        (pageNumber) => `https://document-export.canva.com/page-${pageNumber}.png`,
      ),
    }),
    uploadResultForUrl: (url) => {
      uploaded.push(url);
      cancelled = true;
      return {
        asset_id: "asset-1",
        public_id: "worship-sync/canva/church-1/page-1",
        secure_url: url,
      };
    },
  });

  await assert.rejects(
    service.importDesign({
      churchId: "church-1",
      designId: "DAF_design_1",
      pages: [1, 2],
      format: "png",
      isCancelled: () => cancelled,
    }),
    /cancelled/i,
  );
  assert.deepEqual(uploaded, ["https://document-export.canva.com/page-1.png"]);
});

test("Canva getDesign explains that public link access does not grant API access on 403", async () => {
  const { service, httpClient } = await createConnectedService();
  const originalGet = httpClient.get.bind(httpClient);
  httpClient.get = async (url) => {
    if (String(url).includes("/designs/DAF_denied")) {
      const error = new Error("Forbidden");
      error.response = { status: 403, data: {} };
      throw error;
    }
    return originalGet(url);
  };

  await assert.rejects(
    () => service.getDesign({ churchId: "church-1", designId: "DAF_denied" }),
    (error) => {
      assert.match(String(error.message), /Anyone with the link.*not enough for Canva Connect/i);
      assert.match(String(error.message), /People with access/i);
      assert.equal(error.statusCode, 403);
      return true;
    },
  );
});

test("Canva resolves an official short link to a validated design id", async () => {
  const { service } = await createConnectedService({
    publicLinkResponseForUrl: (url) =>
      url === "https://canva.link/hy5vwxec3e5yyhg"
        ? {
            status: 302,
            headers: {
              location:
                "https://www.canva.com/design/DAHULw6Qfe4/LoMrIvNK-FvSMmjeOXEBWg/edit",
            },
          }
        : url ===
              "https://www.canva.com/design/DAHULw6Qfe4/LoMrIvNK-FvSMmjeOXEBWg/edit"
          ? { status: 200, headers: {} }
          : null,
  });

  assert.deepEqual(
    await service.resolveDesignLink({
      url: "https://canva.link/hy5vwxec3e5yyhg",
    }),
    { designId: "DAHULw6Qfe4" },
  );
});

test("Canva short-link resolver rejects non-Canva redirects and hosts", async () => {
  const { service } = await createConnectedService({
    publicLinkResponseForUrl: () => ({
      status: 302,
      headers: { location: "https://evil.example/design/DAHULw6Qfe4" },
    }),
  });

  await assert.rejects(
    () =>
      service.resolveDesignLink({ url: "https://canva.link/official-short-code" }),
    (error) => {
      assert.match(String(error.message), /redirects outside Canva/i);
      assert.equal(error.statusCode, 422);
      return true;
    },
  );
  await assert.rejects(
    () => service.resolveDesignLink({ url: "https://evil.example/short-code" }),
    /valid Canva short link/i,
  );
});

test("Canva short-link resolver bounds redirects", async () => {
  const { service } = await createConnectedService({
    publicLinkResponseForUrl: (url) => ({
      status: 302,
      headers: {
        location: `${url}/next`,
      },
    }),
  });

  await assert.rejects(
    () =>
      service.resolveDesignLink({ url: "https://canva.link/official-short-code" }),
    /too many redirects/i,
  );
});

test("Canva imports each selected PNG page with explicit separate-page export", async () => {
  const { service, calls, uploaded } = await createConnectedService({
    exportJobForRequest: ({ body }) => ({
      id: "export-multi",
      status: "success",
      urls: body.format.pages.map(
        (pageNumber) => `https://document-export.canva.com/page-${pageNumber}.png`,
      ),
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2, 3],
    format: "png",
  });

  const exportCall = calls.find(
    ({ method, url }) => method === "post" && url.endsWith("/exports"),
  );
  assert.deepEqual(exportCall.body.format, {
    type: "png",
    pages: [1, 2, 3],
    as_single_image: false,
  });
  assert.equal(uploaded.length, 3);
  assert.deepEqual(
    uploaded.map(({ url }) => url),
    [
      "https://document-export.canva.com/page-1.png",
      "https://document-export.canva.com/page-2.png",
      "https://document-export.canva.com/page-3.png",
    ],
  );
  assert.equal(result.assets.length, 3);
  assert.deepEqual(
    result.assets.map((asset) => asset.data.original_filename),
    [
      "Sunday Welcome - Page 1",
      "Sunday Welcome - Page 2",
      "Sunday Welcome - Page 3",
    ],
  );
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaImportKey),
    [
      "canva:DAF_design_1:rev:100:png:1",
      "canva:DAF_design_1:rev:100:png:2",
      "canva:DAF_design_1:rev:100:png:3",
    ],
  );
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers),
    [[1], [2], [3]],
  );
});

test("Canva preserves non-contiguous selected page identities in PNG imports", async () => {
  const { service } = await createConnectedService({
    exportJobForRequest: ({ body }) => ({
      id: "export-non-contiguous",
      status: "success",
      urls: body.format.pages.map(
        (pageNumber) => `https://document-export.canva.com/page-${pageNumber}.png`,
      ),
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [2, 4, 7],
    format: "png",
  });

  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers),
    [[2], [4], [7]],
  );
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaImportKey),
    [
      "canva:DAF_design_1:rev:100:png:2",
      "canva:DAF_design_1:rev:100:png:4",
      "canva:DAF_design_1:rev:100:png:7",
    ],
  );
});

test("Canva falls back to one PNG export per page when a multi-page result is incomplete", async () => {
  const { service, calls, uploaded } = await createConnectedService({
    exportJobForRequest: ({ body, index }) => ({
      id: `export-${index}`,
      status: "success",
      urls:
        index === 0
          ? ["https://document-export.canva.com/combined.png"]
          : [
              `https://document-export.canva.com/page-${body.format.pages[0]}.png`,
            ],
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2, 3],
    format: "png",
  });

  const exportCalls = calls.filter(
    ({ method, url }) => method === "post" && url.endsWith("/exports"),
  );
  assert.equal(exportCalls.length, 4);
  assert.deepEqual(
    exportCalls.map(({ body }) => body.format),
    [
      { type: "png", pages: [1, 2, 3], as_single_image: false },
      { type: "png", pages: [1], as_single_image: false },
      { type: "png", pages: [2], as_single_image: false },
      { type: "png", pages: [3], as_single_image: false },
    ],
  );
  assert.equal(uploaded.length, 3);
  assert.equal(result.assets.length, 3);
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers),
    [[1], [2], [3]],
  );
});

test("Canva does not upload or return a successful PNG import when fallback export fails", async () => {
  const { service, uploaded } = await createConnectedService({
    exportJobForRequest: ({ body, index }) => ({
      id: `export-${index}`,
      status: "success",
      urls:
        index === 0
          ? ["https://document-export.canva.com/combined.png"]
          : index === 2
            ? []
            : [
                `https://document-export.canva.com/page-${body.format.pages[0]}.png`,
              ],
    }),
  });

  await assert.rejects(
    () =>
      service.importDesign({
        churchId: "church-1",
        designId: "DAF_design_1",
        pages: [1, 2, 3],
        format: "png",
      }),
    (error) => {
      assert.match(String(error.message), /Could not export Canva page 2/i);
      return true;
    },
  );
  assert.equal(uploaded.length, 0);
});

test("Canva imports selected MP4 pages as one combined video by default", async () => {
  const muxInputs = [];
  const muxCreates = [];
  let muxIndex = 0;
  const muxClient = {
    video: {
      assets: {
        async create(options) {
          muxInputs.push(options.inputs[0].url);
          muxCreates.push(options);
          muxIndex += 1;
          return {
            id: `mux-asset-${muxIndex}`,
            status: "ready",
            playback_ids: [{ id: `playback-${muxIndex}` }],
            static_renditions: [{ resolution: "highest", status: "ready" }],
          };
        },
        async retrieve(assetId) {
          return assetId;
        },
      },
    },
  };
  const { service, calls } = await createConnectedService({
    muxClient,
    exportConcurrency: 2,
    exportJobForRequest: ({ body }) => ({
      id: "export-combined-video",
      status: "success",
      urls: [
        `https://document-export.canva.com/video-${body.format.pages.join("-")}.mp4`,
      ],
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2],
    format: "mp4",
  });

  const exportCalls = calls.filter(
    ({ method, url }) => method === "post" && url.endsWith("/exports"),
  );
  assert.equal(exportCalls.length, 1);
  assert.deepEqual(exportCalls[0].body.format.pages, [1, 2]);
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.assets[0].data.canvaSource.pageNumbers, [1, 2]);
  assert.equal(
    result.assets[0].data.canvaImportKey,
    "canva:DAF_design_1:rev:100:mp4:1,2",
  );
  assert.deepEqual(muxInputs, [
    "https://document-export.canva.com/video-1-2.mp4",
  ]);
  assert.deepEqual(muxCreates[0].static_renditions, [
    { resolution: "highest" },
  ]);
});

test("Canva imports selected MP4 pages as separate videos when requested", async () => {
  const muxInputs = [];
  let muxIndex = 0;
  const muxClient = {
    video: {
      assets: {
        async create(options) {
          muxInputs.push(options.inputs[0].url);
          muxIndex += 1;
          return {
            id: `mux-asset-${muxIndex}`,
            status: "ready",
            playback_ids: [{ id: `playback-${muxIndex}` }],
            static_renditions: [{ resolution: "highest", status: "ready" }],
          };
        },
        async retrieve(assetId) {
          return assetId;
        },
      },
    },
  };
  const { service, calls } = await createConnectedService({
    muxClient,
    exportJobForRequest: ({ body, index }) => ({
      id: `export-separate-video-${index}`,
      status: "success",
      urls: [
        `https://document-export.canva.com/video-${body.format.pages[0]}.mp4`,
      ],
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2],
    format: "mp4",
    mp4ImportMode: "separate",
  });

  const exportCalls = calls.filter(
    ({ method, url }) => method === "post" && url.endsWith("/exports"),
  );
  assert.equal(exportCalls.length, 2);
  assert.deepEqual(
    exportCalls.map(({ body }) => body.format.pages),
    [[1], [2]],
  );
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers),
    [[1], [2]],
  );
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaImportKey),
    [
      "canva:DAF_design_1:rev:100:mp4:1",
      "canva:DAF_design_1:rev:100:mp4:2",
    ],
  );
  assert.deepEqual(muxInputs, [
    "https://document-export.canva.com/video-1.mp4",
    "https://document-export.canva.com/video-2.mp4",
  ]);
});

test("Canva succeeds when Mux playback is ready before static rendition", async () => {
  let retrieveCount = 0;
  const muxClient = {
    video: {
      assets: {
        async create(options) {
          assert.deepEqual(options.static_renditions, [
            { resolution: "highest" },
          ]);
          return {
            id: "mux-asset-1",
            status: "processing",
            playback_ids: [],
            static_renditions: {
              files: [
                {
                  name: "highest.mp4",
                  resolution: "highest",
                  status: "preparing",
                },
              ],
            },
          };
        },
        async retrieve() {
          retrieveCount += 1;
          return {
            id: "mux-asset-1",
            status: "ready",
            playback_ids: [{ id: "playback-1" }],
            static_renditions: {
              files: [
                {
                  name: "highest.mp4",
                  resolution: "highest",
                  status: "preparing",
                },
              ],
            },
          };
        },
      },
    },
  };
  const { service } = await createConnectedService({
    muxClient,
    wait: async () => {},
    exportJobForRequest: () => ({
      id: "export-video",
      status: "success",
      urls: ["https://document-export.canva.com/video-1.mp4"],
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "mp4",
  });

  assert.equal(retrieveCount, 1);
  assert.equal(result.assets[0].data.playbackId, "playback-1");
  assert.equal(result.assets[0].data.assetId, "mux-asset-1");
});

test("Canva does not wait for an absent static rendition", async () => {
  const muxClient = {
    video: {
      assets: {
        async create() {
          return {
            id: "mux-asset-without-static",
            status: "ready",
            playback_ids: [{ id: "playback-without-static" }],
          };
        },
        async retrieve() {
          throw new Error("Mux should not be polled after playback is ready");
        },
      },
    },
  };
  const { service } = await createConnectedService({ muxClient });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "mp4",
  });

  assert.equal(result.assets[0].data.playbackId, "playback-without-static");
});

test("Canva rejects an errored Mux asset", async () => {
  const deletedAssets = [];
  const muxClient = {
    video: {
      assets: {
        async create() {
          return {
            id: "mux-asset-errored",
            status: "errored",
            playback_ids: [],
          };
        },
        async retrieve() {
          throw new Error("Mux should not poll an errored asset");
        },
        async delete(assetId) {
          deletedAssets.push(assetId);
        },
      },
    },
  };
  const { service } = await createConnectedService({ muxClient });

  await assert.rejects(
    service.importDesign({
      churchId: "church-1",
      designId: "DAF_design_1",
      pages: [1],
      format: "mp4",
    }),
    /could not process the Canva video/i,
  );
  assert.deepEqual(deletedAssets, ["mux-asset-errored"]);
});

test("combined MP4 cancellation after Mux creation cleans up the asset", async () => {
  let cancelled = false;
  const deletedAssets = [];
  const muxClient = {
    video: {
      assets: {
        async create() {
          return { id: "mux-combined-cancelled", status: "processing", playback_ids: [] };
        },
        async retrieve() {
          throw new Error("retrieve should not run after cancellation");
        },
        async delete(assetId) {
          deletedAssets.push(assetId);
        },
      },
    },
  };
  const { service } = await createConnectedService({
    muxClient,
    wait: async () => {
      cancelled = true;
    },
  });

  await assert.rejects(
    service.importDesign({
      churchId: "church-1",
      designId: "DAF_design_1",
      pages: [1, 2],
      format: "mp4",
      isCancelled: () => cancelled,
    }),
    /cancelled/i,
  );
  assert.deepEqual(deletedAssets, ["mux-combined-cancelled"]);
});

test("combined MP4 processing timeout cleans up the asset", async () => {
  let clock = 0;
  const deletedAssets = [];
  const muxClient = {
    video: {
      assets: {
        async create() {
          return { id: "mux-combined-stuck", status: "processing", playback_ids: [] };
        },
        async retrieve() {
          return {
            id: "mux-combined-stuck",
            status: "processing",
            playback_ids: [],
          };
        },
        async delete(assetId) {
          deletedAssets.push(assetId);
        },
      },
    },
  };
  const { service } = await createConnectedService({
    muxClient,
    muxProcessingDeadlineMs: 1500,
    now: () => clock,
    wait: async () => {
      clock += 1000;
    },
  });

  await assert.rejects(
    service.importDesign({
      churchId: "church-1",
      designId: "DAF_design_1",
      pages: [1, 2],
      format: "mp4",
    }),
    /video processing timed out/i,
  );
  assert.deepEqual(deletedAssets, ["mux-combined-stuck"]);
});

const createReadyMuxClient = (created = []) => ({
  video: {
    assets: {
      async create(options) {
        const page = Number(options.inputs[0].url.match(/video-(\d+)/)?.[1] || 0);
        const asset = {
          id: `mux-${page}`,
          status: "ready",
          playback_ids: [{ id: `playback-${page}` }],
          static_renditions: [{ resolution: "highest", status: "ready" }],
        };
        created.push({ page, url: options.inputs[0].url });
        return asset;
      },
      async retrieve(asset) {
        return asset;
      },
    },
  },
});

test("separate MP4 exports continue while earlier pages process in Mux", async () => {
  const exportPages = [];
  const muxCreatedPages = [];
  const releaseMux = new Map();
  let activeMux = 0;
  let maxActiveMux = 0;
  const muxClient = {
    video: {
      assets: {
        async create(options) {
          const page = Number(options.inputs[0].url.match(/video-(\d+)/)?.[1]);
          muxCreatedPages.push(page);
          activeMux += 1;
          maxActiveMux = Math.max(maxActiveMux, activeMux);
          return {
            id: `mux-${page}`,
            status: "processing",
            playback_ids: [{ id: `playback-${page}` }],
            static_renditions: [{ resolution: "highest", status: "preparing" }],
          };
        },
        async retrieve(assetId) {
          const page = Number(assetId.match(/mux-(\d+)/)?.[1]);
          if (page <= 2) {
            await new Promise((resolve) => releaseMux.set(page, resolve));
          }
          activeMux -= 1;
          return {
            id: assetId,
            playback_ids: [{ id: `playback-${page}` }],
            status: "ready",
            static_renditions: [{ resolution: "highest", status: "ready" }],
          };
        },
        async delete() {},
      },
    },
  };
  const { service } = await createConnectedService({
    muxClient,
    exportConcurrency: 2,
    muxProcessingConcurrency: 2,
    exportJobForRequest: ({ body, index }) => {
      exportPages.push(body.format.pages[0]);
      return {
        id: `export-page-${body.format.pages[0]}-${index}`,
        status: "success",
        urls: [
          `https://document-export.canva.com/video-${body.format.pages[0]}.mp4`,
        ],
      };
    },
    exportStatusForJob: ({ jobId }) => ({
      id: jobId,
      status: "success",
      urls: [
        `https://document-export.canva.com/video-${jobId.match(/page-(\d+)/)?.[1]}.mp4`,
      ],
    }),
  });
  const importPromise = service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    format: "mp4",
    mp4ImportMode: "separate",
  });

  await new Promise((resolve) => {
    const check = () => {
      if (exportPages.includes(3)) resolve();
      else setTimeout(check, 0);
    };
    check();
  });

  assert.deepEqual(muxCreatedPages, [1, 2]);
  assert.ok(activeMux <= 2);
  for (const resolve of releaseMux.values()) resolve();
  const result = await importPromise;
  assert.equal(result.assets.length, 9);
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers[0]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.ok(maxActiveMux <= 2);
});

test("times out stuck Mux pages, marks them failed, and cleans up assets", async () => {
  let clock = 0;
  const deletedAssets = [];
  const progress = [];
  const muxClient = {
    video: {
      assets: {
        async create(options) {
          const page = Number(options.inputs[0].url.match(/video-(\d+)/)?.[1]);
          return {
            id: `mux-stuck-${page}`,
            status: "processing",
            playback_ids: [],
            static_renditions: [{ resolution: "highest", status: "preparing" }],
          };
        },
        async retrieve(assetId) {
          return {
            id: assetId,
            status: "processing",
            static_renditions: [{ resolution: "highest", status: "preparing" }],
          };
        },
        async delete(assetId) {
          deletedAssets.push(assetId);
        },
      },
    },
  };
  const { service } = await createConnectedService({
    muxClient,
    muxProcessingConcurrency: 2,
    muxProcessingDeadlineMs: 1500,
    now: () => clock,
    wait: async () => {
      clock += 1000;
    },
    exportJobForRequest: ({ body }) => ({
      id: `export-page-${body.format.pages[0]}`,
      status: "success",
      urls: [
        `https://document-export.canva.com/video-${body.format.pages[0]}.mp4`,
      ],
    }),
  });

  await assert.rejects(
    service.importDesign({
      churchId: "church-1",
      designId: "DAF_design_1",
      pages: [1, 2, 3],
      format: "mp4",
      mp4ImportMode: "separate",
      onProgress: (event) => progress.push(event),
    }),
    /video processing timed out/i,
  );

  assert.deepEqual(
    progress
      .filter((event) => event.type === "page-progress" && event.status === "error")
      .map((event) => event.page)
      .sort((left, right) => left - right),
    [1, 2, 3],
  );
  assert.deepEqual(deletedAssets.sort(), [
    "mux-stuck-1",
    "mux-stuck-2",
    "mux-stuck-3",
  ]);
});

test("cancellation stops Mux polling and cleans up accepted assets", async () => {
  let cancelled = false;
  let retrieveCount = 0;
  const createdAssets = [];
  const deletedAssets = [];
  const muxClient = {
    video: {
      assets: {
        async create(options) {
          const page = Number(options.inputs[0].url.match(/video-(\d+)/)?.[1]);
          const asset = {
            id: `mux-cancelled-${page}`,
            status: "processing",
            static_renditions: [{ resolution: "highest", status: "preparing" }],
          };
          createdAssets.push(page);
          return asset;
        },
        async retrieve() {
          retrieveCount += 1;
          throw new Error("retrieve should not run after cancellation");
        },
        async delete(assetId) {
          deletedAssets.push(assetId);
        },
      },
    },
  };
  const { service } = await createConnectedService({
    muxClient,
    exportConcurrency: 2,
    muxProcessingConcurrency: 2,
    wait: async () => {
      if (createdAssets.length > 0 && !cancelled) {
        cancelled = true;
      }
    },
    exportJobForRequest: ({ body }) => {
      return {
        id: `export-page-${body.format.pages[0]}`,
        status: "success",
        urls: [
          `https://document-export.canva.com/video-${body.format.pages[0]}.mp4`,
        ],
      };
    },
    exportStatusForJob: ({ jobId }) => ({
      id: jobId,
      status: "success",
      urls: ["https://document-export.canva.com/video-1.mp4"],
    }),
  });

  await assert.rejects(
    service.importDesign({
      churchId: "church-1",
      designId: "DAF_design_1",
      pages: [1, 2, 3, 4],
      format: "mp4",
      mp4ImportMode: "separate",
      isCancelled: () => cancelled,
    }),
    /cancelled/i,
  );

  assert.deepEqual(createdAssets.sort(), [1]);
  assert.equal(retrieveCount, 0);
  assert.deepEqual(deletedAssets.sort(), [
    "mux-cancelled-1",
  ]);
});

test("Canva separate MP4 imports bound active exports and pace creation", async () => {
  const created = [];
  const waitCalls = [];
  let activeExports = 0;
  let maxActiveExports = 0;
  const muxClient = createReadyMuxClient(created);
  const { service, calls } = await createConnectedService({
    muxClient,
    exportConcurrency: 2,
    wait: async (delay) => {
      waitCalls.push(delay);
    },
    exportJobForRequest: ({ body, index }) => {
      activeExports += 1;
      maxActiveExports = Math.max(maxActiveExports, activeExports);
      return {
        id: `export-page-${body.format.pages[0]}-${index}`,
        status: "in_progress",
        urls: [],
      };
    },
    exportStatusForJob: ({ jobId }) => {
      activeExports -= 1;
      return {
        id: jobId,
        status: "success",
        urls: [
          `https://document-export.canva.com/video-${jobId.match(/page-(\d+)/)?.[1]}.mp4`,
        ],
      };
    },
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2, 3, 4, 5],
    format: "mp4",
    mp4ImportMode: "separate",
  });

  const exportCalls = calls.filter(
    ({ method, url }) => method === "post" && url.endsWith("/exports"),
  );
  assert.equal(exportCalls.length, 5);
  assert.ok(maxActiveExports <= 2);
  assert.ok(waitCalls.filter((delay) => delay >= 3000).length >= 4);
  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers[0]),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(created.map(({ page }) => page), [1, 2, 3, 4, 5]);
});

test("Canva export polling backs off and retries a rate-limited job", async () => {
  const waitCalls = [];
  let rateLimited = false;
  const muxClient = createReadyMuxClient();
  const { service, calls } = await createConnectedService({
    muxClient,
    wait: async (delay) => {
      waitCalls.push(delay);
    },
    exportJobForRequest: () => ({
      id: "export-rate-limited",
      status: "in_progress",
      urls: [],
    }),
    exportStatusForJob: ({ jobId, pollCount }) => {
      if (!rateLimited) {
        rateLimited = true;
        const error = new Error("Too many requests");
        error.response = {
          status: 429,
          headers: { "retry-after": "2" },
          data: { code: "too_many_requests" },
        };
        throw error;
      }
      return {
        id: jobId,
        status: pollCount === 2 ? "success" : "in_progress",
        urls: ["https://document-export.canva.com/video-1.mp4"],
      };
    },
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "mp4",
    mp4ImportMode: "separate",
  });

  assert.equal(result.assets.length, 1);
  assert.equal(
    calls.filter(({ method, url }) => method === "post" && url.endsWith("/exports")).length,
    1,
  );
  assert.deepEqual(
    calls.filter(({ method, url }) => method === "get" && url.includes("/exports/"))
      .map(({ url }) => url),
    [
      "https://api.canva.com/rest/v1/exports/export-rate-limited",
      "https://api.canva.com/rest/v1/exports/export-rate-limited",
    ],
  );
  assert.ok(waitCalls.includes(2000));
});

test("Canva export polling uses increasing intervals", async () => {
  const waitCalls = [];
  const muxClient = createReadyMuxClient();
  const { service } = await createConnectedService({
    muxClient,
    wait: async (delay) => {
      waitCalls.push(delay);
    },
    exportJobForRequest: () => ({
      id: "export-backoff",
      status: "in_progress",
      urls: [],
    }),
    exportStatusForJob: ({ jobId, pollCount }) => ({
      id: jobId,
      status: pollCount < 3 ? "in_progress" : "success",
      urls: ["https://document-export.canva.com/video-1.mp4"],
    }),
  });

  await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "mp4",
    mp4ImportMode: "separate",
  });

  assert.deepEqual(waitCalls.slice(0, 3), [1000, 2000, 4000]);
});

test("Canva persistent export rate limits fail at the deadline", async () => {
  let currentTime = 0;
  const muxClient = createReadyMuxClient();
  const { service } = await createConnectedService({
    muxClient,
    now: () => currentTime,
    wait: async (delay) => {
      currentTime += delay;
    },
    exportDeadlineMs: 2500,
    exportJobForRequest: () => ({
      id: "export-persistent-rate-limit",
      status: "in_progress",
      urls: [],
    }),
    exportStatusForJob: () => {
      const error = new Error("Too many requests");
      error.response = {
        status: 429,
        data: { code: "too_many_requests" },
      };
      throw error;
    },
  });

  await assert.rejects(
    () =>
      service.importDesign({
        churchId: "church-1",
        designId: "DAF_design_1",
        pages: [1],
        format: "mp4",
        mp4ImportMode: "separate",
      }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.match(error.message, /temporarily limiting export requests/i);
      return true;
    },
  );
});

test("Canva separate MP4 progress is keyed by page and preserves order", async () => {
  const progress = [];
  const muxClient = createReadyMuxClient();
  const { service } = await createConnectedService({
    muxClient,
    wait: async () => {},
    exportJobForRequest: ({ body }) => ({
      id: `export-page-${body.format.pages[0]}`,
      status: "in_progress",
      urls: [],
    }),
    exportStatusForJob: ({ jobId, pollCount }) => ({
      id: jobId,
      status: jobId.includes("page-3") && pollCount < 2 ? "in_progress" : "success",
      urls: [`https://document-export.canva.com/video-${jobId.match(/page-(\d+)/)?.[1]}.mp4`],
    }),
  });

  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1, 2, 3, 4],
    format: "mp4",
    mp4ImportMode: "separate",
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(
    result.assets.map((asset) => asset.data.canvaSource.pageNumbers[0]),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    progress.filter((event) => event.type === "page-progress" && event.page === 3)
      .map((event) => event.status),
    ["waiting", "exporting", "processing", "ready"],
  );
  assert.equal(progress[0].type, "started");
  assert.equal(progress[0].total, 4);
  assert.equal(progress.at(-1).type, "finalizing");
  assert.equal(progress.filter((event) => event.status === "ready").length, 4);
});

test("Canva skips an imported page only when its design revision is unchanged", async () => {
  const { service, uploaded } = await createConnectedService();
  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "png",
    existingImportKeys: ["canva:DAF_design_1:rev:100:png:1"],
  });

  assert.deepEqual(result.assets, []);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.revision, 100);
  assert.equal(uploaded.length, 0);
});

test("Canva imports a page again after the design revision changes", async () => {
  const { service, uploaded } = await createConnectedService({
    designUpdatedAt: 101,
  });
  const result = await service.importDesign({
    churchId: "church-1",
    designId: "DAF_design_1",
    pages: [1],
    format: "png",
    existingImportKeys: ["canva:DAF_design_1:rev:100:png:1"],
  });

  assert.equal(result.assets.length, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.revision, 101);
  assert.equal(uploaded.length, 1);
  assert.equal(
    result.assets[0].data.canvaImportKey,
    "canva:DAF_design_1:rev:101:png:1",
  );
});

test("Canva refuses connection setup when server credentials are missing", async () => {
  const service = createCanvaService({
    getFirestore: () => null,
    getRealtimeDatabase: () => null,
    getIntegrationsPath: () => "integrations",
    redirectBaseUrl: "https://worshipsync.test",
    httpClient: {},
    clientId: "",
    clientSecret: "",
    tokenEncryptionKey: "",
  });

  await assert.rejects(
    service.startConnect({ churchId: "church-1", userId: "admin-1" }),
    /credentials/i,
  );
});
