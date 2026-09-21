import assert from "node:assert/strict";
import test from "node:test";
import { createChurchResourceHandlers } from "./churchResourceApi.js";

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return value; },
});

const makeHarness = () => {
  const docs = new Map();
  const commands = [];
  const handlers = createChurchResourceHandlers({
    COLLECTIONS: { churchResources: "churchResources" },
    getDoc: async (_collection, id) => docs.get(id) || null,
    queryDocs: async () => [...docs.values()],
    setDoc: async (_collection, id, value) => { docs.set(id, value); },
    deleteDoc: async (_collection, id) => { docs.delete(id); },
    nowIso: () => "2026-09-21T00:00:00.000Z",
    storage: {
      createUpload: async () => ({ resourceUpload: { id: "churchResource_123e4567-e89b-42d3-a456-426614174000", key: "pending/key", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, kind: "document" }, uploadUrl: "https://example.test/upload", expiresAt: "2026-09-21T00:15:00.000Z" }),
      completeUpload: async () => {
        commands.push("complete");
        return { id: "churchResource_123e4567-e89b-42d3-a456-426614174000", key: "churches/church-1/files/churchResource_123e4567-e89b-42d3-a456-426614174000/original", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, uploadedAt: "2026-09-21T00:00:00.000Z", kind: "document" };
      },
      createReadUrl: async () => ({ url: "https://example.test/read", expiresAt: "2026-09-21T00:15:00.000Z" }),
      remove: async () => { commands.push("remove"); },
      uploadFromServer: async () => ({ id: "churchResource_123e4567-e89b-42d3-a456-426614174000", key: "churches/church-1/files/churchResource_123e4567-e89b-42d3-a456-426614174000/original", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4, uploadedAt: "2026-09-21T00:00:00.000Z", kind: "document" }),
    },
  });
  return { docs, commands, handlers };
};

const request = (churchId, body = {}, extra = {}) => ({
  params: { churchId, resourceId: "churchResource_123e4567-e89b-42d3-a456-426614174000" },
  body,
  query: {},
  appSession: { churchId, userId: "user-1", actorId: "user-1" },
  get: () => "application/pdf",
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
