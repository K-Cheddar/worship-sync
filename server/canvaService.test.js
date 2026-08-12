import assert from "node:assert/strict";
import test from "node:test";
import { createCanvaService, safeCanvaReturnTo } from "./canvaService.js";

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

const createConnectedService = async ({ designUpdatedAt = 100 } = {}) => {
  const calls = [];
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
        return {
          data: {
            job: {
              id: "export-1",
              status: "success",
              urls: ["https://document-export.canva.com/page-1.png"],
            },
          },
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
    async get(url) {
      calls.push({ method: "get", url });
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
              },
            ],
          },
        };
      }
      if (url.endsWith("/designs/DAF_design_1")) {
        return {
          data: {
            design: {
              title: "Sunday Welcome",
              updated_at: designUpdatedAt,
            },
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
          return {
            asset_id: "asset-1",
            public_id: "worship-sync/canva/church-1/page-1",
            secure_url: "https://res.cloudinary.com/page-1.png",
            resource_type: "image",
            original_filename: "page-1",
            created_at: "2026-08-11T12:00:00Z",
            format: "png",
            width: 1920,
            height: 1080,
          };
        },
      },
    },
    getMuxClient: () => null,
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenEncryptionKey: "a-test-encryption-secret-that-is-not-checked-in",
  });
  const pending = await service.startConnect({
    churchId: "church-1",
    userId: "admin-1",
    returnTo: "/account/integrations",
  });
  const state = new URL(pending.authorizeUrl).searchParams.get("state");
  await service.completeConnect({ state, code: "authorization-code" });
  return { service, pending, calls, uploaded };
};

test("Canva connect uses PKCE and records a church-scoped connection", async () => {
  const { service, pending } = await createConnectedService();
  const authorizeUrl = new URL(pending.authorizeUrl);
  assert.equal(authorizeUrl.origin, "https://www.canva.com");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(authorizeUrl.searchParams.get("scope") || "", /design:content:read/);

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
