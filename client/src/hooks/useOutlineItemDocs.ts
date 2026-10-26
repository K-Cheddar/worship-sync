import { useContext, useEffect, useMemo } from "react";
import { useStore } from "react-redux";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useDispatch, useSelector } from "./reduxHooks";
import { applyItemDocumentChange } from "../store/allDocsSlice";
import type { RootState } from "../store/store";
import { isItemDocument } from "../store/itemCacheSync";
import { buildDocsById } from "../utils/outlineSlideSections";

export const useOutlineItemDocs = (prefetchIds: string[]) => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db } = useContext(ControllerInfoContext) || {};
  const allDocs = useSelector((state) => state.allDocs);
  const docsById = useMemo(() => buildDocsById(allDocs), [allDocs]);
  const prefetchKey = prefetchIds.join("\0");

  useEffect(() => {
    if (!db || !allDocs.isInitialized || !prefetchKey) return;
    const missing = prefetchKey.split("\0").filter((id) => !docsById.has(id));
    if (!missing.length) return;
    let cancelled = false;
    const fetchMisses = async () => {
      try {
        const result = await db.allDocs({ keys: missing, include_docs: true });
        // Compare the actual store, not the last rendered props. A tombstone,
        // newer feed event or session reset always invalidates an older read.
        if (cancelled || store.getState().allDocs !== allDocs) return;
        for (const row of result.rows) {
          if ("doc" in row && isItemDocument(row.doc)) {
            dispatch(applyItemDocumentChange({ id: row.doc._id, doc: row.doc }));
          }
        }
      } catch (error) {
        if (!cancelled) console.error(error);
      }
    };
    void fetchMisses();
    return () => { cancelled = true; };
  }, [db, allDocs, docsById, prefetchKey, dispatch, store]);

  return docsById;
};
