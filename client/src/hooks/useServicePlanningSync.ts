import { useCallback, useContext } from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../hooks";
import { getNamesFromUrl } from "../containers/Overlays/eventParser";
import { mapServicePlanningRows } from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import { findOverlayForServicePlanningCandidate } from "../integrations/servicePlanning/findBestOverlayMatch";
import { GlobalInfoContext } from "../context/globalInfo";
import { ControllerInfoContext } from "../context/controllerInfo";
import { updateOverlay } from "../store/overlaySlice";
import {
  addExistingOverlayToList,
  updateOverlayInList,
} from "../store/overlaysSlice";
import {
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  findParticipantTemplateForSync,
  persistNewParticipantOverlay,
  persistNewParticipantOverlayClone,
} from "../integrations/servicePlanning/servicePlanningOverlayClone";
import generateRandomId from "../utils/generateRandomId";
import type { OverlayInfo } from "../types";
import type { RootState } from "../store/store";
import { persistExistingOverlayDoc } from "../utils/persistOverlayDoc";

type ServicePlanningSyncResult = {
  updated: number;
  skipped: number;
  reasons: string[];
};

export const useServicePlanningSync = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db } = useContext(ControllerInfoContext) || {};
  const { churchIntegrations, churchIntegrationsStatus } =
    useContext(GlobalInfoContext) || {};
  const selectedId = useSelector(
    (s: RootState) => s.undoable.present.overlay?.selectedOverlay?.id,
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

      for (const block of mapped) {
        for (const cand of block.candidates) {
          const list = store.getState().undoable.present.overlays.list;
          const target = findOverlayForServicePlanningCandidate(
            block.source.elementType,
            cand.patch.event,
            list,
            usedOverlayIds,
          );

          if (!target) {
            const template = findParticipantTemplateForSync(
              list,
              cand.patch.event,
            );
            if (template) {
              const newId = generateRandomId();
              const built = buildClonedParticipantOverlay(
                template,
                cand.patch,
                newId,
              );
              dispatch(
                addExistingOverlayToList({
                  overlay: built,
                  insertAfterId: template.id,
                }),
              );
              usedOverlayIds.add(newId);
              await persistNewParticipantOverlayClone(
                db,
                template.id,
                newId,
                cand.patch,
                built,
              );
              updated += 1;
              continue;
            }

            const newId = generateRandomId();
            const newOverlay = buildNewParticipantOverlay(cand.patch, newId);
            dispatch(addExistingOverlayToList({ overlay: newOverlay }));
            usedOverlayIds.add(newId);
            await persistNewParticipantOverlay(db, newOverlay);
            updated += 1;
            reasons.push(
              `Created overlay for "${cand.patch.event || block.source.elementType}"`,
            );
            continue;
          }

          const next: Partial<OverlayInfo> = { ...cand.patch };
          dispatch(
            updateOverlayInList({
              id: target.id,
              ...next,
            }),
          );
          if (selectedId === target.id) {
            const cur = store
              .getState()
              .undoable.present.overlays.list.find((o) => o.id === target.id);
            if (cur) {
              dispatch(
                updateOverlay({
                  ...cur,
                  ...next,
                } as OverlayInfo),
              );
            }
          }

          if (db && selectedId !== target.id) {
            try {
              await persistExistingOverlayDoc(db, {
                ...target,
                ...next,
              });
            } catch (e) {
              console.error("Service Planning sync DB error", target.id, e);
            }
          }

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
      store,
      selectedId,
    ],
  );

  return { runServicePlanningSync };
};
