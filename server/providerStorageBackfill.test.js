import assert from "node:assert/strict";
import test from "node:test";
import { createProviderStorageBackfill } from "./providerStorageBackfill.js";

const image = (id = "image-1") => ({
  id: "media-image",
  type: "image",
  source: "cloudinary",
  publicId: id,
});
const video = (id = "mux-1") => ({
  id: "media-video",
  type: "video",
  source: "mux",
  muxAssetId: id,
});

const createHarness = ({ libraries, cloudAsset, muxAsset } = {}) => {
  const records = new Map();
  const owners = new Map();
  const ready = new Set();
  const contexts = [];
  const passthroughs = [];
  const cloudState = { ...(cloudAsset || { public_id: "image-1", bytes: 120 }) };
  const muxState = { ...(muxAsset || { id: "mux-1", duration: 120, status: "ready", meta: {} }) };
  const quota = {
    listProviderAssets: async ({ churchId }) => [...owners.values()].filter((row) => row.churchId === churchId),
    getProviderAssetOwner: async ({ provider, assetId }) => owners.get(`${provider}:${assetId}`) || null,
    recordProviderAsset: async (row) => {
      const key = `${row.provider}:${row.assetId}`;
      const existing = owners.get(key);
      if (existing && existing.churchId !== row.churchId) throw new Error("owner conflict");
      records.set(key, row.amount);
      owners.set(key, { ...row });
    },
    markProviderUsageReady: async ({ churchId }) => ready.add(churchId),
    markProviderUsageNotReady: async ({ churchId }) => ready.delete(churchId),
  };
  const service = createProviderStorageBackfill({
    listChurches: async () => Object.keys(libraries || {}).map((id) => ({ id })),
    readMediaLibrary: async (churchId) => libraries[churchId],
    cloudinaryClient: {
      api: { resource: async () => cloudState },
      uploader: { add_context: async (...args) => {
        contexts.push(args);
        cloudState.context = { custom: { worshipsync_church_id: String(args[0]).split("=")[1] } };
      } },
    },
    muxClient: {
      video: {
        assets: {
          retrieve: async () => muxState,
          update: async (...args) => {
            passthroughs.push(args);
            muxState.passthrough = args[1].passthrough;
          },
        },
      },
    },
    storageQuota: quota,
  });
  return { service, records, owners, ready, contexts, passthroughs };
};

test("existing Cloudinary and Mux assets are reconciled idempotently from media references", async () => {
  const harness = createHarness({
    libraries: { "church-a": { list: [image(), video()] } },
    cloudAsset: { public_id: "image-1", bytes: 120 },
    muxAsset: { id: "mux-1", duration: 120, status: "ready", meta: { creator_id: "church-a" } },
  });
  const first = await harness.service.run();
  const second = await harness.service.run();
  assert.equal(first.complete, true);
  assert.equal(second.complete, true);
  assert.equal(harness.records.get("cloudinaryBytes:image-1"), 120);
  assert.equal(harness.records.get("muxMinutes:mux-1"), 2);
  assert.equal(harness.contexts.length, 1);
  assert.equal(harness.passthroughs.length, 1);
  assert.deepEqual([...harness.ready], ["church-a"]);
});

test("ambiguous cross-church provider references are reported without assigning ownership", async () => {
  const harness = createHarness({
    libraries: {
      "church-a": { list: [image("shared-image")] },
      "church-b": { list: [image("shared-image")] },
    },
    cloudAsset: { public_id: "shared-image", bytes: 120 },
  });
  harness.ready.add("church-a");
  const report = await harness.service.run();
  assert.equal(report.complete, false);
  assert.equal(harness.records.size, 0);
  assert.equal(harness.ready.size, 0);
  assert.deepEqual(report.churches.map((church) => church.issues[0].type), ["ambiguous", "ambiguous"]);
});

test("dry run reports usage without mutating provider metadata or quota ownership", async () => {
  const harness = createHarness({
    libraries: { "church-a": { list: [image(), video()] } },
    cloudAsset: { public_id: "image-1", bytes: 120 },
    muxAsset: { id: "mux-1", duration: 120, status: "ready", meta: { creator_id: "church-a" } },
  });
  const report = await harness.service.run({ dryRun: true });
  assert.equal(report.complete, false);
  assert.equal(report.churches[0].cloudinaryBytes, 120);
  assert.equal(report.churches[0].muxMinutes, 2);
  assert.equal(harness.records.size, 0);
  assert.equal(harness.contexts.length, 0);
  assert.equal(harness.passthroughs.length, 0);
});
