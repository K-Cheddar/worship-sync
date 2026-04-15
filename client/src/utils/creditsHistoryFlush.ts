import type { AppDispatch, RootState } from "../store/store";
import {
  mergeVisibleCreditsIntoHistory,
  syncVisibleCreditsMirrorAndHistory,
} from "../store/creditsSlice";
import { putCreditHistoryDocs } from "./dbUtils";

type CreditsDb = Parameters<typeof putCreditHistoryDocs>[0];

/**
 * Merge visible credit rows into `creditsHistory`, update `liveCredits` in Redux, and persist
 * changed history headings to Pouch. Call after the credits `list` reflects the latest edits
 * (e.g. heading/text blur on a credit row).
 */
export async function flushCreditsHistoryFromLatestList(
  dispatch: AppDispatch,
  getState: () => RootState,
  db: CreditsDb | undefined,
): Promise<void> {
  const credits = getState().undoable.present.credits;
  if (!credits.isInitialized) return;

  const prevHistory = credits.creditsHistory ?? {};
  const visible = credits.list.filter((c) => !c.hidden);
  const merged = mergeVisibleCreditsIntoHistory(prevHistory, visible);
  const uniqueHeadings = [
    ...new Set(visible.map((c) => c.heading.trim()).filter(Boolean)),
  ];
  const headingsToSave = uniqueHeadings.filter(
    (h) => JSON.stringify(merged[h]) !== JSON.stringify(prevHistory[h]),
  );

  dispatch(syncVisibleCreditsMirrorAndHistory());

  if (!db || headingsToSave.length === 0) return;

  const historyAfter = getState().undoable.present.credits.creditsHistory ?? {};
  try {
    await putCreditHistoryDocs(db, historyAfter, headingsToSave);
  } catch (e) {
    console.error("putCreditHistoryDocs failed", e);
  }
}
