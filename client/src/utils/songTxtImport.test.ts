import { readFileSync } from "fs";
import { join } from "path";
import {
  createItemFromProps,
  createNewSong,
  createSections,
  updateFormattedSections,
} from "./itemUtil";
import {
  findSongDuplicates,
  MAX_SONG_TXT_BYTES,
  parseSongTxt,
  readSongTxtFile,
} from "./songTxtImport";
import { inferLyricsSections } from "./lyricsSectionInference";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const file = (bytes: Uint8Array, name = "song.txt") =>
  ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer }) as File;

describe("TXT song import", () => {
  it("retains adjacent unlabelled opening lyrics instead of inventing a title", () => {
    const parsed = parseSongTxt(
      "An opening lyric\nVerse 1\nMore words",
      "fallback.txt",
    );
    expect(parsed.title).toBe("fallback");
    expect(inferLyricsSections(parsed.lyrics)[0].words).toBe(
      "An opening lyric",
    );
  });

  it("keeps multiline copyright footers out of lyric slides without dropping the details", () => {
    const parsed = parseSongTxt(
      "Title: Example\nVerse 1\nWords to sing\n\nCCLI Song # 456\n© 2026 Example Songs\nExample Publishing (Admin. by Example)\nFor use solely with the SongSelect Terms of Use\nCCLI License # 123",
      "song.txt",
    );
    expect(parsed.lyrics).toBe("Verse 1\nWords to sing");
    expect(parsed.metadata.copyright).toContain(
      "Example Publishing (Admin. by Example)",
    );
    expect(parsed.metadata.ccliSongNumber).toBe("456");
    expect(parsed.warnings.join(" ")).toContain(
      "Additional copyright footer lines",
    );
  });

  it("supports another layout with header metadata and unlabelled footer songwriters", () => {
    const parsed = parseSongTxt(
      fixture("songselect-footer-credits.txt"),
      "export.txt",
    );
    expect(parsed).toMatchObject({
      title: "Another Morning",
      metadata: {
        artistName: "Example Ensemble",
        authors: "Alex Example | Jamie Sample",
        ccliSongNumber: "2345678",
        publisher: "Sample Publishing",
      },
    });
    expect(parsed.lyrics).not.toMatch(/Alex|Jamie|CCLI|Copyright|Sample/);
    expect(parsed.warnings.join(" ")).toMatch(/Check the credits/);
  });

  it("extracts a SongSelect export and preserves repeated references through the existing pipeline", () => {
    const parsed = parseSongTxt(fixture("songselect.txt"), "export.txt");
    expect(parsed.title).toBe("Morning Light");
    expect(parsed.metadata).toMatchObject({
      authors: "Alex Example | Jamie Sample",
      ccliSongNumber: "1234567",
      copyright: "© 2026 Example Songs",
      publisher: "Example Publishing",
      artistName: "",
    });
    expect(parsed.lyrics).not.toMatch(/CCLI|Copyright|©|Example|SongSelect/);
    const sections = updateFormattedSections(
      createSections({ unformattedLyrics: parsed.lyrics }),
    );
    expect(
      sections.songOrder.map(
        (entry) =>
          sections.formattedLyrics.find(
            (section) => section.name === entry.name,
          )?.type,
      ),
    ).toEqual(["Verse", "Chorus", "Verse", "Chorus", "Ending"]);
    expect(sections.songOrder).toHaveLength(5);
    expect(sections.songOrder[1].name).toBe(sections.songOrder[3].name);
  });

  it("retains plain lyrics verbatim and suggests the filename without inventing metadata", () => {
    const text = fixture("plain-lyrics.txt").replace(/\r\n/g, "\n").trim();
    const parsed = parseSongTxt(text, "My lyrics.txt");
    expect(parsed).toMatchObject({ title: "My lyrics", lyrics: text });
    expect(parsed.metadata.artistName).toBe("");
    expect(parsed.metadata.authors).toBeUndefined();
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("accepts BOM and Windows newlines and keeps uncertain text before section labels", () => {
    const parsed = parseSongTxt(
      "\uFEFFTitle: A Song\r\nArtist: A Singer\r\nUncertain opening\r\nVerse 1\r\nExact WORDS!\r\nRefrain\r\nAgain",
      "song.txt",
    );
    expect(parsed.metadata.artistName).toBe("A Singer");
    expect(inferLyricsSections(parsed.lyrics)).toEqual([
      { type: "Verse", words: "Uncertain opening" },
      { type: "Verse", words: "Exact WORDS!" },
      { type: "Refrain", words: "Again" },
    ]);
  });

  it("never interprets a church license as a CCLI song number", () => {
    expect(
      parseSongTxt("Lyrics here\nCCLI License # 456", "song.txt").metadata
        .ccliSongNumber,
    ).toBeUndefined();
  });

  it.each([
    "",
    " \r\n",
    "\u0000binary",
    "Title: Missing lyrics\nCCLI Song # 123",
    "Verse 1\nChorus",
  ])("rejects empty or invalid text %j", (text) => {
    expect(() => parseSongTxt(text, "song.txt")).toThrow();
  });

  it("decodes UTF-8, Windows-1252, and UTF-16 BOM files", async () => {
    expect(
      (await readSongTxtFile(file(new TextEncoder().encode("Café lyrics"))))
        .lyrics,
    ).toBe("Café lyrics");
    expect(
      (await readSongTxtFile(file(new Uint8Array([67, 97, 102, 233])))).lyrics,
    ).toBe("Café");
    expect(
      (await readSongTxtFile(file(new Uint8Array([255, 254, 65, 0, 66, 0]))))
        .lyrics,
    ).toBe("AB");
    expect(
      (await readSongTxtFile(file(new Uint8Array([254, 255, 0, 65, 0, 66]))))
        .lyrics,
    ).toBe("AB");
  });

  it("rejects large, empty, wrong-format and unreadable files", async () => {
    await expect(
      readSongTxtFile({
        name: "song.txt",
        size: MAX_SONG_TXT_BYTES + 1,
      } as File),
    ).rejects.toThrow("too large");
    await expect(readSongTxtFile(file(new Uint8Array()))).rejects.toThrow(
      "empty",
    );
    await expect(
      readSongTxtFile(file(new Uint8Array([65]), "song.doc")),
    ).rejects.toThrow(".txt");
    const unreadable = new File(["x"], "song.txt");
    Object.defineProperty(unreadable, "arrayBuffer", {
      value: async () => {
        throw new Error("read failed");
      },
    });
    await expect(readSongTxtFile(unreadable)).rejects.toThrow("Could not read");
  });

  it("matches CCLI numbers and normalized Unicode titles without changing documents", () => {
    const docs = [
      createItemFromProps({
        _id: "one",
        name: "Different title",
        type: "song",
        songMetadata: {
          source: "manual",
          trackName: "",
          artistName: "",
          importedAt: "",
          ccliSongNumber: "123",
        },
      }),
      createItemFromProps({
        _id: "two",
        name: "  Café — Song! ",
        type: "song",
      }),
    ];
    const library = docs.map((doc) => ({
      _id: doc._id,
      listId: doc._id,
      name: doc.name,
      type: doc.type,
    }));
    const before = JSON.stringify(docs);
    expect(
      findSongDuplicates("café song", "00123", library, docs).map(
        (doc) => doc._id,
      ),
    ).toEqual(["one", "two"]);
    expect(JSON.stringify(docs)).toBe(before);
    expect(findSongDuplicates("", undefined, library, docs)).toEqual([]);
  });

  it("creates, persists, reloads and edits imported metadata through the normal document path", async () => {
    const parsed = parseSongTxt(fixture("songselect.txt"), "export.txt");
    const documents = new Map();
    const db = {
      get: jest.fn(async (id: string) => {
        if (!documents.has(id))
          throw Object.assign(new Error("not found"), { status: 404 });
        return JSON.parse(JSON.stringify(documents.get(id)));
      }),
      put: jest.fn(async (doc) => {
        documents.set(doc._id, JSON.parse(JSON.stringify(doc)));
        return { ok: true };
      }),
    };
    const sections = updateFormattedSections(
      createSections({ unformattedLyrics: parsed.lyrics }),
    );
    const created = await createNewSong({
      name: parsed.title,
      ...sections,
      list: [],
      db: db as never,
      background: "",
      brightness: 100,
      songMetadata: parsed.metadata,
    });
    const reopened = createItemFromProps(await db.get(created._id));
    expect(reopened.songMetadata).toEqual(parsed.metadata);
    expect(reopened.arrangements[0].songOrder).toHaveLength(5);
    expect(JSON.stringify(reopened.arrangements)).not.toContain("CCLI");
    const edited = createItemFromProps({ ...reopened, name: "Edited title" });
    await db.put(edited);
    expect((await db.get(created._id)).songMetadata).toEqual(parsed.metadata);
  });
});
