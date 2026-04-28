import { useCallback, useContext, useMemo, useState } from "react";
import { useDispatch, useSelector } from "../hooks";
import { ControllerInfoContext } from "../context/controllerInfo";
import { putCreditDoc } from "../utils/dbUtils";
import getScheduleFromExcel from "../utils/getScheduleFromExcel";
import { updateList } from "../store/creditsSlice";
import store, { broadcastCreditsUpdate } from "../store/store";
import { flushCreditsHistoryFromLatestList } from "../utils/creditsHistoryFlush";

/**
 * Shared "Generate credits from overlays + schedule" action for Credits Editor and overlay toolbar.
 */
export function useGenerateCreditsFromOverlays() {
  const dispatch = useDispatch();
  const { list, scheduleName } = useSelector(
    (state) => state.undoable.present.credits,
  );
  const outlineIdForCredits = useSelector(
    (state) =>
      state.undoable.present.itemLists.selectedList?._id ??
      state.undoable.present.itemLists.activeList?._id,
  );
  const { list: overlays } = useSelector(
    (state) => state.undoable.present.overlays,
  );
  const participantOverlays = useMemo(
    () => overlays.filter((overlay) => overlay.type === "participant"),
    [overlays],
  );
  const { db } = useContext(ControllerInfoContext) ?? {};

  const [isGenerating, setIsGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);

  const generateFromOverlays = useCallback(async () => {
    setIsGenerating(true);
    try {
      const eventNameMapping: { [key: string]: string } = {
        "sabbath school": participantOverlays
          .filter((overlay) =>
            overlay.event?.toLowerCase().includes("sabbath school"),
          )
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        welcome:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("welcome"),
          )?.name || "",
        "call to praise":
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("call to praise"),
          )?.name || "",
        invocation:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("invocation"),
          )?.name || "",
        reading:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("reading"),
          )?.name || "",
        intercessor:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("intercessor"),
          )?.name || "",
        offertory:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("offertory"),
          )?.name || "",
        special: participantOverlays
          .filter((overlay) => overlay.event?.toLowerCase().includes("special"))
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        sermon:
          participantOverlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("sermon"),
          )?.name || "",
      };

      const now = new Date();
      const year = now.getFullYear();
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      const quarterNames = ["1st", "2nd", "3rd", "4th"];
      const fallbackScheduleName = `${
        quarterNames[quarter - 1]
      } Quarter ${year} - Schedule`;

      const schedule = await getScheduleFromExcel(
        `${scheduleName || fallbackScheduleName}.xlsx`,
        "/Media Team Positions.xlsx",
      );

      let updatedList = list.map((credit) => {
        const scheduleEntry = schedule.find(
          (entry) =>
            entry.heading.toLowerCase() === credit.heading.toLowerCase(),
        );

        if (scheduleEntry) {
          return {
            ...credit,
            text: scheduleEntry.names,
          };
        }

        const eventKey = Object.keys(eventNameMapping).find((key) =>
          credit.heading.toLowerCase().includes(key),
        );

        if (eventKey) {
          return {
            ...credit,
            text: eventNameMapping[eventKey],
          };
        }

        return credit;
      });

      updatedList = updatedList.map((credit) => {
        return {
          ...credit,
          text: credit.text
            .split(/,|&/)
            .map((item: string) => item.trim())
            .join("\n"),
        };
      });

      dispatch(updateList(updatedList));

      await flushCreditsHistoryFromLatestList(
        dispatch,
        () => store.getState(),
        db,
      );

      if (db && outlineIdForCredits) {
        const oid = outlineIdForCredits;
        const docsToBroadcast = (
          await Promise.all(updatedList.map((c) => putCreditDoc(db!, oid, c)))
        ).filter((doc): doc is NonNullable<typeof doc> => doc != null);
        if (docsToBroadcast.length > 0) {
          broadcastCreditsUpdate(docsToBroadcast);
        }
      }

      setJustGenerated(true);
      setTimeout(() => setJustGenerated(false), 2000);
    } catch (error) {
      console.error("Error generating from overlays:", error);
    } finally {
      setIsGenerating(false);
    }
  }, [
    participantOverlays,
    list,
    dispatch,
    scheduleName,
    db,
    outlineIdForCredits,
  ]);

  return {
    generateFromOverlays,
    isGenerating,
    justGenerated,
    hasOverlays: overlays.length > 0,
  };
}
