import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "react-redux";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useDispatch, useSelector } from "./reduxHooks";
import { applyItemDocumentChange } from "../store/allDocsSlice";
import type { RootState } from "../store/store";
import type { DBItem } from "../types";
import { buildDocsById } from "../utils/outlineSlideSections";
import { readCurrentItemDocuments } from "../utils/readCurrentItemDocuments";
import { loadSong } from "../utils/songPersistence";

export const useOutlineItemDocs = (prefetchIds: string[]) => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db } = useContext(ControllerInfoContext) || {};
  const allDocs = useSelector((state) => state.allDocs);
  const songContentVersions = useSelector((state) => state.allDocs.songContentVersions);
  const { isInitialized, session } = allDocs;
  const [extraDocs, setExtraDocs] = useState<Map<string, DBItem>>(() => new Map());
  const cacheDbRef = useRef(db);
  const cacheSessionRef = useRef(session);
  const activeDbRef = useRef(db);
  activeDbRef.current = db;
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  const loadedProjectionRefs = useRef(new Map<string, DBItem>());
  const loadedProjectionVersionsRef = useRef(new Map<string, number>());
  const extraDocsRef = useRef(extraDocs);
  extraDocsRef.current = extraDocs;

  // Repeated songs in one outline need one document lease/read, not one per occurrence.
  const prefetchKey = [...new Set(prefetchIds)].join("\0");
  const activePrefetchIds = useMemo(
    () => new Set(prefetchKey ? prefetchKey.split("\0") : []),
    [prefetchKey],
  );
  const activePrefetchIdsRef = useRef(activePrefetchIds);
  activePrefetchIdsRef.current = activePrefetchIds;

  const docsById = useMemo(() => {
    const merged = buildDocsById(allDocs);
    if (cacheDbRef.current === db && cacheSessionRef.current === session) {
      for (const projection of allDocs.allSongDocs) {
        if (projection.docType !== "song-v2-root") continue;
        const exact = extraDocs.get(projection._id);
        if (exact && loadedProjectionRefs.current.get(projection._id) === projection) {
          merged.set(projection._id, exact);
        }
      }
    }
    return merged;
  }, [allDocs, db, extraDocs, session]);

  useEffect(() => {
    if (cacheDbRef.current !== db || cacheSessionRef.current !== session) {
      cacheDbRef.current = db;
      cacheSessionRef.current = session;
      loadedProjectionRefs.current.clear();
      loadedProjectionVersionsRef.current.clear();
      extraDocsRef.current = new Map();
      setExtraDocs(new Map());
      return;
    }

    const nextExtraDocs = new Map(extraDocsRef.current);
    let removedExtraDocs = false;
    for (const id of nextExtraDocs.keys()) {
      if (activePrefetchIds.has(id)) continue;
      nextExtraDocs.delete(id);
      removedExtraDocs = true;
    }
    for (const id of loadedProjectionRefs.current.keys()) {
      if (activePrefetchIds.has(id)) continue;
      loadedProjectionRefs.current.delete(id);
      loadedProjectionVersionsRef.current.delete(id);
    }
    if (removedExtraDocs) {
      extraDocsRef.current = nextExtraDocs;
      setExtraDocs(nextExtraDocs);
    }
  }, [activePrefetchIds, db, session]);

  const songContentKey = prefetchKey
    .split("\0")
    .map((id) => `${id}:${songContentVersions[id] ?? 0}`)
    .join("\0");

  useEffect(() => {
    if (!db || !isInitialized || !prefetchKey) return;
    const currentCache = store.getState().allDocs;
    if (currentCache.session !== session) return;
    const cachedDocsById = buildDocsById(currentCache);
    const projections = new Map(
      currentCache.allSongDocs
        .filter((doc) => doc.docType === "song-v2-root")
        .map((doc) => [doc._id, doc]),
    );
    const contentVersionsAtRead = new Map(
      prefetchKey.split("\0").map((id) => [id, currentCache.songContentVersions[id] ?? 0]),
    );
    const missing = prefetchKey.split("\0").filter((id) => {
      const projection = projections.get(id);
      if (projection) return loadedProjectionRefs.current.get(id) !== projection ||
        loadedProjectionVersionsRef.current.get(id) !== (currentCache.songContentVersions[id] ?? 0);
      if (cachedDocsById.has(id)) return false;
      return !extraDocsRef.current.has(id);
    });
    if (!missing.length) return;

    let cancelled = false;
    const fetchMisses = async () => {
      try {
        const ordinaryIds = missing.filter((id) => !projections.has(id));
        const documents = ordinaryIds.length
          ? await readCurrentItemDocuments(db, ordinaryIds)
          : new Map<string, DBItem>();
        const loads = await Promise.allSettled(missing.map(async (id) => {
          const projection = projections.get(id);
          const doc = projection ?? documents.get(id);
          if (projection) return loadSong(db, id);
          return doc;
        }));
        const latestCache = store.getState().allDocs;
        if (
          cancelled ||
          latestCache.session !== session ||
          cacheDbRef.current !== db ||
          activeDbRef.current !== db ||
          activeSessionRef.current !== session
        ) return;

        const latestDocsById = buildDocsById(latestCache);
        const nextExtras = new Map(extraDocsRef.current);
        let extrasChanged = false;
        loads.forEach((load, index) => {
          const id = missing[index];
          if (!activePrefetchIdsRef.current.has(id)) return;
          if (load.status !== "fulfilled") {
            console.error("Could not load outline item", id, load.reason);
            return;
          }
          const doc = load.value;
          if (!doc?._id) return;
          if (doc.docType === "song-v2-root" && doc.type === "song") {
            // Exact v2 content is local to this preview and never enters the library cache.
            const projection = projections.get(id);
            const currentProjection = latestCache.allSongDocs.find((candidate) => candidate._id === id);
            if (!projection || currentProjection !== projection) return;
            if ((latestCache.songContentVersions[id] ?? 0) !== contentVersionsAtRead.get(id)) return;
            nextExtras.set(id, doc);
            loadedProjectionRefs.current.set(id, projection);
            loadedProjectionVersionsRef.current.set(id, contentVersionsAtRead.get(id) ?? 0);
            extrasChanged = true;
            return;
          }
          // A live cache update that arrived during the read already owns this ID.
          if (latestDocsById.has(id)) return;
          dispatch(applyItemDocumentChange({ id, doc }));
        });
        if (extrasChanged) {
          extraDocsRef.current = nextExtras;
          setExtraDocs(nextExtras);
        }
      } catch (error) {
        if (!cancelled) console.error(error);
      }
    };
    void fetchMisses();
    return () => { cancelled = true; };
  }, [activePrefetchIds, allDocs.allSongDocs, db, dispatch, isInitialized, prefetchKey, session, songContentKey, store]);

  return docsById;
};
