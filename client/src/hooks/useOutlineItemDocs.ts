import { loadSong } from "../utils/songPersistence";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useDispatch, useSelector } from "./reduxHooks";
import { upsertItemsInAllDocs } from "../store/allDocsSlice";
import type { DBItem } from "../types";
import { mergeDocsById } from "../utils/outlineSlideSections";

const EMPTY_ALL_DOCS = {
  allSongDocs: [] as DBItem[],
  allFreeFormDocs: [] as DBItem[],
  allTimerDocs: [] as DBItem[],
  allBibleDocs: [] as DBItem[],
};

type PouchAllDocsResult = {
  rows?: Array<{
    id?: string;
    key?: string;
    error?: string;
    doc?: DBItem;
  }>;
};

export const useOutlineItemDocs = (prefetchIds: string[]) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) || {};
  const allDocs = useSelector((state) => state.allDocs) ?? EMPTY_ALL_DOCS;
  const [extraDocs, setExtraDocs] = useState<Map<string, DBItem>>(
    () => new Map(),
  );
  const cacheDbRef = useRef(db);
  const loadedProjectionRefs = useRef(new Map<string, DBItem>());
  const extraDocsRef = useRef(extraDocs);
  extraDocsRef.current = extraDocs;

  const docsById = useMemo(
    () => {
      const merged = mergeDocsById(allDocs, cacheDbRef.current === db ? extraDocs : undefined);
      for (const projection of allDocs.allSongDocs) {
        if (projection.docType === "song-v2-root" && cacheDbRef.current === db) {
          const exact = extraDocs.get(projection._id);
          if (exact) merged.set(projection._id, exact);
        }
      }
      return merged;
    },
    [allDocs, db, extraDocs],
  );

  useEffect(() => {
    if (cacheDbRef.current === db) return;
    cacheDbRef.current = db;
    loadedProjectionRefs.current.clear();
    extraDocsRef.current = new Map();
    setExtraDocs(new Map());
  }, [db]);

  const prefetchKey = prefetchIds.join("\0");

  useEffect(() => {
    if (!db || !prefetchKey) return;
    const ids = prefetchKey.split("\0");
    const missing = ids.filter((id) => {
      const projection = allDocs.allSongDocs.find((doc) => doc._id === id && doc.docType === "song-v2-root");
      if (projection) return loadedProjectionRefs.current.get(id) !== projection;
      if (docsById.has(id)) return false;
      return !extraDocsRef.current.has(id);
    });
    if (missing.length === 0) return;

    let cancelled = false;
    const fetchMisses = async () => {
      try {
        const projections = new Map(allDocs.allSongDocs.filter((doc) => doc.docType === "song-v2-root").map((doc) => [doc._id, doc]));
        const ordinaryIds = missing.filter((id) => !projections.has(id));
        const result = ordinaryIds.length
          ? (await db.allDocs({ keys: ordinaryIds, include_docs: true })) as PouchAllDocsResult
          : { rows: [] };
        const rowsById = new Map((result.rows ?? []).map((row) => [row.id ?? row.key ?? row.doc?._id, row]));
        const loads = await Promise.allSettled(missing.map(async (id) => {
          const row = rowsById.get(id);
          if (projections.has(id) || !row?.doc || row.doc.type === "song") return loadSong(db, id);
          return row.doc;
        }));
        if (cancelled) return;
        const fetchedDocs: DBItem[] = [];
        const nextExtras = new Map(extraDocsRef.current);
        loads.forEach((load, index) => {
          if (load.status !== "fulfilled") {
            console.error("Could not load outline item", missing[index], load.reason);
            return;
          }
          const doc = load.value;
          if (!doc?._id) return;
          // Exact v2 content is local to this outline preview, never the library.
          if (doc.docType !== "song-v2-root") fetchedDocs.push(doc);
          nextExtras.set(doc._id, doc);
          const projection = projections.get(doc._id);
          if (projection) loadedProjectionRefs.current.set(doc._id, projection);
        });
        if (fetchedDocs.length > 0) {
          dispatch(upsertItemsInAllDocs(fetchedDocs));
        }
        if (loads.some((load) => load.status === "fulfilled" && load.value?._id)) {
          extraDocsRef.current = nextExtras;
          setExtraDocs(nextExtras);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      }
    };
    void fetchMisses();

    return () => {
      cancelled = true;
    };
  }, [allDocs, db, dispatch, docsById, prefetchKey]);

  return docsById;
};
