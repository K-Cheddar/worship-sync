import assert from "node:assert/strict";
import test from "node:test";
import {
  CHURCH_RESOURCE_MAX_BYTES,
  ChurchResourceInputError,
  buildChurchResourceKey,
  buildPendingChurchResourceKey,
  createChurchResourceStorage,
  validateChurchResourceUpload,
} from "./churchResourceService.js";

const env = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_RESOURCES_BUCKET: "worshipsync-resources",
};

test("ChurchResource validation accepts supported types and Office extension fallback", () => {
  assert.deepEqual(
    validateChurchResourceUpload({ fileName: "guide.docx", contentType: "application/octet-stream", sizeBytes: 10 }, env),
    {
      fileName: "guide.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 10,
      kind: "document",
    },
  );
  assert.equal(
    validateChurchResourceUpload({ fileName: "track.mp3", contentType: "audio/x-mpeg", sizeBytes: 10 }, env).contentType,
    "audio/mpeg",
  );
  assert.throws(
    () => validateChurchResourceUpload({ fileName: "archive.zip", contentType: "application/zip", sizeBytes: 10 }, env),
    ChurchResourceInputError,
  );
  assert.throws(
    () => validateChurchResourceUpload({ fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: CHURCH_RESOURCE_MAX_BYTES + 1 }, env),
    ChurchResourceInputError,
  );
});

test("ChurchResource storage uses the resources bucket, scoped keys, and promotion flow", async () => {
  const commands = [];
  const storage = createChurchResourceStorage({
    env,
    randomId: () => "churchResource_123e4567-e89b-42d3-a456-426614174000",
    now: () => "2026-09-21T00:00:00.000Z",
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 4, ContentType: "application/pdf" };
        }
        return {};
      },
    },
    signUrl: async () => "https://example.test/signed",
  });

  const intent = await storage.createUpload({
    churchId: "church-1",
    upload: { fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 4 },
  });
  assert.equal(intent.resourceUpload.key, buildPendingChurchResourceKey({ churchId: "church-1", resourceId: intent.resourceUpload.id }));
  assert.equal(storage.bucket, "worshipsync-resources");

  const completed = await storage.completeUpload({ churchId: "church-1", upload: intent.resourceUpload });
  assert.equal(completed.key, buildChurchResourceKey({ churchId: "church-1", resourceId: intent.resourceUpload.id }));
  assert.equal(completed.contentType, "application/pdf");
  assert.deepEqual(commands.map((command) => command.constructor.name), ["HeadObjectCommand", "CopyObjectCommand", "DeleteObjectCommand"]);
  assert.equal(commands[1].input.Bucket, "worshipsync-resources");
});

test("ChurchResource completion rejects a client key outside the expected church/file scope", async () => {
  const storage = createChurchResourceStorage({
    env,
    signUrl: async () => "https://example.test/signed",
  });
  await assert.rejects(
    storage.completeUpload({
      churchId: "church-1",
      upload: {
        id: "churchResource_123e4567-e89b-42d3-a456-426614174000",
        key: "churches/another-church/files/file/original",
        fileName: "guide.pdf",
        contentType: "application/pdf",
        sizeBytes: 4,
      },
    }),
    ChurchResourceInputError,
  );
});

test("ChurchResource server upload, signed read, and delete use final ID keys", async () => {
  const commands = [];
  const storage = createChurchResourceStorage({
    env,
    randomId: () => "churchResource_123e4567-e89b-42d3-a456-426614174000",
    s3Client: { send: async (command) => { commands.push(command); return {}; } },
    signUrl: async () => "https://example.test/signed",
  });
  const resource = await storage.uploadFromServer({
    churchId: "church-1",
    upload: { fileName: "track.mp3", contentType: "audio/mpeg" },
    body: Buffer.from([1, 2, 3]),
  });
  assert.equal(resource.kind, "audio");
  assert.equal(commands[0].input.Bucket, "worshipsync-resources");
  const read = await storage.createReadUrl({ churchId: "church-1", resource: { id: resource.id, storage: resource } });
  assert.equal(read.url, "https://example.test/signed");
  await storage.remove({ churchId: "church-1", resource: { id: resource.id, storage: resource } });
  assert.equal(commands.at(-1).constructor.name, "DeleteObjectCommand");
});

