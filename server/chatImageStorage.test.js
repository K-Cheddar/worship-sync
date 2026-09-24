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
  R2_BUCKET: "song-audio-bucket",
  R2_RESOURCES_BUCKET: "resources-bucket",
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

test("requires the Resources bucket and never falls back to the SongAudio bucket", () => {
  assert.throws(
    () => createChatImageStorage({ env: { ...env, R2_RESOURCES_BUCKET: "" }, s3Client: createFakeS3() }),
    (error) => error.statusCode === 503 && /R2_RESOURCES_BUCKET/.test(error.message),
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
  const currentTime = Date.now();
  const imageId = "12345678-1234-4123-8123-123456789abc";
  const storage = createChatImageStorage({
    env,
    s3Client: s3,
    randomId: () => imageId,
    now: () => currentTime,
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
  assert.equal(signedCommand.input.Bucket, "resources-bucket");

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
  assert.equal(attachment.key, "chat/churches/church_1/12345678-1234-4123-8123-123456789abc/image.webp");
  assert.equal(attachment.thumbnailKey, "chat/churches/church_1/12345678-1234-4123-8123-123456789abc/thumbnail.webp");
  assert.equal(attachment.expiresAt, currentTime + 30 * 24 * 60 * 60 * 1000);
  assert.ok(s3.commands.filter((command) => command.constructor.name === "PutObjectCommand")
    .every((command) => command.input.Bucket === "resources-bucket"));

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
  assert.equal(signedCommand.input.Bucket, "resources-bucket");

  await storage.deleteAttachment({ churchId: "church_1", attachment });
  assert.equal(s3.objects.has(attachment.key), false);
  assert.equal(s3.objects.has(attachment.thumbnailKey), false);
});

test("reserves and commits actual processed image bytes once across completion retries", async () => {
  const s3 = createFakeS3();
  const quotaCalls = [];
  const quota = {
    async reserve(input) { quotaCalls.push(["reserve", input]); },
    async commitR2(input) { quotaCalls.push(["commit", input]); },
  };
  const imageId = "12345678-1234-4123-8123-123456789abc";
  const storage = createChatImageStorage({
    env,
    s3Client: s3,
    quota,
    randomId: () => imageId,
    now: () => 1000,
    signUrl: async () => "signed",
  });
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "red" } })
    .png().toBuffer();
  const intent = await storage.createUpload({
    churchId: "church-a", actorId: "actor-a",
    upload: { fileName: "photo.png", contentType: "image/png", sizeBytes: bytes.byteLength },
  });
  s3.objects.set(buildPendingChatImageKey({ churchId: "church-a", actorId: "actor-a", imageId }), {
    body: bytes, contentType: "image/png",
  });
  const attachment = await storage.completeUpload({
    churchId: "church-a", actorId: "actor-a", clientMessageId: "client_image_1234", upload: intent.imageUpload,
  });
  const retried = await storage.completeUpload({
    churchId: "church-a", actorId: "actor-a", clientMessageId: "client_image_1234", upload: intent.imageUpload,
  });
  await storage.commitAttachment({ churchId: "church-a", attachment });
  await storage.commitAttachment({ churchId: "church-a", attachment: retried });

  const actualBytes = attachment.sizeBytes + attachment.thumbnailSizeBytes;
  assert.deepEqual(quotaCalls.map(([name]) => name), ["reserve", "reserve", "commit", "commit"]);
  assert.equal(quotaCalls[0][1].amount, actualBytes);
  assert.equal(quotaCalls[1][1].amount, actualBytes);
  assert.equal(quotaCalls[2][1].actualAmount, actualBytes);
  assert.equal(quotaCalls[3][1].actualAmount, actualBytes);
  assert.equal(quotaCalls[2][1].churchId, "church-a");
});

test("expired and missing legacy images never receive signed download URLs", async () => {
  let currentTime = 50_000;
  let signCount = 0;
  const storage = createChatImageStorage({
    env,
    s3Client: createFakeS3(),
    now: () => currentTime,
    signUrl: async () => {
      signCount += 1;
      return "signed";
    },
  });
  const attachment = {
    id: "12345678-1234-4123-8123-123456789abc",
    key: "chat/churches/church_1/12345678-1234-4123-8123-123456789abc/image.webp",
    thumbnailKey: "chat/churches/church_1/12345678-1234-4123-8123-123456789abc/thumbnail.webp",
    expiresAt: currentTime,
  };
  await assert.rejects(
    storage.getDownloadUrl({ churchId: "church_1", attachment, variant: "full" }),
    (error) => error.name === "ChatImageExpiredError",
  );
  await assert.rejects(
    storage.getDownloadUrl({
      churchId: "church_1",
      attachment: { ...attachment, expiresAt: currentTime + 1000 },
      variant: "full",
    }),
    (error) => error.name === "ChatImageExpiredError",
  );
  assert.equal(signCount, 0);
});

test("signed image URLs do not outlive the attachment expiration", async () => {
  const currentTime = 50_000;
  const expiresAt = currentTime + 30_000;
  const imageId = "12345678-1234-4123-8123-123456789abc";
  const churchId = "church_1";
  const s3 = createFakeS3();
  s3.objects.set(`chat/churches/${churchId}/${imageId}/image.webp`, {
    body: Buffer.from("image"),
    contentType: "image/webp",
  });
  let signingOptions;
  const storage = createChatImageStorage({
    env,
    s3Client: s3,
    now: () => currentTime,
    signUrl: async (_client, _command, options) => {
      signingOptions = options;
      return "signed";
    },
  });
  const result = await storage.getDownloadUrl({
    churchId,
    attachment: {
      id: imageId,
      key: `chat/churches/${churchId}/${imageId}/image.webp`,
      expiresAt,
    },
    variant: "full",
  });
  assert.equal(signingOptions.expiresIn, 30);
  assert.equal(result.expiresAt, new Date(expiresAt).toISOString());
});
