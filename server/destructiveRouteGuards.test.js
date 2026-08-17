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

test("Canva design and import APIs stay behind matching-church session guards", () => {
  const guardPattern =
    /app\.use\(\s*["']\/api\/churches\/:churchId\/canva["']\s*,\s*requireAppSession\s*,\s*requireFullAppAccess\s*,/;
  const guardIndex = serverSource.search(guardPattern);
  assert.ok(guardIndex >= 0, "Canva prefix session guard is required");
  assert.match(
    serverSource,
    /req\.appSession\.churchId === req\.params\.churchId/,
  );

  for (const route of [
    'app.get("/api/churches/:churchId/canva/designs"',
    'app.get("/api/churches/:churchId/canva/designs/:designId"',
    '"/api/churches/:churchId/canva/imports"',
  ]) {
    assert.ok(
      serverSource.indexOf(route) > guardIndex,
      `${route} must remain after the Canva prefix session guard`,
    );
  }
});

test("oauth callbacks stay registered for Restream and YouTube", () => {
  assert.match(serverSource, /\/api\/restream\/oauth\/callback/);
  assert.match(serverSource, /\/api\/youtube\/oauth\/callback/);
});

test("cloudinary delete and mux upload routes remain registered", () => {
  assert.match(
    serverSource,
    /app\.delete\(\s*["']\/api\/cloudinary\/delete["']/,
  );
  assert.match(serverSource, /app\.post\(\s*["']\/api\/mux\/upload["']/);
  assert.match(
    serverSource,
    /app\.delete\(\s*["']\/api\/mux\/asset\/:assetId["']/,
  );
});
