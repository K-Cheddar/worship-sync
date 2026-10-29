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
  const [extraDocs, setExtraDocs] = useState<Map<string, DBItem>>(() => new Map());
  const cacheDbRef = useRef(db);
  const loadedProjectionRefs = useRef(new Map<string, DBItem>());
  const extraDocsRef = useRef(extraDocs);
  extraDocsRef.current = extraDocs;

  const docsById = useMemo(() => {
    const merged = buildDocsById(allDocs);
    if (cacheDbRef.current === db) {
      for (const projection of allDocs.allSongDocs) {
        if (projection.docType !== "song-v2-root") continue;
        const exact = extraDocs.get(projection._id);
        if (exact && loadedProjectionRefs.current.get(projection._id) === projection) {
          merged.set(projection._id, exact);
        }
      }
    }
    return merged;
  }, [allDocs, db, extraDocs]);

  useEffect(() => {
    if (cacheDbRef.current === db) return;
    cacheDbRef.current = db;
    loadedProjectionRefs.current.clear();
    extraDocsRef.current = new Map();
    setExtraDocs(new Map());
  }, [db]);

  const prefetchKey = prefetchIds.join("\0");
  const { isInitialized, session } = allDocs;

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
    const missing = prefetchKey.split("\0").filter((id) => {
      const projection = projections.get(id);
      if (projection) return loadedProjectionRefs.current.get(id) !== projection;
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
        if (cancelled || latestCache.session !== session || cacheDbRef.current !== db) return;

        const latestDocsById = buildDocsById(latestCache);
        const nextExtras = new Map(extraDocsRef.current);
        let extrasChanged = false;
        loads.forEach((load, index) => {
          const id = missing[index];
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
            nextExtras.set(id, doc);
            loadedProjectionRefs.current.set(id, projection);
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
  }, [allDocs.allSongDocs, db, dispatch, isInitialized, prefetchKey, session, store]);

  return docsById;
};
