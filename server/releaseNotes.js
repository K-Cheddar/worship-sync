import fs from "node:fs/promises";
import path from "node:path";

const RELEASE_NOTE_TYPES = new Set(["new", "improved", "fixed"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDate = (date) => {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
};

const isReleaseNote = (value) =>
  value !== null &&
  typeof value === "object" &&
  typeof value.id === "string" &&
  value.id.trim().length > 0 &&
  isValidDate(value.date) &&
  RELEASE_NOTE_TYPES.has(value.type) &&
  typeof value.title === "string" &&
  value.title.trim().length > 0 &&
  typeof value.description === "string" &&
  value.description.trim().length > 0;

/** Read repository-authored notes independently so one invalid fragment cannot hide the feed. */
export const readReleaseNotes = async (
  directory,
  logger = console,
) => {
  const filenames = (await fs.readdir(directory))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  const notes = [];
  const ids = new Set();

  for (const filename of filenames) {
    try {
      const content = await fs.readFile(path.join(directory, filename), "utf8");
      const note = JSON.parse(content);
      if (!isReleaseNote(note)) {
        throw new Error("fragment does not match the release-note schema");
      }
      if (ids.has(note.id)) {
        throw new Error(`duplicate release-note id: ${note.id}`);
      }
      ids.add(note.id);
      notes.push(note);
    } catch (error) {
      logger.error(`Skipping invalid release note ${filename}:`, error);
    }
  }

  return notes.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
};
