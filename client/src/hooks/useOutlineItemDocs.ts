import { useContext, useEffect, useMemo } from "react";
import { useStore } from "react-redux";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useDispatch, useSelector } from "./reduxHooks";
import { applyItemDocumentChange } from "../store/allDocsSlice";
import type { RootState } from "../store/store";
import { buildDocsById } from "../utils/outlineSlideSections";
import { readCurrentItemDocuments } from "../utils/readCurrentItemDocuments";

export const useOutlineItemDocs = (prefetchIds: string[]) => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db } = useContext(ControllerInfoContext) || {};
  const allDocs = useSelector((state) => state.allDocs);
  const docsById = useMemo(() => buildDocsById(allDocs), [allDocs]);
  const prefetchKey = prefetchIds.join("\0");
  const { isInitialized, session } = allDocs;

  useEffect(() => {
    if (!db || !isInitialized || !prefetchKey) return;
    const currentCache = store.getState().allDocs;
    if (currentCache.session !== session) return;
    const cachedDocsById = buildDocsById(currentCache);
    const missing = prefetchKey.split("\0").filter((id) => !cachedDocsById.has(id));
    if (!missing.length) return;
    let cancelled = false;
    const fetchMisses = async () => {
      try {
        const documents = await readCurrentItemDocuments(db, missing);
        const latestCache = store.getState().allDocs;
        if (cancelled || latestCache.session !== session) return;
        const latestDocsById = buildDocsById(latestCache);
        for (const id of missing) {
          // A live cache update that arrived during the read already owns this ID.
          if (latestDocsById.has(id)) continue;
          const doc = documents.get(id);
          if (doc) dispatch(applyItemDocumentChange({ id, doc }));
        }
      } catch (error) {
        if (!cancelled) console.error(error);
      }
    };
    void fetchMisses();
    return () => { cancelled = true; };
  }, [db, isInitialized, session, prefetchKey, dispatch, store]);

  return docsById;
};
