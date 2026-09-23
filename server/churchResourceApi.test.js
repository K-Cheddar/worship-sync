import assert from "node:assert/strict";
import test from "node:test";
import { createChurchResourceHandlers } from "./churchResourceApi.js";

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return value; },
});

const makeHarness = ({ quota } = {}) => {
  const docs = new Map();
  const commands = [];
  const storageState = { removeError: null, deleteMetadataError: null };
  const resourceId = "churchResource_123e4567-e89b-42d3-a456-426614174000";
  const handlers = createChurchResourceHandlers({
    COLLECTIONS: { churchResources: "churchResources", servicePlans: "servicePlans" },
    getDoc: async (_collection, id) => docs.get(id) || null,
    queryDocs: async () => [...docs.values()],
    setDoc: async (_collection, id, value) => { docs.set(id, value); },
    deleteDoc: async (_collection, id) => {
      if (storageState.deleteMetadataError) throw storageState.deleteMetadataError;
      docs.delete(id);
    },
    nowIso: () => "2026-09-21T00:00:00.000Z",
    quota,
    storage: {
      createUpload: async () => ({ resourceUpload: { id: "churchResource_123e4567-e89b-42d3-a456-426614174000", key: "pending/key", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, kind: "document" }, uploadUrl: "https://example.test/upload", expiresAt: "2026-09-21T00:15:00.000Z" }),
      completeUpload: async () => {
        commands.push("complete");
        return { id: "churchResource_123e4567-e89b-42d3-a456-426614174000", key: "churches/church-1/files/churchResource_123e4567-e89b-42d3-a456-426614174000/original", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, uploadedAt: "2026-09-21T00:00:00.000Z", kind: "document" };
      },
      createReadUrl: async () => ({ url: "https://example.test/read", expiresAt: "2026-09-21T00:15:00.000Z" }),
      remove: async () => {
        commands.push("remove");
        if (storageState.removeError) throw storageState.removeError;
      },
      uploadFromServer: async () => ({ id: "churchResource_123e4567-e89b-42d3-a456-426614174000", key: "churches/church-1/files/churchResource_123e4567-e89b-42d3-a456-426614174000/original", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, uploadedAt: "2026-09-21T00:00:00.000Z", kind: "document" }),
    },
  });
  return { docs, commands, handlers, storageState, resourceId };
};

test("resource upload admission returns structured quota errors and the church quota endpoint shape", async () => {
  const quotaCalls = [];
  const { handlers } = makeHarness({
    quota: {
      reserve: async (input) => { quotaCalls.push(input); },
      getUsage: async () => ({
        r2: { used: 4, limit: 10, unit: "bytes" },
        cloudinary: { used: 2, limit: 8, unit: "bytes" },
        mux: { used: 1.5, limit: 4, unit: "minutes" },
      }),
    },
  });
  const upload = makeResponse();
  await handlers.createUpload(request("church-1", {
    fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4,
  }), upload);
  assert.equal(upload.statusCode, 200);
  assert.equal(quotaCalls[0].amount, 4);

  const quotaResponse = makeResponse();
  await handlers.storageQuota(request("church-1"), quotaResponse);
  assert.deepEqual(quotaResponse.body.quotas, {
    r2: { used: 4, limit: 10, unit: "bytes" },
    cloudinary: { used: 2, limit: 8, unit: "bytes" },
    mux: { used: 1.5, limit: 4, unit: "minutes" },
  });

  const exceeded = makeHarness({
    quota: {
      reserve: async () => {
        throw Object.assign(new Error("This church has reached its 1 GB file storage limit."), {
          statusCode: 413,
          code: "CHURCH_STORAGE_QUOTA_EXCEEDED",
          provider: "r2Bytes",
        });
      },
    },
  });
  const rejected = makeResponse();
  await exceeded.handlers.createUpload(request("church-1", {
    fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4,
  }), rejected);
  assert.equal(rejected.statusCode, 413);
  assert.equal(rejected.body.code, "CHURCH_STORAGE_QUOTA_EXCEEDED");
  assert.equal(rejected.body.quota, "r2Bytes");
});

const request = (churchId, body = {}, extra = {}) => ({
  params: { churchId, resourceId: "churchResource_123e4567-e89b-42d3-a456-426614174000" },
  body,
  query: {},
  appSession: { churchId, userId: "user-1", actorId: "user-1" },
  get: (header) => header === "content-type" ? "application/pdf" : undefined,
  ...extra,
});

test("ChurchResource API persists metadata without signed URLs and rejects cross-church access", async () => {
  const { docs, handlers } = makeHarness();
  const completeResponse = makeResponse();
  await handlers.completeUpload(
    request("church-1", {
      resourceUpload: {
        id: "churchResource_123e4567-e89b-42d3-a456-426614174000",
        key: "pending/church-1",
        fileName: "guide.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
      },
      name: "Worship Guidelines",
    }),
    completeResponse,
  );
  assert.equal(completeResponse.statusCode, 200);
  assert.equal(completeResponse.body.resource.name, "Worship Guidelines");
  assert.equal("url" in completeResponse.body.resource, false);
  assert.equal(docs.get("churchResource_123e4567-e89b-42d3-a456-426614174000").churchId, "church-1");

  const otherChurchResponse = makeResponse();
  await handlers.get(request("church-2"), otherChurchResponse);
  assert.equal(otherChurchResponse.statusCode, 404);
  assert.equal(otherChurchResponse.body.resource, undefined);
});

test("browser and packaged Electron uploads persist equivalent edited metadata", async () => {
  const browser = makeHarness();
  const browserResponse = makeResponse();
  await browser.handlers.completeUpload(
    request("church-1", {
      resourceUpload: {
        id: browser.resourceId,
        key: "pending/church-1",
        fileName: "guide.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
      },
      name: "Edited guide",
      description: "Used during Sunday service",
    }),
    browserResponse,
  );

  const electron = makeHarness();
  const electronResponse = makeResponse();
  await electron.handlers.uploadFromApp(
    request("church-1", {}, {
      body: Buffer.from("file"),
      get: (header) => ({
        "content-type": "application/pdf",
        "x-resource-name": "Edited guide",
        "x-resource-description": "Used during Sunday service",
      })[header],
    }),
    electronResponse,
  );

  assert.deepEqual(
    electronResponse.body.resource,
    browserResponse.body.resource,
  );
});

test("ChurchResource API update and delete are metadata-scoped to the stored church", async () => {
  const { docs, commands, handlers } = makeHarness();
  docs.set("churchResource_123e4567-e89b-42d3-a456-426614174000", {
    id: "churchResource_123e4567-e89b-42d3-a456-426614174000",
    churchId: "church-1",
    name: "Guide",
    kind: "document",
    storage: { key: "churches/church-1/files/churchResource_123e4567-e89b-42d3-a456-426614174000/original", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, uploadedAt: "2026-09-21T00:00:00.000Z" },
    createdAt: "2026-09-21T00:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-09-21T00:00:00.000Z",
    updatedBy: "user-1",
  });
  const updateResponse = makeResponse();
  await handlers.update(request("church-1", { name: "Updated Guide" }), updateResponse);
  assert.equal(updateResponse.body.resource.name, "Updated Guide");

  const deleteResponse = makeResponse();
  await handlers.remove(request("church-1"), deleteResponse);
  assert.equal(deleteResponse.body.success, true);
  assert.deepEqual(commands, ["remove"]);
  assert.equal(docs.size, 0);
});

test("ChurchResource delete returns a counted conflict before storage or metadata deletion", async () => {
  const { docs, commands, handlers } = makeHarness();
  const resourceId = "churchResource_123e4567-e89b-42d3-a456-426614174000";
  docs.set(resourceId, {
    id: resourceId,
    churchId: "church-1",
    name: "Guide",
    kind: "document",
    storage: {
      key: `churches/church-1/files/${resourceId}/original`,
      fileName: "guide.pdf",
      contentType: "application/pdf",
      sizeBytes: 4,
      uploadedAt: "2026-09-21T00:00:00.000Z",
    },
    createdAt: "2026-09-21T00:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-09-21T00:00:00.000Z",
    updatedBy: "user-1",
  });
  docs.set("plan-1", {
    id: "plan-1",
    churchId: "church-1",
    sections: [{ elements: [{ resources: [{ data: { resourceId } }] }] }],
  });

  const response = makeResponse();
  await handlers.remove(request("church-1"), response);
  assert.equal(response.statusCode, 409);
  assert.match(response.body.error, /used by 1 service plan/i);
  assert.deepEqual(response.body.references, { count: 1 });
  assert.deepEqual(commands, []);
  assert.ok(docs.has(resourceId));
});

test("ChurchResource deletion tombstones failures and resumes safely", async () => {
  const { docs, commands, handlers, storageState, resourceId } = makeHarness();
  docs.set(resourceId, {
    id: resourceId,
    churchId: "church-1",
    name: "Guide",
    kind: "document",
    storage: {
      key: `churches/church-1/files/${resourceId}/original`,
      fileName: "guide.pdf",
      contentType: "application/pdf",
      sizeBytes: 4,
      uploadedAt: "2026-09-21T00:00:00.000Z",
    },
    createdAt: "2026-09-21T00:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-09-21T00:00:00.000Z",
    updatedBy: "user-1",
  });
  storageState.removeError = Object.assign(new Error("R2 unavailable"), { name: "NetworkError" });

  const failed = makeResponse();
  await handlers.remove(request("church-1"), failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(docs.get(resourceId).deletionStatus, "deleting");
  const listedWhileDeleting = makeResponse();
  await handlers.list(request("church-1"), listedWhileDeleting);
  assert.deepEqual(listedWhileDeleting.body.resources, []);

  storageState.removeError = null;
  const retried = makeResponse();
  await handlers.remove(request("church-1"), retried);
  assert.deepEqual(retried.body, { success: true });
  assert.equal(docs.has(resourceId), false);
  assert.equal(commands.filter((command) => command === "remove").length, 2);
});

test("ChurchResource deletion retries after R2 succeeds but metadata removal fails", async () => {
  const { docs, handlers, storageState, resourceId } = makeHarness();
  docs.set(resourceId, {
    id: resourceId,
    churchId: "church-1",
    name: "Guide",
    kind: "document",
    storage: {
      key: `churches/church-1/files/${resourceId}/original`,
      fileName: "guide.pdf",
      contentType: "application/pdf",
      sizeBytes: 4,
      uploadedAt: "2026-09-21T00:00:00.000Z",
    },
    createdAt: "2026-09-21T00:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-09-21T00:00:00.000Z",
    updatedBy: "user-1",
  });
  storageState.deleteMetadataError = new Error("Firestore unavailable");

  const failed = makeResponse();
  await handlers.remove(request("church-1"), failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(docs.get(resourceId).deletionStorageDeletedAt, "2026-09-21T00:00:00.000Z");

  storageState.deleteMetadataError = null;
  const retried = makeResponse();
  await handlers.remove(request("church-1"), retried);
  assert.deepEqual(retried.body, { success: true });
  assert.equal(docs.has(resourceId), false);
});

test("repeated delete of an already absent resource is idempotent", async () => {
  const { handlers } = makeHarness();
  const response = makeResponse();
  await handlers.remove(request("church-1"), response);
  assert.deepEqual(response.body, { success: true });
});

test("ChurchResource API reports a missing resources bucket as a clean 503 without storage commands", async () => {
  let storageFactoryCalls = 0;
  const handlers = createChurchResourceHandlers({
    COLLECTIONS: { churchResources: "churchResources", servicePlans: "servicePlans" },
    getDoc: async () => null,
    queryDocs: async () => [],
    setDoc: async () => {},
    deleteDoc: async () => {},
    nowIso: () => "2026-09-21T00:00:00.000Z",
    storageFactory: () => {
      storageFactoryCalls += 1;
      const error = new Error("Church resource storage is not configured.");
      error.statusCode = 503;
      throw error;
    },
  });
  const response = makeResponse();
  await handlers.createUpload(request("church-1", {
    fileName: "guide.pdf",
    contentType: "application/pdf",
    sizeBytes: 4,
  }), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.success, false);
  assert.match(response.body.error, /could not prepare/i);
  assert.equal(storageFactoryCalls, 1);
});
