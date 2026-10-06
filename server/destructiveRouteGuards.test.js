/**
 * Lightweight regression guards for high-risk Express route authz wiring in server.js.
 * Full HTTP integration is expensive; these assert the mounts stay behind session gates.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = readFileSync(join(rootDir, "server.js"), "utf8");

test("boards admin API stays behind app session + full app access middleware", () => {
  assert.match(serverSource, /createAppSessionGuards/);
  assert.match(
    serverSource,
    /app\.use\(\s*["']\/api\/boards\/admin["']\s*,\s*requireAppSession\s*,\s*requireFullAppAccess\s*\)/,
  );
});

test("song-audio API stays behind app session middleware", () => {
  assert.match(
    serverSource,
    /app\.use\(\s*["']\/api\/churches\/:churchId\/song-audio["']\s*,\s*requireAppSession\s*\)/,
  );
  assert.match(serverSource, /createSongAudioUploadGuard/);
  assert.match(serverSource, /guardSongAudioUpload/);
});

test("oauth callbacks stay registered for Restream, YouTube, Canva, and Planning Center", () => {
  assert.match(serverSource, /\/api\/restream\/oauth\/callback/);
  assert.match(serverSource, /\/api\/youtube\/oauth\/callback/);
  assert.match(serverSource, /\/api\/canva\/oauth\/callback/);
  assert.match(serverSource, /\/api\/planning-center\/oauth\/callback/);
});

test("bulk service-plan route is registered before the parameterized plan save route", () => {
  const bulkHandler = serverSource.indexOf("authHandlers.applyServicePlanTemplateBulk");
  const singlePlanSaveHandler = serverSource.indexOf("authHandlers.saveServicePlan");
  assert.notEqual(bulkHandler, -1);
  assert.notEqual(singlePlanSaveHandler, -1);
  assert.ok(bulkHandler < singlePlanSaveHandler);
});

test("cloudinary delete and mux upload routes remain registered", () => {
  assert.match(
    serverSource,
    /app\.delete\(\s*["']\/api\/cloudinary\/delete["']/,
  );
  assert.match(
    serverSource,
    /app\.delete\(\s*["']\/api\/cloudinary\/delete["']\s*,\s*requireAppSession\s*,\s*requireFullAppAccess\s*,\s*requireMutationCsrf/,
  );
  assert.match(
    serverSource,
    /providerStorageService\.deleteCloudinaryImage\(\{\s*churchId:\s*req\.appSession\.churchId/,
  );
  assert.match(
    serverSource,
    /app\.post\(\s*["']\/api\/churches\/:churchId\/mux\/uploads["']/,
  );
  assert.match(
    serverSource,
    /app\.post\(\s*["']\/api\/churches\/:churchId\/mux\/assets\/:assetId\/delete["']/,
  );
});

test("permanent Cloudinary upload intents and commits use the secured church mount and CSRF", () => {
  assert.match(
    serverSource,
    /app\.use\(\s*["']\/api\/churches\/:churchId\/media-storage["']\s*,\s*requireAppSession\s*,\s*requireFullAppAccess/,
  );
  assert.match(
    serverSource,
    /app\.post\(\s*["']\/api\/churches\/:churchId\/media-storage\/cloudinary\/uploads["']\s*,\s*requireMutationCsrf/,
  );
  assert.match(
    serverSource,
    /providerStorageService\.createCloudinaryImageUpload\(\{\s*churchId:\s*req\.params\.churchId,\s*mediaId:\s*req\.body\?\.mediaId/,
  );
  assert.match(
    serverSource,
    /providerStorageService\.commitCloudinaryImage\(\{\s*churchId:\s*req\.params\.churchId,\s*uploadId:\s*req\.body\?\.uploadId,\s*publicId:\s*req\.body\?\.publicId/,
  );
  assert.match(
    serverSource,
    /providerStorageService\.cancelCloudinaryUpload\(\{\s*churchId:\s*req\.params\.churchId,\s*uploadId:\s*req\.params\.uploadId/,
  );
});
