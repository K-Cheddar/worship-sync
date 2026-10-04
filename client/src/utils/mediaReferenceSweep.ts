import type {
  Box,
  DBItem,
  DBOverlay,
  DBPreferences,
  DBQuickLinksDoc,
  ItemSlideType,
  ItemType,
  MediaType,
  OverlayInfo,
  PreferenceBackground,
  PreferencesType,
  Presentation,
  QuickLinkType,
} from "../types";
import { normalizeItemSlides, normalizeSongForPersistence } from "./activeItemSlides";
import {
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  isControllerMediaRouteFoldersDocId,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
} from "../types";
import { isLegacyPreferencesDoc } from "./dbUtils";
import type { allDocsType } from "../types";
import {
  mediaReferenceMatches,
  replaceMediaReferencesInItem,
  replaceMediaReferencesInPreference,
  replaceMediaReferencesInQuickLinks,
  type MediaReferenceReplacement,
} from "./mediaReferenceReplacement";

/** Canonical defaults when stripping a deleted asset from preference fields (matches preferencesSlice seeds). */
const CANONICAL_DEFAULT_BACKGROUNDS: Pick<
  PreferencesType,
  | "defaultSongBackground"
  | "defaultTimerBackground"
  | "defaultBibleBackground"
  | "defaultFreeFormBackground"
> = {
  defaultSongBackground: {
    background:
      "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/WorshipBackground_ycr280?_a=DATAg1AAZAA0",
    mediaInfo: undefined,
  },
  defaultTimerBackground: {
    background: "",
    mediaInfo: undefined,
  },
  defaultBibleBackground: {
    background:
      "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/bible-background_mlek3e?_a=DATAg1AAZAA0",
    mediaInfo: undefined,
  },
  defaultFreeFormBackground: {
    background:
      "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/simple-background-2048x1152_zj96ie?_a=DATAg1AAZAA0",
    mediaInfo: undefined,
  },
};

function stripUrlQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

function matchesDeleted(
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
  mediaInfo?: MediaType,
  backgroundUrl?: string,
): boolean {
  if (mediaInfo?.id && deletedIds.has(mediaInfo.id)) return true;
  if (backgroundUrl) {
    const s = stripUrlQuery(backgroundUrl);
    if (deletedUrls.has(s)) return true;
  }
  return false;
}

function preferenceDefaultForItemType(type: ItemType): PreferenceBackground {
  switch (type) {
    case "timer":
      return { ...CANONICAL_DEFAULT_BACKGROUNDS.defaultTimerBackground };
    case "bible":
      return { ...CANONICAL_DEFAULT_BACKGROUNDS.defaultBibleBackground };
    case "free":
      return { ...CANONICAL_DEFAULT_BACKGROUNDS.defaultFreeFormBackground };
    case "song":
    case "image":
    default:
      return { ...CANONICAL_DEFAULT_BACKGROUNDS.defaultSongBackground };
  }
}

function resetBoxIfMatch(
  box: Box,
  pb: PreferenceBackground,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
): Box {
  if (!matchesDeleted(deletedIds, deletedUrls, box.mediaInfo, box.background))
    return box;
  return {
    ...box,
    background: pb.background,
    mediaInfo: pb.mediaInfo,
  };
}

function sweepSlide(
  slide: ItemSlideType,
  pb: PreferenceBackground,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
  deletedVideoSourceIds: Set<string>,
): ItemSlideType {
  const mapBoxes = (boxes: Box[]) =>
    boxes.map((b) => resetBoxIfMatch(b, pb, deletedIds, deletedUrls));
  const boxes = mapBoxes(slide.boxes);
  const mediaSourceMatches =
    slide.mediaSource?.kind === "local-video-input" &&
    deletedVideoSourceIds.has(slide.mediaSource.sourceId);
  const { monitorCurrentBandBoxes: _current, monitorNextBandBoxes: _next, ...clean } = slide;
  const next: ItemSlideType = { ...clean, boxes };
  if (mediaSourceMatches) {
    const { mediaSource: _removed, ...rest } = next;
    return rest;
  }
  return next;
}

function sweepSlides(
  slides: ItemSlideType[],
  pb: PreferenceBackground,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
  deletedVideoSourceIds: Set<string>,
): ItemSlideType[] {
  return slides.map((s) =>
    sweepSlide(s, pb, deletedIds, deletedUrls, deletedVideoSourceIds),
  );
}

function sweepOverlayInfo(
  info: OverlayInfo | undefined,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
): OverlayInfo | undefined {
  if (!info || info.type !== "image") return info;
  const url = info.imageUrl;
  if (!matchesDeleted(deletedIds, deletedUrls, undefined, url)) return info;
  return { ...info, imageUrl: "" };
}

function sweepPresentation(
  pres: Presentation | undefined,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
  deletedVideoSourceIds: Set<string>,
): Presentation | undefined {
  if (!pres) return pres;
  const pb = preferenceDefaultForItemType("song");
  let next: Presentation = { ...pres };
  if (pres.slide) {
    next = {
      ...next,
      slide: sweepSlide(
        pres.slide,
        pb,
        deletedIds,
        deletedUrls,
        deletedVideoSourceIds,
      ),
    };
  }
  if (pres.nextSlide) {
    next = {
      ...next,
      nextSlide: sweepSlide(
        pres.nextSlide,
        pb,
        deletedIds,
        deletedUrls,
        deletedVideoSourceIds,
      ),
    };
  }
  next = {
    ...next,
    participantOverlayInfo: sweepOverlayInfo(
      next.participantOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
    stbOverlayInfo: sweepOverlayInfo(
      next.stbOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
    qrCodeOverlayInfo: sweepOverlayInfo(
      next.qrCodeOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
    imageOverlayInfo: sweepOverlayInfo(
      next.imageOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
  };
  if (pres.bibleInfoBox) {
    next = {
      ...next,
      bibleInfoBox: resetBoxIfMatch(
        pres.bibleInfoBox,
        preferenceDefaultForItemType("bible"),
        deletedIds,
        deletedUrls,
      ),
    };
  }
  if (
    next.localVideoInput?.sourceId &&
    deletedVideoSourceIds.has(next.localVideoInput.sourceId)
  ) {
    const { localVideoInput: _removed, ...rest } = next;
    next = rest;
  }
  return next;
}

function sweepPreferenceBackground(
  field: keyof Pick<
    PreferencesType,
    | "defaultSongBackground"
    | "defaultTimerBackground"
    | "defaultBibleBackground"
    | "defaultFreeFormBackground"
  >,
  prefs: PreferencesType,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
): boolean {
  const pb = prefs[field];
  const canonical = CANONICAL_DEFAULT_BACKGROUNDS[field];
  if (!matchesDeleted(deletedIds, deletedUrls, pb.mediaInfo, pb.background))
    return false;
  prefs[field] = { ...canonical };
  return true;
}

const ITEM_TYPES: ItemType[] = ["song", "free", "bible", "timer", "image"];

export type MediaReferenceSweepResult = {
  ok: boolean;
  failedDocIds: string[];
  message?: string;
  rollbackStatus?: "not_needed" | "complete" | "uncertain";
  rollback?: () => Promise<"complete" | "uncertain">;
};

export type MediaReferenceReplacementResult = MediaReferenceSweepResult & {
  /** Whether failed writes were fully restored before returning an error. */
  rollbackStatus: "not_needed" | "complete" | "uncertain";
  updatedDocs?: Record<string, unknown>[];
};

/**
 * Check whether saved documents still contain references to an older
 * rendition. This is intentionally read-only and is used only when a Canva
 * replacement needs recovery after an ambiguous write.
 */
export async function hasSupersededMediaReferences(
  db: PouchDB.Database,
  oldMedia: MediaType,
  currentMedia: MediaType,
): Promise<boolean> {
  const oldUrls = new Set(
    [oldMedia.background, oldMedia.thumbnail, oldMedia.placeholderImage]
      .filter((url): url is string => Boolean(url))
      .map(stripUrlQuery),
  );
  const currentUrls = new Set(
    [currentMedia.background, currentMedia.thumbnail, currentMedia.placeholderImage]
      .filter((url): url is string => Boolean(url))
      .map(stripUrlQuery),
  );
  const hasOldUrl = (value: unknown) =>
    typeof value === "string" && oldUrls.has(stripUrlQuery(value)) && !currentUrls.has(stripUrlQuery(value));
  const mediaInfoIsOld = (value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const info = value as Partial<MediaType>;
    if (info.id !== oldMedia.id) return false;
    // Sparse legacy references cannot prove which rendition they point at.
    if (!info.background && !info.publicId && !info.muxAssetId && !info.canvaSource?.revision) return true;
    return (info.background !== undefined && info.background !== currentMedia.background) ||
      (info.publicId !== undefined && info.publicId !== currentMedia.publicId) ||
      (info.muxAssetId !== undefined && info.muxAssetId !== currentMedia.muxAssetId) ||
      (info.canvaSource?.revision !== undefined && info.canvaSource.revision !== currentMedia.canvaSource?.revision);
  };
  const containsOldReference = (value: unknown, key = ""): boolean => {
    if (key === "mediaInfo" && mediaInfoIsOld(value)) return true;
    if ((key === "background" || key === "imageUrl") && hasOldUrl(value)) return true;
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some((entry) => containsOldReference(entry));
    return Object.entries(value as Record<string, unknown>)
      .some(([childKey, child]) => containsOldReference(child, childKey));
  };

  const allDocs = (await db.allDocs({ include_docs: true })) as allDocsType;
  return allDocs.rows.some(({ id, doc }) =>
    Boolean(doc) && !isMediaLibraryStorageDoc(doc as Record<string, unknown>, id) && containsOldReference(doc),
  );
}

function buildDeletedUrlSet(rows: MediaType[]): Set<string> {
  const s = new Set<string>();
  for (const m of rows) {
    if (m.background) s.add(stripUrlQuery(m.background));
    if (m.thumbnail) s.add(stripUrlQuery(m.thumbnail));
    if (m.placeholderImage) s.add(stripUrlQuery(m.placeholderImage));
  }
  return s;
}

function buildDeletedVideoSourceIdSet(rows: MediaType[]): Set<string> {
  const s = new Set<string>();
  for (const m of rows) {
    const sourceId = m.localVideoInput?.sourceId;
    if (sourceId) s.add(sourceId);
  }
  return s;
}

/** Media-library documents are storage records, never saved presentation items. */
function isMediaLibraryStorageDoc(
  doc: Record<string, unknown>,
  id: string,
): boolean {
  return (
    id === "media" ||
    id === "media-folders" ||
    id === "media-library-meta" ||
    id.startsWith("media-item:") ||
    isControllerMediaRouteFoldersDocId(id) ||
    doc.docType === "mediaRouteFolders" ||
    doc.docType === "mediaItem" ||
    doc.docType === "mediaFolders" ||
    doc.docType === "mediaLibraryMeta"
  );
}

/** Prepare, apply, and retain a rollback for reference changes before item deletion. */
export async function sweepMediaReferencesBeforeDelete(
  db: PouchDB.Database,
  deletedIds: Set<string>,
  deletedRows: MediaType[],
): Promise<MediaReferenceSweepResult> {
  if (deletedIds.size === 0) return { ok: true, failedDocIds: [] };

  const deletedUrls = buildDeletedUrlSet(deletedRows);
  const deletedVideoSourceIds = buildDeletedVideoSourceIdSet(deletedRows);
  const pending = new Map<
    string,
    { previous: Record<string, unknown>; next: Record<string, unknown> }
  >();
  const addIfChanged = (
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
  ) => {
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const id = typeof previous._id === "string" ? previous._id : "";
    if (id) pending.set(id, { previous, next });
  };

  let prefsRaw: Record<string, unknown>;
  try {
    prefsRaw = (await db.get(PREFERENCES_POUCH_ID)) as unknown as Record<
      string,
      unknown
    >;
  } catch (error) {
    return {
      ok: false,
      failedDocIds: [PREFERENCES_POUCH_ID],
      message: "Could not load preferences for reference cleanup.",
      rollbackStatus: "not_needed",
    };
  }

  const prefs = {
    ...((prefsRaw.preferences ?? {}) as PreferencesType),
  };
  let prefsDirty = false;
  prefsDirty =
    sweepPreferenceBackground(
      "defaultSongBackground",
      prefs,
      deletedIds,
      deletedUrls,
    ) || prefsDirty;
  prefsDirty =
    sweepPreferenceBackground(
      "defaultTimerBackground",
      prefs,
      deletedIds,
      deletedUrls,
    ) || prefsDirty;
  prefsDirty =
    sweepPreferenceBackground(
      "defaultBibleBackground",
      prefs,
      deletedIds,
      deletedUrls,
    ) || prefsDirty;
  prefsDirty =
    sweepPreferenceBackground(
      "defaultFreeFormBackground",
      prefs,
      deletedIds,
      deletedUrls,
    ) || prefsDirty;

  const legacy = isLegacyPreferencesDoc(prefsRaw);
  let quickLinksSource: QuickLinkType[] = [];
  let quickLinksRaw: Record<string, unknown> | undefined;
  if (legacy) {
    quickLinksSource = (prefsRaw.quickLinks as QuickLinkType[]) ?? [];
  } else {
    try {
      const ql = (await db.get(QUICK_LINKS_POUCH_ID)) as DBQuickLinksDoc;
      quickLinksRaw = ql as unknown as Record<string, unknown>;
      quickLinksSource = ql.quickLinks ?? [];
    } catch (error) {
      if ((error as { status?: number }).status !== 404) {
        return {
          ok: false,
          failedDocIds: [QUICK_LINKS_POUCH_ID],
          message: "Could not load quick links for reference cleanup.",
          rollbackStatus: "not_needed",
        };
      }
    }
  }

  const nextQuickLinks = quickLinksSource.map((ql) => {
    if (!ql.presentationInfo) return ql;
    const nextPres = sweepPresentation(
      ql.presentationInfo,
      deletedIds,
      deletedUrls,
      deletedVideoSourceIds,
    );
    if (nextPres === ql.presentationInfo) return ql;
    return { ...ql, presentationInfo: nextPres };
  });
  const quickLinksDirty =
    JSON.stringify(nextQuickLinks) !== JSON.stringify(quickLinksSource);

  if (legacy && (prefsDirty || quickLinksDirty)) {
    const toPut = {
      ...prefsRaw,
      preferences: prefs,
      quickLinks: quickLinksDirty ? nextQuickLinks : quickLinksSource,
      updatedAt: new Date().toISOString(),
    };
    addIfChanged(prefsRaw, toPut);
  } else if (!legacy) {
    if (prefsDirty) {
      const slim = {
        ...prefsRaw,
        preferences: prefs,
        updatedAt: new Date().toISOString(),
      } as DBPreferences;
      addIfChanged(prefsRaw, slim);
    }
    if (quickLinksDirty && quickLinksRaw) {
      const qlDoc = quickLinksRaw as DBQuickLinksDoc;
      addIfChanged(quickLinksRaw, {
        ...qlDoc,
        quickLinks: nextQuickLinks,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  let allDocs: allDocsType;
  try {
    allDocs = (await db.allDocs({ include_docs: true })) as allDocsType;
  } catch (error) {
    return {
      ok: false,
      failedDocIds: [],
      message: "Could not inspect saved media references.",
      rollbackStatus: "not_needed",
    };
  }

  for (const row of allDocs.rows) {
    const doc = row.doc as Record<string, unknown> | undefined;
    if (!doc || !doc._id) continue;
    const id = doc._id as string;

    if (
      id === PREFERENCES_POUCH_ID ||
      id === QUICK_LINKS_POUCH_ID ||
      id === MONITOR_SETTINGS_POUCH_ID ||
      id === MEDIA_ROUTE_FOLDERS_POUCH_ID ||
      isControllerMediaRouteFoldersDocId(id) ||
      isMediaLibraryStorageDoc(doc, id)
    )
      continue;

    const dtype = doc.type as string | undefined;
    if (dtype && ITEM_TYPES.includes(dtype as ItemType)) {
      const item = doc as unknown as DBItem;
      const pb = preferenceDefaultForItemType(item.type);
      let dirty = false;
      let nextItem = normalizeItemSlides({ ...item });

      if (
        item.background &&
        matchesDeleted(deletedIds, deletedUrls, undefined, item.background)
      ) {
        nextItem.background = pb.background;
        dirty = true;
      }

      const arr = [...(nextItem.arrangements || [])];
      let arrDirty = false;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        const ns = sweepSlides(
          a.slides || [],
          pb,
          deletedIds,
          deletedUrls,
          deletedVideoSourceIds,
        );
        if (JSON.stringify(ns) !== JSON.stringify(a.slides)) {
          arr[i] = { ...a, slides: ns };
          arrDirty = true;
        }
      }
      if (arrDirty) {
        nextItem.arrangements = arr;
        dirty = true;
      }

      const nsMain = sweepSlides(
        nextItem.slides || [],
        pb,
        deletedIds,
        deletedUrls,
        deletedVideoSourceIds,
      );
      if (JSON.stringify(nsMain) !== JSON.stringify(nextItem.slides)) {
        nextItem.slides = nsMain;
        dirty = true;
      }

      if (dirty) {
        addIfChanged(item, {
          ...nextItem,
          updatedAt: new Date().toISOString(),
        } as DBItem as unknown as Record<string, unknown>);
      }
      continue;
    }

    if (
      typeof id === "string" &&
      id.startsWith("overlay-") &&
      id !== "overlay-templates" &&
      !id.startsWith("overlay-history") &&
      doc.type === "image"
    ) {
      const ov = doc as unknown as DBOverlay;
      if (
        !matchesDeleted(deletedIds, deletedUrls, undefined, ov.imageUrl || "")
      ) {
        continue;
      }
      addIfChanged(ov as unknown as Record<string, unknown>, {
        ...ov,
        imageUrl: "",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const applied: Array<{ previous: Record<string, unknown>; savedRevision?: string }> = [];
  const rollback = async (): Promise<"complete" | "uncertain"> => {
    let status: "complete" | "uncertain" = "complete";
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const saved = applied[index];
      try {
        const previousDocument = {
          ...saved.previous,
          ...(saved.savedRevision ? { _rev: saved.savedRevision } : {}),
        };
        await db.put(
          previousDocument.type === "song"
            ? normalizeSongForPersistence(previousDocument as unknown as DBItem)
            : previousDocument,
        );
      } catch (error) {
        status = "uncertain";
        console.error("Failed to roll back media deletion reference cleanup:", {
          docId: saved.previous._id,
          error,
        });
      }
    }
    applied.length = 0;
    return status;
  };
  try {
    for (const { previous, next } of pending.values()) {
      const persistedDocument =
        next.type === "song"
          ? normalizeSongForPersistence(next as unknown as DBItem)
          : next;
      const result = (await db.put(persistedDocument)) as { rev?: string };
      applied.push({ previous, savedRevision: result.rev });
    }
  } catch (error) {
    const rollbackStatus = await rollback();
    const failedDocId = error && typeof error === "object" && "id" in error
      ? String((error as { id: unknown }).id)
      : "unknown";
    return {
      ok: false,
      failedDocIds: [failedDocId],
      message: "Could not save media reference cleanup.",
      rollbackStatus,
    };
  }

  return {
    ok: true,
    failedDocIds: [],
    rollbackStatus: "not_needed",
    rollback,
  };
}

/**
 * Replace references to a Media rendition without applying delete-sweep
 * defaults. The replacement is prepared in memory first and previously saved
 * documents are restored when a later put fails, so callers can safely keep
 * the superseded provider asset until this operation reports success.
 */
export async function replaceMediaReferencesForReplacement(
  db: PouchDB.Database,
  replacement: MediaReferenceReplacement,
): Promise<MediaReferenceReplacementResult> {
  const pending = new Map<
    string,
    { previous: Record<string, unknown>; next: Record<string, unknown> }
  >();

  const addIfChanged = (
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
  ) => {
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const id = typeof previous._id === "string" ? previous._id : "";
    if (id) pending.set(id, { previous, next });
  };

  let prefsRaw: Record<string, unknown>;
  try {
    prefsRaw = (await db.get(PREFERENCES_POUCH_ID)) as unknown as Record<
      string,
      unknown
    >;
  } catch {
    return {
      ok: false,
      failedDocIds: [PREFERENCES_POUCH_ID],
      message: "Could not load preferences for Canva media replacement.",
      rollbackStatus: "not_needed",
    };
  }

  const prefs = {
    ...((prefsRaw.preferences ?? {}) as PreferencesType),
  };
  for (const field of [
    "defaultSongBackground",
    "defaultTimerBackground",
    "defaultBibleBackground",
    "defaultFreeFormBackground",
  ] as const) {
    prefs[field] = replaceMediaReferencesInPreference(
      prefs[field],
      replacement,
    );
  }

  const legacy = isLegacyPreferencesDoc(prefsRaw);
  let quickLinksSource: QuickLinkType[] = [];
  let quickLinksDoc: Record<string, unknown> | undefined;
  if (legacy) {
    quickLinksSource = (prefsRaw.quickLinks as QuickLinkType[]) ?? [];
  } else {
    try {
      quickLinksDoc = (await db.get(QUICK_LINKS_POUCH_ID)) as Record<
        string,
        unknown
      >;
      quickLinksSource = (quickLinksDoc?.quickLinks as QuickLinkType[]) ?? [];
    } catch (error) {
      if ((error as { status?: number }).status !== 404) {
        return {
          ok: false,
          failedDocIds: [QUICK_LINKS_POUCH_ID],
          message: "Could not load quick links for Canva media replacement.",
          rollbackStatus: "not_needed",
        };
      }
    }
  }
  const nextQuickLinks = replaceMediaReferencesInQuickLinks(
    quickLinksSource,
    replacement,
  );
  const nextPrefsRaw: Record<string, unknown> = {
    ...prefsRaw,
    preferences: prefs,
  };
  if (legacy) nextPrefsRaw.quickLinks = nextQuickLinks;
  addIfChanged(prefsRaw, nextPrefsRaw);
  if (quickLinksDoc) {
    addIfChanged(quickLinksDoc, {
      ...quickLinksDoc,
      quickLinks: nextQuickLinks,
    });
  }

  let allDocs: allDocsType;
  try {
    allDocs = (await db.allDocs({ include_docs: true })) as allDocsType;
  } catch {
    return {
      ok: false,
      failedDocIds: [],
      message: "Could not inspect saved Canva media references.",
      rollbackStatus: "not_needed",
    };
  }

  for (const row of allDocs.rows) {
    const doc = row.doc as unknown as Record<string, unknown> | undefined;
    if (!doc || typeof doc._id !== "string") continue;
    const id = doc._id;
    if (
      id === PREFERENCES_POUCH_ID ||
      id === QUICK_LINKS_POUCH_ID ||
      id === MONITOR_SETTINGS_POUCH_ID ||
      id === MEDIA_ROUTE_FOLDERS_POUCH_ID ||
      isControllerMediaRouteFoldersDocId(id) ||
      isMediaLibraryStorageDoc(doc, id)
    ) {
      continue;
    }

    const dtype = doc.type as string | undefined;
    if (
      dtype &&
      ITEM_TYPES.includes(dtype as ItemType) &&
      !id.startsWith("overlay-")
    ) {
      addIfChanged(
        doc,
        replaceMediaReferencesInItem(doc as unknown as DBItem, replacement) as unknown as Record<string, unknown>,
      );
      continue;
    }

    if (
      id.startsWith("overlay-") &&
      id !== "overlay-templates" &&
      !id.startsWith("overlay-history") &&
      doc.type === "image" &&
      mediaReferenceMatches(
        replacement.oldMedia,
        undefined,
        String(doc.imageUrl || ""),
      )
    ) {
      addIfChanged(doc, {
        ...doc,
        imageUrl: replacement.newMedia.background,
      });
    }
  }

  const applied: Array<{
    previous: Record<string, unknown>;
    savedRevision?: string;
  }> = [];
  try {
    for (const { previous, next } of pending.values()) {
      const nextDocument: Record<string, unknown> = {
        ...next,
        updatedAt: new Date().toISOString(),
      };
      const persistedDocument =
        nextDocument.type === "song"
          ? normalizeSongForPersistence(nextDocument as unknown as DBItem)
          : nextDocument;
      const result = (await db.put(persistedDocument)) as { rev?: string };
      applied.push({ previous, savedRevision: result.rev });
    }
  } catch (error) {
    let rollbackStatus: MediaReferenceReplacementResult["rollbackStatus"] =
      "complete";
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const saved = applied[index];
      try {
        const previousDocument: Record<string, unknown> = {
          ...saved.previous,
          ...(saved.savedRevision ? { _rev: saved.savedRevision } : {}),
        };
        const rollbackDocument =
          previousDocument.type === "song"
            ? normalizeSongForPersistence(previousDocument as unknown as DBItem)
            : previousDocument;
        await db.put(rollbackDocument);
      } catch (rollbackError) {
        rollbackStatus = "uncertain";
        console.error("Failed to roll back Canva media reference replacement:", {
          rollbackError,
          docId: saved.previous._id,
        });
      }
    }
    const failedDocId =
      error && typeof error === "object" && "id" in error
        ? String((error as { id: unknown }).id)
        : "unknown";
    return {
      ok: false,
      failedDocIds: [failedDocId],
      message: "Could not save Canva media reference replacement.",
      rollbackStatus,
    };
  }

  const updatedDocs = [...pending.values()].map(({ next }) => next);
  return {
    ok: true,
    failedDocIds: [],
    rollbackStatus: "not_needed",
    updatedDocs,
  };
}
