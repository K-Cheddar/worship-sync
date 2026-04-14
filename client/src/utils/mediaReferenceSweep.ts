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
import {
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
} from "../types";
import { isLegacyPreferencesDoc } from "./dbUtils";
import type { allDocsType } from "../types";

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
): ItemSlideType {
  const mapBoxes = (boxes: Box[]) =>
    boxes.map((b) => resetBoxIfMatch(b, pb, deletedIds, deletedUrls));
  return {
    ...slide,
    boxes: mapBoxes(slide.boxes),
    monitorCurrentBandBoxes: slide.monitorCurrentBandBoxes
      ? mapBoxes(slide.monitorCurrentBandBoxes)
      : slide.monitorCurrentBandBoxes,
    monitorNextBandBoxes: slide.monitorNextBandBoxes
      ? mapBoxes(slide.monitorNextBandBoxes)
      : slide.monitorNextBandBoxes,
  };
}

function sweepSlides(
  slides: ItemSlideType[],
  pb: PreferenceBackground,
  deletedIds: Set<string>,
  deletedUrls: Set<string>,
): ItemSlideType[] {
  return slides.map((s) => sweepSlide(s, pb, deletedIds, deletedUrls));
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
): Presentation | undefined {
  if (!pres) return pres;
  const pb = preferenceDefaultForItemType("song");
  let next: Presentation = { ...pres };
  if (pres.slide) {
    next = {
      ...next,
      slide: sweepSlide(pres.slide, pb, deletedIds, deletedUrls),
    };
  }
  if (pres.nextSlide) {
    next = {
      ...next,
      nextSlide: sweepSlide(pres.nextSlide, pb, deletedIds, deletedUrls),
    };
  }
  next = {
    ...next,
    participantOverlayInfo: sweepOverlayInfo(
      pres.participantOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
    stbOverlayInfo: sweepOverlayInfo(
      pres.stbOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
    qrCodeOverlayInfo: sweepOverlayInfo(
      pres.qrCodeOverlayInfo,
      deletedIds,
      deletedUrls,
    ),
    imageOverlayInfo: sweepOverlayInfo(
      pres.imageOverlayInfo,
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
};

function buildDeletedUrlSet(rows: MediaType[]): Set<string> {
  const s = new Set<string>();
  for (const m of rows) {
    if (m.background) s.add(stripUrlQuery(m.background));
    if (m.thumbnail) s.add(stripUrlQuery(m.thumbnail));
    if (m.placeholderImage) s.add(stripUrlQuery(m.placeholderImage));
  }
  return s;
}

/**
 * Before removing media rows from the library: reset references in preferences, items, overlays, quick links.
 * Aborts without partial writes if any `put` fails (caller should not proceed to delete assets).
 */
export async function sweepMediaReferencesBeforeDelete(
  db: PouchDB.Database,
  deletedIds: Set<string>,
  deletedRows: MediaType[],
): Promise<MediaReferenceSweepResult> {
  if (deletedIds.size === 0) return { ok: true, failedDocIds: [] };

  const deletedUrls = buildDeletedUrlSet(deletedRows);
  const failedDocIds: string[] = [];

  let prefsRaw: Record<string, unknown>;
  try {
    prefsRaw = (await db.get(PREFERENCES_POUCH_ID)) as unknown as Record<
      string,
      unknown
    >;
  } catch {
    return {
      ok: false,
      failedDocIds: [],
      message: "Could not load preferences for reference cleanup.",
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
  if (legacy) {
    quickLinksSource = (prefsRaw.quickLinks as QuickLinkType[]) ?? [];
  } else {
    try {
      const ql = (await db.get(QUICK_LINKS_POUCH_ID)) as DBQuickLinksDoc;
      quickLinksSource = ql.quickLinks ?? [];
    } catch {
      quickLinksSource = [];
    }
  }

  const nextQuickLinks = quickLinksSource.map((ql) => {
    if (!ql.presentationInfo) return ql;
    const nextPres = sweepPresentation(
      ql.presentationInfo,
      deletedIds,
      deletedUrls,
    );
    if (nextPres === ql.presentationInfo) return ql;
    return { ...ql, presentationInfo: nextPres };
  });
  const quickLinksDirty =
    JSON.stringify(nextQuickLinks) !== JSON.stringify(quickLinksSource);

  const now = new Date().toISOString();

  if (legacy && (prefsDirty || quickLinksDirty)) {
    const toPut = {
      ...prefsRaw,
      preferences: prefs,
      quickLinks: quickLinksDirty ? nextQuickLinks : quickLinksSource,
      updatedAt: now,
    };
    try {
      await db.put(toPut);
    } catch (e) {
      console.error(e);
      return {
        ok: false,
        failedDocIds: [PREFERENCES_POUCH_ID],
        message: "Failed to save preferences after reference cleanup.",
      };
    }
  } else if (!legacy) {
    if (prefsDirty) {
      const slim = {
        ...prefsRaw,
        preferences: prefs,
        updatedAt: now,
      } as DBPreferences;
      try {
        await db.put(slim);
      } catch (e) {
        console.error(e);
        return {
          ok: false,
          failedDocIds: [PREFERENCES_POUCH_ID],
          message: "Failed to save preferences after reference cleanup.",
        };
      }
    }
    if (quickLinksDirty) {
      try {
        const qlDoc = (await db.get(QUICK_LINKS_POUCH_ID)) as DBQuickLinksDoc;
        await db.put({
          ...qlDoc,
          quickLinks: nextQuickLinks,
          updatedAt: now,
        });
      } catch (e) {
        console.error(e);
        return {
          ok: false,
          failedDocIds: [QUICK_LINKS_POUCH_ID],
          message: "Failed to save quick links after reference cleanup.",
        };
      }
    }
  }

  const allDocs = (await db.allDocs({
    include_docs: true,
  })) as allDocsType;

  for (const row of allDocs.rows) {
    const doc = row.doc as Record<string, unknown> | undefined;
    if (!doc || !doc._id) continue;
    const id = doc._id as string;

    if (
      id === PREFERENCES_POUCH_ID ||
      id === QUICK_LINKS_POUCH_ID ||
      id === MONITOR_SETTINGS_POUCH_ID ||
      id === MEDIA_ROUTE_FOLDERS_POUCH_ID ||
      id === "media"
    )
      continue;

    const dtype = doc.type as string | undefined;
    if (dtype && ITEM_TYPES.includes(dtype as ItemType)) {
      const item = doc as unknown as DBItem;
      const pb = preferenceDefaultForItemType(item.type);
      let dirty = false;
      let nextItem = { ...item };

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
        const ns = sweepSlides(a.slides || [], pb, deletedIds, deletedUrls);
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
      );
      if (JSON.stringify(nsMain) !== JSON.stringify(nextItem.slides)) {
        nextItem.slides = nsMain;
        dirty = true;
      }

      if (dirty) {
        try {
          await db.put({
            ...nextItem,
            updatedAt: new Date().toISOString(),
          } as DBItem);
        } catch (e) {
          console.error(e);
          failedDocIds.push(id);
        }
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
      try {
        await db.put({
          ...ov,
          imageUrl: "",
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.error(e);
        failedDocIds.push(id);
      }
    }
  }

  if (failedDocIds.length > 0) {
    return {
      ok: false,
      failedDocIds,
      message: `Reference cleanup failed for: ${failedDocIds.join(", ")}`,
    };
  }

  return { ok: true, failedDocIds: [] };
}
