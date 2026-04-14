import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import dotenv from "dotenv";
import { createLyricsImportService } from "../lyricsImport.js";

dotenv.config();

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : "";
};

const hasFlag = (flag) => args.includes(flag);

const printUsage = () => {
  console.log(`
Backfill missing song artists from LRCLIB.

Usage:
  node scripts/backfill-song-artists.js --database=<database> [--dry-run]

Options:
  --database=<name>     Content database key or full CouchDB name.
                       Example: eliathah or worship-sync-eliathah
  --dry-run             Find matches and write a report without saving changes.
  --limit=<number>      Only process the first N eligible songs.
  --concurrency=<n>     LRCLIB lookup concurrency. Default: 4
  --report=<path>       JSON report output path.
  --help                Show this help text.

Examples:
  node scripts/backfill-song-artists.js --database=eliathah --dry-run
  node scripts/backfill-song-artists.js --database=eliathah --limit=100
`);
};

if (hasFlag("--help")) {
  printUsage();
  process.exit(0);
}

const dryRun = hasFlag("--dry-run");
const databaseArg = getArgValue("--database");
const limitArg = getArgValue("--limit");
const concurrencyArg = getArgValue("--concurrency");
const reportArg = getArgValue("--report");

const limit =
  limitArg && Number.isFinite(Number(limitArg)) && Number(limitArg) > 0
    ? Math.floor(Number(limitArg))
    : null;
const concurrency =
  concurrencyArg &&
  Number.isFinite(Number(concurrencyArg)) &&
  Number(concurrencyArg) > 0
    ? Math.floor(Number(concurrencyArg))
    : 4;

const requiredEnv = ["COUCHDB_HOST", "COUCHDB_USER", "COUCHDB_PASSWORD"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

if (!databaseArg) {
  console.error("Provide --database=<content database key>");
  printUsage();
  process.exit(1);
}

const normalizeDatabaseName = (value) => {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("worship-sync-")
    ? trimmed
    : `worship-sync-${trimmed}`;
};

const couchOrigin = process.env.COUCHDB_HOST.startsWith("http")
  ? process.env.COUCHDB_HOST
  : `https://${process.env.COUCHDB_HOST}`;
const databaseName = normalizeDatabaseName(databaseArg);
const reportPath = path.resolve(
  reportArg || `${databaseName}-song-artist-backfill-report.json`,
);

const dbClient = axios.create({
  baseURL: `${couchOrigin}/${encodeURIComponent(databaseName)}`,
  auth: {
    username: process.env.COUCHDB_USER,
    password: process.env.COUCHDB_PASSWORD,
  },
  timeout: 30000,
});

const lyricsImportService = createLyricsImportService();
const WRITE_MAX_ATTEMPTS = 3;

const chunk = (items, size) => {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getString = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeTitleStrict = (value) =>
  getString(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeTitleCore = (value) =>
  getString(value)
    .toLowerCase()
    .replace(/ *\([^)]*\) */g, " ")
    .replace(/ *\[[^\]]*] */g, " ")
    .replace(/\b(feat|ft)\.?\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeArtist = (value) => normalizeTitleStrict(value);

const dedupeCandidates = (candidates) => {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${normalizeTitleStrict(candidate.trackName)}|${normalizeArtist(candidate.artistName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const rankExactCandidates = (songName, candidates) => {
  const strictName = normalizeTitleStrict(songName);
  const coreName = normalizeTitleCore(songName);
  const exactStrict = [];
  const exactCore = [];

  for (const candidate of dedupeCandidates(candidates)) {
    const strictTrack = normalizeTitleStrict(candidate.trackName);
    const coreTrack = normalizeTitleCore(candidate.trackName);
    if (strictTrack && strictTrack === strictName) {
      exactStrict.push(candidate);
      continue;
    }
    if (coreTrack && coreTrack === coreName) {
      exactCore.push(candidate);
    }
  }

  if (exactStrict.length > 0) {
    return { candidates: exactStrict, matchType: "strict" };
  }

  if (exactCore.length > 0) {
    return { candidates: exactCore, matchType: "core" };
  }

  return { candidates: [], matchType: null };
};

const resolveArtistMatch = async (songName) => {
  const trimmedSongName = getString(songName);
  if (!trimmedSongName) {
    return { status: "skipped", reason: "empty-title" };
  }

  const searchResults =
    await lyricsImportService.searchLrclibTracks({
      track_name: trimmedSongName,
    });

  const { candidates, matchType } = rankExactCandidates(
    trimmedSongName,
    searchResults,
  );

  if (candidates.length === 0) {
    return {
      status: "no-match",
      reason: "no-exact-title-match",
      candidates: searchResults.slice(0, 5).map((candidate) => ({
        trackName: candidate.trackName,
        artistName: candidate.artistName,
      })),
    };
  }

  const uniqueArtists = new Map();
  for (const candidate of candidates) {
    const normalizedArtist = normalizeArtist(candidate.artistName);
    if (!uniqueArtists.has(normalizedArtist)) {
      uniqueArtists.set(normalizedArtist, candidate);
    }
  }

  if (uniqueArtists.size !== 1) {
    return {
      status: "ambiguous",
      reason: "multiple-artists-for-title",
      matchType,
      candidates: Array.from(uniqueArtists.values()).map((candidate) => ({
        trackName: candidate.trackName,
        artistName: candidate.artistName,
      })),
    };
  }

  return {
    status: "matched",
    matchType,
    candidate: Array.from(uniqueArtists.values())[0],
  };
};

const fetchAllSongDocs = async () => {
  try {
    const allItemsResponse = await dbClient.get("/allItems");
    const allItems = Array.isArray(allItemsResponse.data?.items)
      ? allItemsResponse.data.items
      : [];
    const songIds = Array.from(
      new Set(
        allItems
          .filter((item) => item?.type === "song" && getString(item?._id))
          .map((item) => item._id),
      ),
    );

    const docs = [];
    for (const keys of chunk(songIds, 250)) {
      const response = await dbClient.post("/_all_docs", {
        include_docs: true,
        keys,
      });
      for (const row of response.data?.rows || []) {
        if (row?.doc?.type === "song") {
          docs.push(row.doc);
        }
      }
    }
    return docs;
  } catch (error) {
    if (error?.response?.status !== 404) {
      throw error;
    }
  }

  const response = await dbClient.get("/_all_docs", {
    params: {
      include_docs: true,
    },
  });
  return (response.data?.rows || [])
    .map((row) => row?.doc)
    .filter((doc) => doc?.type === "song");
};

const hasArtist = (doc) => Boolean(getString(doc?.songMetadata?.artistName));

const buildSongMetadata = (doc, match, nowIso) => {
  const existingMetadata =
    doc.songMetadata && typeof doc.songMetadata === "object"
      ? doc.songMetadata
      : null;

  if (existingMetadata) {
    const next = {
      ...existingMetadata,
      trackName: getString(existingMetadata.trackName) || getString(doc.name) || match.trackName,
      artistName: match.artistName,
      importedAt: getString(existingMetadata.importedAt) || nowIso,
    };

    if (!getString(existingMetadata.albumName) && getString(match.albumName)) {
      next.albumName = match.albumName;
    }

    return next;
  }

  const next = {
    source: "lrclib",
    trackName: getString(doc.name) || match.trackName,
    artistName: match.artistName,
    importedAt: nowIso,
  };

  if (Number.isFinite(match.lrclibId) && match.lrclibId > 0) {
    next.lrclibId = match.lrclibId;
  }
  if (getString(match.albumName)) {
    next.albumName = match.albumName;
  }
  if (Number.isFinite(match.durationMs) && match.durationMs > 0) {
    next.durationMs = match.durationMs;
  }
  if (typeof match.instrumental === "boolean") {
    next.instrumental = match.instrumental;
  }

  return next;
};

const createUpdatedDoc = (doc, match) => {
  const nowIso = new Date().toISOString();
  return {
    ...doc,
    songMetadata: buildSongMetadata(doc, match, nowIso),
    updatedAt: nowIso,
    updatedBy: "Song artist backfill script (LRCLIB)",
  };
};

const isRetriableWriteError = (error) => {
  const status = error?.response?.status;
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
};

const fetchDocById = async (id) => {
  const response = await dbClient.get(`/${encodeURIComponent(id)}`);
  return response.data;
};

const writeDoc = async (doc) => {
  await dbClient.put(`/${encodeURIComponent(doc._id)}`, doc, {
    headers: {
      "Content-Type": "application/json",
    },
  });
};

const writeReport = async (report) => {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
};

const processWithConcurrency = async (items, worker) => {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index], index);
      }
    },
  );

  await Promise.all(workers);
  return results;
};

const persistMatchedSongs = async (matchedSongs, report) => {
  let written = 0;

  for (const matchedSong of matchedSongs) {
    let currentDoc = matchedSong.doc;
    let lastError = null;

    for (let attempt = 1; attempt <= WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        const nextDoc = createUpdatedDoc(currentDoc, matchedSong.match);
        await writeDoc(nextDoc);
        report.updated.push({
          _id: matchedSong.doc._id,
          name: matchedSong.doc.name,
          artistName: matchedSong.match.artistName,
          albumName: matchedSong.match.albumName || "",
          lrclibId: matchedSong.match.lrclibId || null,
          matchType: matchedSong.matchType,
        });
        report.updatedSongs += 1;
        written += 1;
        if (written % 10 === 0 || written === matchedSongs.length) {
          console.log(`Wrote ${written}/${matchedSongs.length} matched songs...`);
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;

        if (status === 409) {
          currentDoc = await fetchDocById(matchedSong.doc._id);
          continue;
        }

        if (isRetriableWriteError(error) && attempt < WRITE_MAX_ATTEMPTS) {
          await sleep(attempt * 1000);
          continue;
        }

        break;
      }
    }

    if (lastError) {
      report.errorSongs += 1;
      report.errors.push({
        _id: matchedSong.doc._id,
        name: matchedSong.doc.name,
        phase: "write",
        status: lastError?.response?.status || null,
        error:
          lastError instanceof Error
            ? lastError.message
            : "Unknown write failure",
      });
    }
  }
};

const run = async () => {
  console.log(`Loading songs from ${databaseName}...`);
  const allSongDocs = await fetchAllSongDocs();
  const eligibleSongs = allSongDocs.filter((doc) => !hasArtist(doc));
  const songsToProcess = limit ? eligibleSongs.slice(0, limit) : eligibleSongs;
  const lookupCache = new Map();
  let processed = 0;

  const report = {
    generatedAt: new Date().toISOString(),
    database: databaseName,
    dryRun,
    scannedSongs: allSongDocs.length,
    eligibleSongs: eligibleSongs.length,
    processedSongs: songsToProcess.length,
    concurrency,
    matchedSongs: 0,
    updatedSongs: 0,
    noMatchSongs: 0,
    ambiguousSongs: 0,
    errorSongs: 0,
    updated: [],
    skipped: [],
    errors: [],
  };

  const processedRows = await processWithConcurrency(
    songsToProcess,
    async (doc) => {
      try {
        const cacheKey = normalizeTitleCore(doc.name);
        let matchPromise = lookupCache.get(cacheKey);
        if (!matchPromise) {
          matchPromise = resolveArtistMatch(doc.name);
          lookupCache.set(cacheKey, matchPromise);
        }

        const resolution = await matchPromise;
        processed += 1;

        if (processed % 25 === 0 || processed === songsToProcess.length) {
          console.log(
            `Processed ${processed}/${songsToProcess.length} songs...`,
          );
        }

        if (resolution.status !== "matched") {
          return {
            action: "skip",
            doc,
            resolution,
          };
        }

        return {
          action: "update",
          doc,
          resolution,
          nextDoc: createUpdatedDoc(doc, resolution.candidate),
        };
      } catch (error) {
        processed += 1;
        return {
          action: "error",
          doc,
          error:
            error instanceof Error ? error.message : "Unknown lookup failure",
        };
      }
    },
  );

  const matchedSongs = [];

  for (const row of processedRows) {
    if (!row) continue;

    if (row.action === "update") {
      matchedSongs.push({
        doc: row.doc,
        match: row.resolution.candidate,
        matchType: row.resolution.matchType,
      });
      continue;
    }

    if (row.action === "skip") {
      if (row.resolution.status === "ambiguous") {
        report.ambiguousSongs += 1;
      } else {
        report.noMatchSongs += 1;
      }
      report.skipped.push({
        _id: row.doc._id,
        name: row.doc.name,
        status: row.resolution.status,
        reason: row.resolution.reason,
        matchType: row.resolution.matchType || null,
        candidates: row.resolution.candidates || [],
      });
      continue;
    }

    report.errorSongs += 1;
    report.errors.push({
      _id: row.doc._id,
      name: row.doc.name,
      phase: "lookup",
      error: row.error,
    });
  }

  report.matchedSongs = matchedSongs.length;
  if (dryRun) {
    report.updatedSongs = matchedSongs.length;
    for (const matchedSong of matchedSongs) {
      report.updated.push({
        _id: matchedSong.doc._id,
        name: matchedSong.doc.name,
        artistName: matchedSong.match.artistName,
        albumName: matchedSong.match.albumName || "",
        lrclibId: matchedSong.match.lrclibId || null,
        matchType: matchedSong.matchType,
      });
    }
  }

  if (!dryRun && matchedSongs.length > 0) {
    console.log(`Writing ${matchedSongs.length} matched song updates...`);
    await persistMatchedSongs(matchedSongs, report);
  }

  await writeReport(report);

  console.log(
    dryRun
      ? `Dry run complete. Report written to ${reportPath}`
      : `Backfill complete. Report written to ${reportPath}`,
  );
  console.log(
    dryRun
      ? `Matched ${report.matchedSongs}, ambiguous ${report.ambiguousSongs}, no match ${report.noMatchSongs}, errors ${report.errorSongs}.`
      : `Matched ${report.matchedSongs}, updated ${report.updatedSongs}, ambiguous ${report.ambiguousSongs}, no match ${report.noMatchSongs}, errors ${report.errorSongs}.`,
  );
};

run().catch(async (error) => {
  console.error("Song artist backfill failed:", error);
  process.exit(1);
});
