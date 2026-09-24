import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backfillScript = path.join(
  repositoryRoot,
  "scripts",
  "backfill-provider-storage.js",
);

test("provider storage CLI loads with plain Node without importing application TSX", () => {
  const result = spawnSync(
    process.execPath,
    [backfillScript, "--dry-run", "--report=unused-provider-storage-report.json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        COUCHDB_HOST: "",
        COUCHDB_USER: "",
        COUCHDB_PASSWORD: "",
        CLOUDINARY_API_KEY: "",
        CLOUDINARY_API_SECRET: "",
        MUX_TOKEN_ID: "",
        MUX_TOKEN_SECRET: "",
      },
    },
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, output);
  assert.match(output, /Missing required environment variables:/);
  assert.doesNotMatch(output, /ERR_UNKNOWN_FILE_EXTENSION|renderEmail\.tsx/);
});
