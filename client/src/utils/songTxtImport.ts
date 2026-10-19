import type { DBItem, ServiceItem, SongMetadata } from "../types";
import { tryParseSectionLabel } from "./lyricsSectionInference";

export const MAX_SONG_TXT_BYTES = 1024 * 1024;
export type SongTxtImport = {
  title: string;
  lyrics: string;
  metadata: SongMetadata;
  warnings: string[];
};

/** Extract only identifiable metadata; ambiguous lines remain available to review. */
export const parseSongTxt = (raw: string, filename: string): SongTxtImport => {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim())
    throw new Error("This file is empty. Choose a TXT file with lyrics.");
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new Error(
        "This file does not contain readable text. Choose a lyrics TXT file.",
      );
    }
  }
  const metadata: SongMetadata = {
    source: "manual",
    trackName: "",
    artistName: "",
    importedAt: new Date().toISOString(),
    importFilename: filename,
  };
  let title = "";
  const warnings: string[] = [];
  const lines = text.split("\n");
  const lyrics: string[] = [];
  const append = (
    field: "authors" | "copyright" | "publisher",
    value: string,
  ) => {
    metadata[field] = metadata[field] ? `${metadata[field]}\n${value}` : value;
  };
  const hasSongSelectMarker = lines.some((line) =>
    /^\s*CCLI\s+Song\s*(?:#|No\.?|Number)\s*:?\s*\d+/i.test(line),
  );
  // A short block before the footer may be lyrics or credits. Its position is
  // useful for a review warning, but cannot establish that it contains names.
  const ccliIndex = lines.findIndex((line) =>
    /^\s*CCLI\s+Song\s*(?:#|No\.?|Number)\s*:?\s*\d+/i.test(line),
  );
  let footerStart = ccliIndex;
  while (footerStart > 0 && lines[footerStart - 1].trim()) footerStart--;
  const creditLines = lines.slice(footerStart, ccliIndex);
  const hasCopyrightFooter = lines
    .slice(ccliIndex + 1)
    .some((line) => /^\s*(?:©|\(c\)|Copyright\s*:)/i.test(line));
  const hasUnlabelledFooterBlock =
    footerStart > 0 &&
    creditLines.length > 0 &&
    creditLines.length <= 2 &&
    hasCopyrightFooter &&
    creditLines.every(
      (line) =>
        !tryParseSectionLabel(line) &&
        !line.includes(":") &&
        !/^(?:©|\(c\)|CCLI)/i.test(line.trim()),
    );
  let copyrightContinuation = false;
  let hasAmbiguousFooterText = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || tryParseSectionLabel(line)) copyrightContinuation = false;
    let match: RegExpMatchArray | null;
    if ((match = trimmed.match(/^(?:Title|Song Title)\s*:\s*(.+)$/i))) {
      if (!title) title = match[1];
      else lyrics.push(line);
    } else if (
      (match = trimmed.match(
        /^(?:(?:Authors?|Songwriters?)\s*:\s*|Words\s+(?:and|&)\s+Music\s+by\s*:?\s+)(.+)$/i,
      ))
    ) {
      append("authors", match[1]);
    } else if (
      (match = trimmed.match(/^(?:Artist|Performed by)\s*:\s*(.+)$/i))
    ) {
      if (!metadata.artistName) metadata.artistName = match[1];
      else lyrics.push(line);
    } else if (
      (match = trimmed.match(
        /^CCLI\s+(?:Song\s*(?:#|No\.?|Number)|#)\s*:?\s*(\d+)\s*$/i,
      ))
    ) {
      if (!metadata.ccliSongNumber) metadata.ccliSongNumber = match[1];
      else if (metadata.ccliSongNumber !== match[1]) {
        lyrics.push(line);
        warnings.push(
          "Multiple CCLI song numbers found. Review the lyrics and song number.",
        );
      }
    } else if (
      /^CCLI\s+(?:License|Licence|Licen[cs]e\s+(?:No\.?|Number))\s*(?:#|:)?\s*\d+\s*$/i.test(
        trimmed,
      ) ||
      (hasSongSelectMarker &&
        /^(?:For use solely with the SongSelect|All rights reserved\.?|www\.ccli\.com|ccli\.com)/i.test(
          trimmed,
        ))
    ) {
      // Church license and export boilerplate are not song identifiers or lyrics.
    } else if (
      (match = trimmed.match(/^(?:Copyright\s*:\s*|©\s*|\(c\)\s*)(.+)$/i))
    ) {
      append("copyright", /^Copyright/i.test(trimmed) ? match[1] : trimmed);
      copyrightContinuation = hasSongSelectMarker && index > ccliIndex;
    } else if (
      (match = trimmed.match(
        /^(?:Publishers?|Published by|Publishing)\s*:\s*(.+)$/i,
      ))
    ) {
      append("publisher", match[1]);
    } else if (copyrightContinuation) {
      append("copyright", line);
      if (
        !warnings.includes(
          "Additional copyright footer lines are kept in Copyright. Check those details before applying.",
        )
      ) {
        warnings.push(
          "Additional copyright footer lines are kept in Copyright. Check those details before applying.",
        );
      }
    } else {
      lyrics.push(line);
      if (hasUnlabelledFooterBlock && index >= footerStart && index < ccliIndex) {
        hasAmbiguousFooterText = true;
      }
    }
  }
  if (hasAmbiguousFooterText)
    warnings.push(
      "Unlabelled text before the CCLI footer is kept in the lyrics. Review it before applying; move any credits to Songwriters.",
    );
  // Metadata headers can appear between a title and the first section.
  const first = lyrics.findIndex((line) => line.trim());
  const firstSection = lyrics.findIndex(
    (line) => tryParseSectionLabel(line) !== null,
  );
  if (
    !title &&
    first >= 0 &&
    tryParseSectionLabel(lyrics[first]) === null &&
    ((firstSection > first + 1 &&
      lyrics.slice(first + 1, firstSection).every((line) => !line.trim())) ||
      (hasSongSelectMarker && firstSection === -1 && lyrics[first + 1] === ""))
  ) {
    title = lyrics[first].trim();
    lyrics.splice(first, 1);
    warnings.push(
      "The opening heading was identified as the title. Check the song name before applying.",
    );
  }
  const lyricText = lyrics.join("\n").trim();
  if (
    !lyricText ||
    lyricText
      .split("\n")
      .every((line) => !line.trim() || tryParseSectionLabel(line))
  ) {
    throw new Error("No lyrics found. Choose a TXT file with lyric text.");
  }
  if (!title) {
    title = filename.replace(/\.txt$/i, "");
    warnings.push(
      "No title identified. The filename is suggested; check the song name.",
    );
  }
  warnings.push(
    "Review all lyrics before applying. Unrecognized text is kept, including possible credits or instructions.",
  );
  metadata.trackName = title;
  return { title, lyrics: lyricText, metadata, warnings };
};

export const readSongTxtFile = async (file: File): Promise<SongTxtImport> => {
  if (!/\.txt$/i.test(file.name)) throw new Error("Choose a .txt lyrics file.");
  if (file.size > MAX_SONG_TXT_BYTES)
    throw new Error(
      "This file is too large. Choose a TXT file smaller than 1 MB.",
    );
  if (!file.size)
    throw new Error("This file is empty. Choose a TXT file with lyrics.");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error(
      "Could not read this file. Choose it again or try another TXT file.",
    );
  }
  let text: string;
  let legacyEncoding = false;
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    text = new TextDecoder("utf-16le").decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    text = new TextDecoder("utf-16be").decode(bytes);
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
      legacyEncoding = true;
    }
  }
  const result = parseSongTxt(text, file.name);
  if (legacyEncoding)
    result.warnings.push(
      "Read as Windows text. Check accented letters and punctuation.",
    );
  return result;
};

export const normalizeSongTitle = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const findSongDuplicates = (
  title: string,
  ccli: string | undefined,
  library: ServiceItem[],
  documents: DBItem[],
): ServiceItem[] => {
  const normalized = normalizeSongTitle(title);
  const number = ccli?.trim().replace(/^0+(?=\d)/, "");
  const ids = new Set(
    documents
      .filter(
        (doc) =>
          doc.type === "song" &&
          number &&
          doc.songMetadata?.ccliSongNumber?.trim().replace(/^0+(?=\d)/, "") ===
            number,
      )
      .map((doc) => doc._id),
  );
  return library.filter(
    (song) =>
      ids.has(song._id) ||
      (normalized && normalizeSongTitle(song.name) === normalized),
  );
};
