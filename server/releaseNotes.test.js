import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readReleaseNotes } from "./releaseNotes.js";

const createTempDirectory = () =>
  fs.mkdtemp(path.join(os.tmpdir(), "worshipsync-release-notes-"));
const repositoryReleaseNotesDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../release-notes",
);

test("validates every checked-in release-note fragment", async () => {
  const filenames = (await fs.readdir(repositoryReleaseNotesDirectory))
    .filter((filename) => filename.endsWith(".json"));
  const errors = [];
  const notes = await readReleaseNotes(repositoryReleaseNotesDirectory, {
    error: (...args) => errors.push(args),
  });

  assert.deepEqual(errors, [], "all checked-in fragments must parse and match the schema");
  assert.equal(notes.length, filenames.length, "every checked-in fragment must be accepted");
  assert.equal(
    new Set(notes.map((note) => note.id)).size,
    notes.length,
    "fragment IDs must be unique",
  );
});

test("reads valid JSON fragments newest first with stable ordering for matching dates", async (t) => {
  const directory = await createTempDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const notes = [
    { id: "older", date: "2026-10-01", type: "fixed", title: "Older", description: "Older note." },
    { id: "same-b", date: "2026-10-02", type: "new", title: "Second", description: "Second note." },
    { id: "same-a", date: "2026-10-02", type: "improved", title: "First", description: "First note." },
  ];
  await Promise.all(notes.map((note) =>
    fs.writeFile(path.join(directory, `${note.id}.json`), JSON.stringify(note)),
  ));
  await fs.writeFile(path.join(directory, "README.md"), "Not a fragment");

  assert.deepEqual(await readReleaseNotes(directory), [notes[2], notes[1], notes[0]]);
});

test("skips malformed fragments and duplicate ids without hiding valid notes", async (t) => {
  const directory = await createTempDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const valid = { id: "valid", date: "2026-10-02", type: "new", title: "Valid", description: "A valid note." };
  await fs.writeFile(path.join(directory, "01-valid.json"), JSON.stringify(valid));
  await fs.writeFile(path.join(directory, "02-malformed.json"), "{");
  await fs.writeFile(path.join(directory, "03-invalid-date.json"), JSON.stringify({ ...valid, id: "bad-date", date: "2026-02-30" }));
  await fs.writeFile(path.join(directory, "04-duplicate.json"), JSON.stringify({ ...valid, title: "Duplicate" }));
  const errors = [];

  assert.deepEqual(await readReleaseNotes(directory, { error: (...args) => errors.push(args) }), [valid]);
  assert.equal(errors.length, 3);
  assert.match(errors[0][0], /02-malformed\.json/);
  assert.match(errors[1][0], /03-invalid-date\.json/);
  assert.match(errors[2][0], /04-duplicate\.json/);
});
