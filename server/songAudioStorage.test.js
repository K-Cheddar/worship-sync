import assert from "node:assert/strict";
import test from "node:test";
import {
  SONG_AUDIO_MAX_BYTES,
  SongAudioInputError,
  buildPendingSongAudioObjectKey,
  buildSongAudioCopySource,
  buildSongAudioObjectKey,
  createSongAudioStorage,
  isSongAudioKeyForScope,
  validateSongAudioUpload,
} from "./songAudioStorage.js";

test("song audio upload validation only accepts bounded MP3 files", () => {
  assert.deepEqual(
    validateSongAudioUpload({
      fileName: "Reference track.mp3",
      contentType: "audio/mp3",
      sizeBytes: 1234,
    }),
    {
      fileName: "Reference track.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 1234,
    },
  );

  assert.throws(
    () =>
      validateSongAudioUpload({
        fileName: "reference.wav",
        contentType: "audio/wav",
        sizeBytes: 1234,
      }),
    SongAudioInputError,
  );
  assert.throws(
    () =>
      validateSongAudioUpload({
        fileName: "reference.mp3",
        contentType: "audio/mpeg",
        sizeBytes: SONG_AUDIO_MAX_BYTES + 1,
      }),
    SongAudioInputError,
  );
});

test("song audio object keys are church and song scoped", () => {
  const key = buildSongAudioObjectKey({
    churchId: "church/one",
    songId: "song/one",
    audioId: "reference",
  });

  assert.equal(
    key,
    "churches/church%2Fone/songs/song%2Fone/reference.mp3",
  );
  assert.equal(
    isSongAudioKeyForScope({
      key,
      churchId: "church/one",
      songId: "song/one",
      audioId: "reference",
    }),
    true,
  );
  assert.equal(
    isSongAudioKeyForScope({
      key,
      churchId: "church/two",
      songId: "song/one",
      audioId: "reference",
    }),
    false,
  );
});

test("song audio copy sources preserve encoded key segments", () => {
  assert.equal(
    buildSongAudioCopySource(
      "song-audio",
      "pending/churches/demo/songs/Praise%20the%20Lord/audio.mp3",
    ),
    "/song-audio/pending%2Fchurches%2Fdemo%2Fsongs%2FPraise%2520the%2520Lord%2Faudio.mp3",
  );
});

test("replacement upload intents use isolated pending object keys", async () => {
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    signUrl: async () => "https://example.test/upload",
  });

  const first = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "first.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 10,
    },
  });
  const replacement = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "replacement.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 20,
    },
  });

  assert.notEqual(first.audio.id, replacement.audio.id);
  assert.notEqual(first.audio.key, replacement.audio.key);
  assert.equal(
    first.audio.key,
    buildPendingSongAudioObjectKey({
      churchId: "church-1",
      songId: "song-1",
      audioId: first.audio.id,
    }),
  );
});

test("presigned uploads bind the validated content length", async () => {
  let putCommand;
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    signUrl: async (_client, command) => {
      putCommand = command;
      return "https://example.test/upload";
    },
  });

  await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "reference.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 1234,
    },
  });

  assert.equal(putCommand.input.ContentLength, 1234);
});

test("the generated R2 URL signs the content-length header", async () => {
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
  });

  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "reference.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 1234,
    },
  });

  const signedHeaders = new URL(intent.uploadUrl).searchParams.get(
    "X-Amz-SignedHeaders",
  );
  assert.match(signedHeaders, /(?:^|;)content-length(?:;|$)/);
});

test("completing an upload validates, commits, and removes the pending object", async () => {
  const commands = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 3, ContentType: "audio/mpeg" };
        }
        return {};
      },
    },
    signUrl: async () => "https://example.test/upload",
  });
  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "reference.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
    },
  });

  const audio = await storage.completeUpload({
    churchId: "church-1",
    songId: "song-1",
    audio: intent.audio,
  });

  assert.equal(
    audio.key,
    buildSongAudioObjectKey({
      churchId: "church-1",
      songId: "song-1",
      audioId: intent.audio.id,
    }),
  );
  assert.deepEqual(
    commands.map((command) => command.constructor.name),
    ["HeadObjectCommand", "CopyObjectCommand", "DeleteObjectCommand"],
  );
  assert.equal(
    commands[1].input.CopySource,
    buildSongAudioCopySource("song-audio", intent.audio.key),
  );
});

test("song audio quota uses stored bytes and rejects before promotion", async () => {
  const commands = [];
  const quotaCalls = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    quota: {
      reserve: async (input) => {
        quotaCalls.push(input);
        throw Object.assign(new Error("over quota"), { code: "CHURCH_STORAGE_QUOTA_EXCEEDED" });
      },
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 3, ContentType: "audio/mpeg" };
        }
        return {};
      },
    },
    signUrl: async () => "https://example.test/upload",
  });
  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: { fileName: "reference.mp3", contentType: "audio/mpeg", sizeBytes: 3 },
  });
  await assert.rejects(storage.completeUpload({
    churchId: "church-1", songId: "song-1", audio: intent.audio,
  }), { code: "CHURCH_STORAGE_QUOTA_EXCEEDED" });
  assert.equal(quotaCalls[0].amount, 3);
  assert.deepEqual(commands.map((command) => command.constructor.name), ["HeadObjectCommand", "DeleteObjectCommand"]);
});

test("completing a replacement writes a new object and leaves the old key for post-save cleanup", async () => {
  const commands = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 3, ContentType: "audio/mpeg" };
        }
        return {};
      },
    },
    signUrl: async () => "https://example.test/upload",
  });
  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "replacement.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
    },
  });
  const previousAudio = {
    id: "existing-audio",
    key: buildSongAudioObjectKey({
      churchId: "church-1",
      songId: "song-1",
      audioId: "existing-audio",
    }),
  };

  const audio = await storage.completeUpload({
    churchId: "church-1",
    songId: "song-1",
    audio: intent.audio,
    previousAudio,
  });

  assert.equal(audio.id, intent.audio.id);
  assert.equal(audio.key, intent.audio.key.replace("pending/", ""));
  assert.equal(commands[1].input.Key, previousAudio.key);
  assert.equal(commands[2].input.Key, audio.key);
  assert.equal(commands[3].input.Key, intent.audio.key);
});

test("a replacement rejects a previous final object from another song", async () => {
  const commands = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 3, ContentType: "audio/mpeg" };
        }
        return {};
      },
    },
    signUrl: async () => "https://example.test/upload",
  });
  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "replacement.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
    },
  });

  await assert.rejects(
    storage.completeUpload({
      churchId: "church-1",
      songId: "song-1",
      audio: intent.audio,
      previousAudio: {
        id: "existing-audio",
        key: buildSongAudioObjectKey({
          churchId: "church-1",
          songId: "another-song",
          audioId: "existing-audio",
        }),
      },
    }),
    SongAudioInputError,
  );
  assert.deepEqual(
    commands.map((command) => command.constructor.name),
    ["HeadObjectCommand"],
  );
});

test("a copy failure keeps the validated pending upload available for retry", async () => {
  const commands = [];
  const copyError = new Error("The specified key does not exist.");
  copyError.name = "NoSuchKey";
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 3, ContentType: "audio/mpeg" };
        }
        if (command.constructor.name === "CopyObjectCommand") throw copyError;
        return {};
      },
    },
    signUrl: async () => "https://example.test/upload",
  });
  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "Praise to the Lord",
    upload: {
      fileName: "reference.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
    },
  });

  await assert.rejects(
    storage.completeUpload({
      churchId: "church-1",
      songId: "Praise to the Lord",
      audio: intent.audio,
    }),
    copyError,
  );
  assert.deepEqual(
    commands.map((command) => command.constructor.name),
    ["HeadObjectCommand", "CopyObjectCommand"],
  );
});

test("a rejected completed upload is removed from the pending prefix", async () => {
  const commands = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return {
            ContentLength: SONG_AUDIO_MAX_BYTES + 1,
            ContentType: "audio/mpeg",
          };
        }
        return {};
      },
    },
    signUrl: async () => "https://example.test/upload",
  });
  const intent = await storage.createUpload({
    churchId: "church-1",
    songId: "song-1",
    upload: {
      fileName: "reference.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
    },
  });

  await assert.rejects(
    storage.completeUpload({
      churchId: "church-1",
      songId: "song-1",
      audio: intent.audio,
    }),
    SongAudioInputError,
  );
  assert.deepEqual(
    commands.map((command) => command.constructor.name),
    ["HeadObjectCommand", "DeleteObjectCommand"],
  );
  assert.equal(commands[1].input.Key, intent.audio.key);
});

test("the packaged-app fallback stores a validated MP3 under a unique key", async () => {
  const commands = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
      },
    },
  });

  const audio = await storage.uploadFromServer({
    churchId: "church-1",
    songId: "song-1",
    upload: { fileName: "reference.mp3", contentType: "audio/mpeg" },
    body: Buffer.from([1, 2, 3]),
  });

  assert.equal(audio.sizeBytes, 3);
  assert.equal(commands.length, 1);
  assert.equal(
    commands[0].input.Key,
    `churches/church-1/songs/song-1/${audio.id}.mp3`,
  );
  assert.equal(commands[0].input.ContentType, "audio/mpeg");
});

test("the packaged-app fallback writes a new object on replacement", async () => {
  const commands = [];
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") {
          return { ContentLength: 3, ContentType: "audio/mpeg" };
        }
      },
    },
  });
  const previousAudio = {
    id: "existing-audio",
    key: buildSongAudioObjectKey({
      churchId: "church-1",
      songId: "song-1",
      audioId: "existing-audio",
    }),
  };

  const audio = await storage.uploadFromServer({
    churchId: "church-1",
    songId: "song-1",
    upload: { fileName: "replacement.mp3", contentType: "audio/mpeg" },
    body: Buffer.from([1, 2, 3]),
    previousAudio,
  });

  assert.notEqual(audio.id, previousAudio.id);
  assert.notEqual(audio.key, previousAudio.key);
  assert.equal(commands[0].input.Key, previousAudio.key);
  assert.equal(commands[1].input.Key, audio.key);
});

test("a failed quota commit preserves both the old key and the durable replacement for retry", async () => {
  const commands = [];
  let commitAttempts = 0;
  const storage = createSongAudioStorage({
    env: {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "song-audio",
    },
    s3Client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === "HeadObjectCommand") return { ContentLength: 3 };
      },
    },
    quota: {
      reserve: async () => {},
      commitR2: async () => {
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error("commit response lost");
      },
      cancel: async () => assert.fail("ambiguous commit must not cancel its reservation"),
    },
  });
  const previousAudio = {
    id: "existing-audio",
    key: buildSongAudioObjectKey({ churchId: "church-1", songId: "song-1", audioId: "existing-audio" }),
  };
  const input = {
    churchId: "church-1",
    songId: "song-1",
    audioId: "retryable-upload-id",
    upload: { fileName: "replacement.mp3", contentType: "audio/mpeg" },
    body: Buffer.from([1, 2, 3]),
    previousAudio,
  };

  await assert.rejects(storage.uploadFromServer(input), /commit response lost/);
  const audio = await storage.uploadFromServer(input);

  assert.equal(audio.id, "retryable-upload-id");
  assert.equal(commands.filter((command) => command.constructor.name === "DeleteObjectCommand").length, 0);
  assert.equal(commands.filter((command) => command.constructor.name === "PutObjectCommand").length, 2);
  assert.ok(commands.every((command) => command.input.Key !== previousAudio.key || command.constructor.name === "HeadObjectCommand"));
});
