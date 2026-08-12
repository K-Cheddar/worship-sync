import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  ChatImageInputError,
  buildPendingChatImageKey,
  createChatImageStorage,
  processChatImageBuffer,
  validateChatImageUpload,
} from "./chatImageStorage.js";

const env = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
};

const createFakeS3 = () => {
  const objects = new Map();
  const commands = [];
  return {
    objects,
    commands,
    async send(command) {
      commands.push(command);
      const name = command.constructor.name;
      const input = command.input;
      if (name === "PutObjectCommand") {
        objects.set(input.Key, {
          body: input.Body ? Buffer.from(input.Body) : Buffer.alloc(0),
          contentType: input.ContentType,
          metadata: input.Metadata,
        });
        return {};
      }
      if (name === "HeadObjectCommand") {
        const object = objects.get(input.Key);
        if (!object) {
          const error = new Error("missing");
          error.name = "NoSuchKey";
          throw error;
        }
        return {
          ContentLength: object.body.byteLength,
          ContentType: object.contentType,
          Metadata: object.metadata,
        };
      }
      if (name === "GetObjectCommand") {
        const object = objects.get(input.Key);
        if (!object) {
          const error = new Error("missing");
          error.name = "NoSuchKey";
          throw error;
        }
        return {
          Body: {
            transformToByteArray: async () => object.body,
          },
        };
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(input.Key);
        return {};
      }
      throw new Error(`Unexpected command: ${name}`);
    },
  };
};

test("validates bounded static chat image upload metadata", () => {
  assert.deepEqual(
    validateChatImageUpload(
      {
        fileName: "team/photo.png",
        contentType: "image/png",
        sizeBytes: 1024,
      },
      env,
    ),
    {
      id: undefined,
      fileName: "team-photo.png",
      contentType: "image/png",
      sizeBytes: 1024,
    },
  );
  assert.throws(
    () =>
      validateChatImageUpload(
        {
          fileName: "animation.gif",
          contentType: "image/gif",
          sizeBytes: 1024,
        },
        env,
      ),
    ChatImageInputError,
  );
});

test("rewrites chat images to bounded metadata-free WebP variants", async () => {
  const input = await sharp({
    create: {
      width: 2400,
      height: 1200,
      channels: 3,
      background: "#22d3ee",
    },
  })
    .jpeg()
    .withMetadata({ comment: "private metadata" })
    .toBuffer();
  const processed = await processChatImageBuffer({
    bytes: input,
    expectedContentType: "image/jpeg",
  });

  assert.equal(processed.width, 2048);
  assert.equal(processed.height, 1024);
  assert.equal(processed.thumbnailWidth, 480);
  const metadata = await sharp(processed.full).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
});

test("creates, finalizes, reuses, signs, and removes a private image", async () => {
  const s3 = createFakeS3();
  let signedCommand;
  const imageId = "12345678-1234-4123-8123-123456789abc";
  const storage = createChatImageStorage({
    env,
    s3Client: s3,
    randomId: () => imageId,
    signUrl: async (_client, command) => {
      signedCommand = command;
      return "https://r2.example.test/signed";
    },
  });
  const bytes = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: "#0f172a",
    },
  })
    .png()
    .toBuffer();
  const intent = await storage.createUpload({
    churchId: "church_1",
    actorId: "actor_1",
    upload: {
      fileName: "stage.png",
      contentType: "image/png",
      sizeBytes: bytes.byteLength,
    },
  });
  assert.equal(intent.uploadUrl, "https://r2.example.test/signed");
  assert.equal(signedCommand.constructor.name, "PutObjectCommand");

  const pendingKey = buildPendingChatImageKey({
    churchId: "church_1",
    actorId: "actor_1",
    imageId,
  });
  s3.objects.set(pendingKey, {
    body: bytes,
    contentType: "image/png",
    metadata: undefined,
  });
  const attachment = await storage.completeUpload({
    churchId: "church_1",
    actorId: "actor_1",
    clientMessageId: "client_image_1234",
    upload: intent.imageUpload,
  });
  assert.equal(attachment.type, "image");
  assert.equal(attachment.contentType, "image/webp");
  assert.equal(s3.objects.has(pendingKey), false);
  assert.equal(s3.objects.has(attachment.key), true);
  assert.equal(s3.objects.has(attachment.thumbnailKey), true);

  const retried = await storage.completeUpload({
    churchId: "church_1",
    actorId: "actor_1",
    clientMessageId: "client_image_1234",
    upload: intent.imageUpload,
  });
  assert.deepEqual(retried, attachment);
  await assert.rejects(
    storage.completeUpload({
      churchId: "church_1",
      actorId: "actor_1",
      clientMessageId: "client_different_1234",
      upload: intent.imageUpload,
    }),
    /different message/i,
  );

  const download = await storage.getDownloadUrl({
    churchId: "church_1",
    attachment,
    variant: "thumbnail",
  });
  assert.equal(download.url, "https://r2.example.test/signed");
  assert.equal(signedCommand.constructor.name, "GetObjectCommand");

  await storage.deleteAttachment({ churchId: "church_1", attachment });
  assert.equal(s3.objects.has(attachment.key), false);
  assert.equal(s3.objects.has(attachment.thumbnailKey), false);
});
