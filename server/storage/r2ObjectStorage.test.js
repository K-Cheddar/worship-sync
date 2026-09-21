import assert from "node:assert/strict";
import test from "node:test";
import {
  buildR2CopySource,
  createR2ObjectStorage,
  R2ObjectStorageNotConfiguredError,
} from "./r2ObjectStorage.js";

const env = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_RESOURCES_BUCKET: "resources-bucket",
};

test("R2 object storage is bucket-configurable and exposes signed upload/read operations", async () => {
  const commands = [];
  const signedCommands = [];
  const storage = createR2ObjectStorage({
    env,
    bucket: env.R2_RESOURCES_BUCKET,
    s3Client: { send: async (command) => { commands.push(command); return { ContentLength: 4 }; } },
    signUrl: async (_client, command) => {
      signedCommands.push(command);
      return "https://example.test/signed";
    },
  });

  const upload = await storage.createSignedUpload({
    key: "pending/churches/church/files/file/original",
    contentType: "application/pdf",
    sizeBytes: 4,
  });
  const read = await storage.createSignedRead({
    key: "churches/church/files/file/original",
    contentType: "application/pdf",
    fileName: "guide.pdf",
    disposition: "attachment",
  });

  assert.equal(storage.bucket, "resources-bucket");
  assert.equal(upload.uploadUrl, "https://example.test/signed");
  assert.equal(signedCommands[0].input.Bucket, "resources-bucket");
  assert.equal(signedCommands[0].input.ContentLength, 4);
  assert.equal(read.url, "https://example.test/signed");

  await storage.head({ key: "churches/church/files/file/original" });
  await storage.put({ key: "churches/church/files/file/original", body: Buffer.from("test"), contentType: "text/plain" });
  await storage.copy({ sourceKey: "pending/source", targetKey: "churches/target", contentType: "text/plain" });
  await storage.delete({ key: "churches/target" });
  assert.deepEqual(
    commands.map((command) => command.constructor.name),
    ["HeadObjectCommand", "PutObjectCommand", "CopyObjectCommand", "DeleteObjectCommand"],
  );
  assert.equal(commands[2].input.Bucket, "resources-bucket");
  assert.equal(commands[2].input.CopySource, buildR2CopySource("resources-bucket", "pending/source"));
});

test("R2 object storage reports configuration failures", () => {
  assert.throws(
    () => createR2ObjectStorage({ env: { R2_BUCKET: "bucket" } }),
    R2ObjectStorageNotConfiguredError,
  );
});
