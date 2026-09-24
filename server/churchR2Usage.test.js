import assert from "node:assert/strict";
import test from "node:test";
import { createChurchR2UsageLoader } from "./churchR2Usage.js";

const createFirestore = (collections) => ({
  collection(name) {
    return {
      where(field, operator, value) {
        assert.equal(operator, "==");
        return {
          async get() {
            return {
              docs: (collections[name] || [])
                .filter((doc) => doc[field] === value)
                .map((data) => ({ data: () => data })),
            };
          },
        };
      },
    };
  },
});

test("church R2 baseline includes only that church's Resources, song audio, and active chat images", async () => {
  const firestore = createFirestore({
    churchResources: [
      { churchId: "church-a", storage: { sizeBytes: 100 } },
      { churchId: "church-b", storage: { sizeBytes: 900 } },
    ],
    chatMessages: [
      {
        churchId: "church-a",
        attachment: {
          type: "image",
          sizeBytes: 20,
          thumbnailSizeBytes: 5,
          expiresAt: Date.now() + 60_000,
        },
      },
      {
        churchId: "church-a",
        attachment: {
          type: "image",
          sizeBytes: 200,
          thumbnailSizeBytes: 20,
          expiresAt: Date.now() - 1,
        },
      },
      {
        churchId: "church-b",
        attachment: {
          type: "image",
          sizeBytes: 800,
          thumbnailSizeBytes: 80,
          expiresAt: Date.now() + 60_000,
        },
      },
    ],
  });
  let songDatabaseUrl = "";
  const loadR2Usage = createChurchR2UsageLoader({
    getFirestore: () => firestore,
    axios: {
      async get(url) {
        songDatabaseUrl = url;
        return { data: { rows: [{ doc: { songAudio: { sizeBytes: 40 } } }] } };
      },
    },
    env: {
      COUCHDB_HOST: "couch.example.test",
      COUCHDB_USER: "reader",
      COUCHDB_PASSWORD: "secret",
    },
  });

  assert.equal(await loadR2Usage("church-a"), 165);
  assert.match(songDatabaseUrl, /worship-sync-church-a/);
});
