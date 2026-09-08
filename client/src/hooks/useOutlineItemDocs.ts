import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useDispatch, useSelector } from "./reduxHooks";
import { upsertItemInAllDocs } from "../store/allDocsSlice";
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
  const extraDocsRef = useRef(extraDocs);
  extraDocsRef.current = extraDocs;

  const docsById = useMemo(
    () => mergeDocsById(allDocs, extraDocs),
    [allDocs, extraDocs],
  );

  const prefetchKey = prefetchIds.join("\0");
  const inFlightKeyRef = useRef("");

  useEffect(() => {
    if (!db || !prefetchKey) return;
    const ids = prefetchKey.split("\0");
    const missing = ids.filter((id) => {
      if (docsById.has(id)) return false;
      return !extraDocsRef.current.has(id);
    });
    if (missing.length === 0) return;

    const requestKey = missing.join("\0");
    if (inFlightKeyRef.current === requestKey) return;
    inFlightKeyRef.current = requestKey;

    let cancelled = false;
    const fetchMisses = async () => {
      try {
        const result = (await db.allDocs({
          keys: missing,
          include_docs: true,
        })) as PouchAllDocsResult;
        if (cancelled) return;
        const nextExtras = new Map(extraDocsRef.current);
        for (const row of result.rows ?? []) {
          const doc = row.doc;
          if (!doc || row.error || !doc._id) continue;
          dispatch(upsertItemInAllDocs(doc));
          nextExtras.set(doc._id, doc);
        }
        extraDocsRef.current = nextExtras;
        setExtraDocs(nextExtras);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      } finally {
        if (!cancelled && inFlightKeyRef.current === requestKey) {
          inFlightKeyRef.current = "";
        }
      }
    };
    void fetchMisses();

    return () => {
      cancelled = true;
    };
  }, [db, dispatch, docsById, prefetchKey]);

  return docsById;
};
