import { useCallback, useContext } from "react";
import { useStore } from "react-redux";
import { useDispatch } from "../hooks";
import { getNamesFromUrl } from "../containers/Overlays/eventParser";
import { mapServicePlanningRows } from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import { getChangedOverlayPatch } from "../integrations/servicePlanning/buildServicePlanningPreview";
import { findOverlayForServicePlanningCandidate } from "../integrations/servicePlanning/findBestOverlayMatch";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";
import {
  markOverlayPersisted,
  selectOverlay,
  setHasPendingUpdate as setOverlayHasPendingUpdate,
} from "../store/overlaySlice";
import {
  addExistingOverlayToList,
  updateList as updateOverlayList,
  updateOverlayInList,
} from "../store/overlaysSlice";
import {
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  applyServicePlanningOverlayPatch,
  findParticipantTemplateForSync,
  persistNewParticipantOverlay,
  persistNewParticipantOverlayClone,
} from "../integrations/servicePlanning/servicePlanningOverlayClone";
import { moveOverlayAfterServicePlanningAnchor } from "../integrations/servicePlanning/servicePlanningOverlayOrder";
import generateRandomId from "../utils/generateRandomId";
import type { OverlayInfo } from "../types";
import type { RootState } from "../store/store";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";
import {
  getConfiguredDefaultFormatting,
  normalizeOverlayForSync,
} from "../utils/overlayUtils";

type ServicePlanningSyncResult = {
  updated: number;
  skipped: number;
  reasons: string[];
};

const OVERLAY_SELECTION_SCROLL_DELAY_MS = 500;

export const useServicePlanningSync = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db } = useContext(ControllerInfoContext) || {};
  const { churchIntegrations, churchIntegrationsStatus } =
    useContext(GlobalInfoContext) || {};

  const applyPersistedOverlayUpdate = useCallback(
    (overlay: OverlayInfo, options: { select?: boolean } = {}) => {
      const normalized = normalizeOverlayForSync(overlay);
      dispatch(updateOverlayInList(normalized));

      const selectedOverlayId =
        store.getState().undoable.present.overlay.selectedOverlay?.id;
      if (options.select || selectedOverlayId === normalized.id) {
        dispatch(setOverlayHasPendingUpdate(false));
        dispatch(selectOverlay(normalized));
        dispatch(markOverlayPersisted(normalized));
      }
    },
    [dispatch, store],
  );

  const placeNewOverlayAfterAnchor = useCallback(
    (overlayId: string, insertAfterId?: string): boolean => {
      const list = store.getState().undoable.present.overlays.list;
      const next = moveOverlayAfterServicePlanningAnchor(
        list,
        overlayId,
        insertAfterId,
      );
      if (next === list) return false;
      dispatch(updateOverlayList(next));
      return true;
    },
    [dispatch, store],
  );

  const runServicePlanningSync = useCallback(
    async (url: string): Promise<ServicePlanningSyncResult> => {
      if (!url?.trim()) {
        return { updated: 0, skipped: 0, reasons: ["Missing URL."] };
      }
      if (churchIntegrationsStatus !== "ready" || !churchIntegrations) {
        return { updated: 0, skipped: 0, reasons: ["Integrations not ready."] };
      }
      const sp = churchIntegrations.servicePlanning;
      if (!sp.enabled) {
        return {
          updated: 0,
          skipped: 0,
          reasons: ["Service Planning is off."],
        };
      }

      const rows = await getNamesFromUrl(url);
      const mapped = mapServicePlanningRows(rows, sp);

      let updated = 0;
      let skipped = 0;
      const reasons: string[] = [];
      /** One overlay per candidate per sync; avoids two Co-Host roles updating the same row. */
      const usedOverlayIds = new Set<string>();
      let overlayAnchorId: string | undefined;

      for (const block of mapped) {
        for (const cand of block.candidates) {
          const list = store.getState().undoable.present.overlays.list;
          const resolution = findOverlayForServicePlanningCandidate(
            block.source.elementType,
            cand.patch.event,
            list,
            usedOverlayIds,
          );
          if (resolution.kind === "ambiguous") {
            skipped += 1;
            reasons.push(
              `More than one overlay could match "${cand.patch.event || block.source.elementType}". Adjust the event mapping before syncing this item.`,
            );
            continue;
          }
          const target = resolution.kind === "match" ? resolution.overlay : null;

          if (!target) {
            const template = findParticipantTemplateForSync(
              list,
              cand.patch.event,
            );
            if (template) {
              const newId = generateRandomId();
              const { templatesByType, defaultTemplateIdsByType } =
                store.getState().undoable.present.overlayTemplates;
              const built = buildClonedParticipantOverlay(
                template,
                cand.patch,
                newId,
                getConfiguredDefaultFormatting(
                  "participant",
                  templatesByType,
                  defaultTemplateIdsByType,
                ),
              );
              await persistNewParticipantOverlayClone(
                db,
                template.id,
                newId,
                cand.patch,
                built,
              );
              dispatch(
                addExistingOverlayToList({
                  overlay: built,
                  insertAfterId: template.id,
                }),
              );
              placeNewOverlayAfterAnchor(newId, overlayAnchorId);
              overlayAnchorId = newId;
              usedOverlayIds.add(newId);
              updated += 1;
              continue;
            }

            const newId = generateRandomId();
            const { templatesByType, defaultTemplateIdsByType } =
              store.getState().undoable.present.overlayTemplates;
            const newOverlay = buildNewParticipantOverlay(
              cand.patch,
              newId,
              getConfiguredDefaultFormatting(
                "participant",
                templatesByType,
                defaultTemplateIdsByType,
              ),
            );
            await persistNewParticipantOverlay(db, newOverlay);
            dispatch(addExistingOverlayToList({ overlay: newOverlay }));
            placeNewOverlayAfterAnchor(newId, overlayAnchorId);
            overlayAnchorId = newId;
            usedOverlayIds.add(newId);
            updated += 1;
            reasons.push(
              `Created overlay for "${cand.patch.event || block.source.elementType}"`,
            );
            continue;
          }

          const changedPatch = getChangedOverlayPatch(target, cand.patch);
          if (Object.keys(changedPatch).length === 0) {
            usedOverlayIds.add(target.id);
            skipped += 1;
            continue;
          }
          const next = applyServicePlanningOverlayPatch(target, cand.patch);
          dispatch(setOverlayHasPendingUpdate(false));
          dispatch(selectOverlay(target));
          await new Promise((resolve) =>
            setTimeout(resolve, OVERLAY_SELECTION_SCROLL_DELAY_MS),
          );
          if (db) {
            const persisted = await persistExistingOverlayDoc(db, {
              id: target.id,
              ...changedPatch,
            } as OverlayInfo);
            applyPersistedOverlayUpdate(persisted, { select: true });
          } else {
            applyPersistedOverlayUpdate(next, { select: true });
          }

          overlayAnchorId = target.id;
          usedOverlayIds.add(target.id);
          updated += 1;
        }
      }

      return { updated, skipped, reasons };
    },
    [
      churchIntegrations,
      churchIntegrationsStatus,
      db,
      dispatch,
      applyPersistedOverlayUpdate,
      placeNewOverlayAfterAnchor,
      store,
    ],
  );

  return { runServicePlanningSync };
};
