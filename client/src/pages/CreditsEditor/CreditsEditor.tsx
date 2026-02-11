import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Credits from "../../containers/Credits/Credits";
import { default as CreditsEditorContainer } from "../../containers/Credits/CreditsEditor";
import { Check, History, Home, Menu as MenuIcon, RefreshCcw, Settings } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  CREDIT_HISTORY_ID_PREFIX,
  DBCredits,
  DBCredit,
  DBItemListDetails,
  DocType,
  ItemLists,
} from "../../types";
import { getAllCreditsHistory, getAllOverlayHistory, getCreditsByIds, getOverlaysByIds, putCreditDoc } from "../../utils/dbUtils";
import {
  initiateCreditsHistory,
  initiateCreditsList,
  initiateCreditsScene,
  initiatePublishedCreditsList,
  initiateTransitionScene,
  setIsInitialized as setCreditsIsInitialized,
  setIsLoading,
  setScheduleName,
  updateCredit,
  updateCreditsListFromRemote,
  updateList,
} from "../../store/creditsSlice";
import Spinner from "../../components/Spinner/Spinner";
import { GlobalInfoContext } from "../../context/globalInfo";
import Button from "../../components/Button/Button";
import cn from "classnames";
import { onValue, ref } from "firebase/database";
import Menu from "../../components/Menu/Menu";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import Undo from "../../containers/Toolbar/ToolbarElements/Undo";
import getScheduleFromExcel from "../../utils/getScheduleFromExcel";
import { setItemListIsLoading } from "../../store/itemListSlice";
import { initiateOverlayHistory, initiateOverlayList } from "../../store/overlaysSlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { useSyncOnReconnect } from "../../hooks";
import { capitalizeFirstLetter } from "../../utils/generalUtils";
import { broadcastCreditsUpdate, CREDITS_EDITOR_PAGE_READY } from "../../store/store";
import CreditHistoryDrawer from "../../containers/Credits/CreditHistoryDrawer";
import CreditsSettingsDrawer from "../../containers/Credits/CreditsSettingsDrawer";

const CreditsEditor = () => {
  const navigate = useNavigate();
  const { list, scheduleName, isInitialized: creditsInitialized } = useSelector(
    (state) => state.undoable.present.credits
  );
  const hasDispatchedPageReady = useRef(false);

  const { list: overlays } = useSelector(
    (state) => state.undoable.present.overlays
  );

  const { db, dbProgress, isMobile = false, setIsMobile, updater, pullFromRemote } =
    useContext(ControllerInfoContext) ?? {};
  const { database, firebaseDb, user } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  useEffect(() => {
    return () => {
      dispatch(setCreditsIsInitialized(false));
      dispatch(setIsLoading(true));
    };
  }, [dispatch]);

  useEffect(() => {
    const getItemList = async () => {
      if (!db) return;
      dispatch(setItemListIsLoading(true));
      try {
        const itemListsResponse: ItemLists | undefined =
          await db?.get("ItemLists");
        const activeList = itemListsResponse?.activeList;
        const response: DBItemListDetails | undefined = await db?.get(
          activeList._id
        );
        const overlaysIds = response?.overlays || [];
        const formattedOverlays = await getOverlaysByIds(db, overlaysIds);
        dispatch(initiateOverlayList(formattedOverlays));
      } catch (e) {
        console.error(e);
      }
      dispatch(setItemListIsLoading(false));
    };
    if (overlays.length === 0) {
      getItemList();
    }
  }, [overlays.length, dispatch, db]);

  useEffect(() => {
    if (!db) return;
    getAllOverlayHistory(db)
      .then((history) => dispatch(initiateOverlayHistory(history)))
      .catch(console.error);
  }, [db, dispatch]);

  useEffect(() => {
    const getCredits = async () => {
      if (!db) return;

      try {
        const creditsDoc = (await db.get("credits")) as DBCredits;
        const creditIds = creditsDoc.creditIds ?? [];
        const credits = await getCreditsByIds(db, creditIds);
        dispatch(initiateCreditsList(credits));

        const historyMap = await getAllCreditsHistory(db);
        dispatch(initiateCreditsHistory(historyMap));
      } catch (error: unknown) {
        console.error(error);
        dispatch(initiateCreditsList([]));
        dispatch(initiateCreditsHistory({}));
        if (error && typeof error === "object" && "name" in error && (error as { name: string }).name === "not_found") {
          await db.put({
            _id: "credits",
            creditIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            docType: "credits",
          });
        }
      } finally {
        dispatch(setIsLoading(false));
      }
    };

    getCredits();
  }, [db, dispatch]);

  useEffect(() => {
    if (creditsInitialized && !hasDispatchedPageReady.current) {
      hasDispatchedPageReady.current = true;
      dispatch({ type: CREDITS_EDITOR_PAGE_READY });
    }
  }, [creditsInitialized, dispatch]);

  const updateCreditsListFromExternal = useCallback(
    async (event: CustomEventInit) => {
      if (!db) return;
      try {
        const updates = event.detail as { _id?: string; docType?: DocType }[] | undefined;
        if (!Array.isArray(updates)) return;
        const indexFromUpdates = updates.find(
          (u): u is DBCredits => u.docType === "credits" || u._id === "credits"
        );
        if (!indexFromUpdates) return;

        const creditIds = indexFromUpdates.creditIds ?? [];
        if (!creditIds.length) return;

        const creditsFromDb = await getCreditsByIds(db, creditIds);
        const creditsFromUpdates = updates
          .filter((d): d is DBCredit => d.docType === "credit")
          .map((d) => ({
            id: d.id,
            heading: d.heading ?? "",
            text: d.text ?? "",
            hidden: d.hidden,
          }));

        const byIdFromUpdates = new Map(creditsFromUpdates.map((c) => [c.id, c]));
        const credits = creditIds
          .map((id) => byIdFromUpdates.get(id) ?? creditsFromDb.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => c != null);

        if (!credits.length) return;

        dispatch(updateCreditsListFromRemote(credits));
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, db]
  );

  const updateCreditFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail as (DBCredit | { docType?: DocType })[] | undefined;
        if (!Array.isArray(updates)) return;

        const creditDocs = updates.filter(
          (u): u is DBCredit => u.docType === "credit"
        );
        if (!creditDocs.length) return;

        creditDocs.forEach((doc) => {
          dispatch(
            updateCredit({
              id: doc.id,
              heading: doc.heading ?? "",
              text: doc.text ?? "",
              hidden: doc.hidden,
            })
          );
        });
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch]
  );

  const updateHistoryFromExternal = useCallback(
    async (event: CustomEventInit) => {
      const updates = event.detail as { _id?: string; docType?: string }[] | undefined;
      if (!db || !Array.isArray(updates)) return;
      const hasCreditHistory = updates.some(
        (d) =>
          d.docType === "credit-history" ||
          (typeof d._id === "string" && d._id.startsWith(CREDIT_HISTORY_ID_PREFIX))
      );
      try {
        if (hasCreditHistory) {
          const historyMap = await getAllCreditsHistory(db);
          dispatch(initiateCreditsHistory(historyMap));
        }
      } catch (e) {
        console.error(e);
      }
    },
    [db, dispatch]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateCreditsListFromExternal);
    updater.addEventListener("update", updateCreditFromExternal);
    updater.addEventListener("update", updateHistoryFromExternal);

    return () => {
      updater.removeEventListener("update", updateCreditsListFromExternal);
      updater.removeEventListener("update", updateCreditFromExternal);
      updater.removeEventListener("update", updateHistoryFromExternal);
    };
  }, [updater, updateCreditsListFromExternal, updateCreditFromExternal, updateHistoryFromExternal]);

  useGlobalBroadcast(updateCreditsListFromExternal);
  useGlobalBroadcast(updateCreditFromExternal);
  useGlobalBroadcast(updateHistoryFromExternal);
  useSyncOnReconnect(pullFromRemote);

  useEffect(() => {
    const getCreditsFromFirebase = async () => {
      if (!firebaseDb) return;

      const transitionSceneRef = ref(
        firebaseDb,
        "users/" + capitalizeFirstLetter(database) + "/v2/credits/transitionScene"
      );
      onValue(transitionSceneRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateTransitionScene(data));
        }
      });

      const creditsSceneRef = ref(
        firebaseDb,
        "users/" + capitalizeFirstLetter(database) + "/v2/credits/creditsScene"
      );
      onValue(creditsSceneRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateCreditsScene(data));
        }
      });

      const scheduleNameRef = ref(
        firebaseDb,
        "users/" + capitalizeFirstLetter(database) + "/v2/credits/scheduleName"
      );
      onValue(scheduleNameRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(setScheduleName(data));
        }
      });

      const getPublishedRef = ref(
        firebaseDb,
        "users/" + capitalizeFirstLetter(database) + "/v2/credits/publishedList"
      );
      onValue(getPublishedRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiatePublishedCreditsList(data));
        }
      });
    };

    getCreditsFromFirebase();
  }, [dispatch, firebaseDb, database]);

  const editorRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0].borderBoxSize[0].inlineSize;
          if (width < 1024) {
            setIsMobile?.(true);
          } else {
            setIsMobile?.(false);
          }
        });

        resizeObserver.observe(node);
      }
    },
    [setIsMobile]
  );

  const generateFromOverlays = useCallback(async () => {
    setIsGenerating(true);
    try {
      const eventNameMapping: { [key: string]: string } = {
        "sabbath school": overlays
          .filter((overlay) =>
            overlay.event?.toLowerCase().includes("sabbath school")
          )
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        welcome:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("welcome")
          )?.name || "",
        "call to praise":
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("call to praise")
          )?.name || "",
        invocation:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("invocation")
          )?.name || "",
        reading:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("reading")
          )?.name || "",
        intercessor:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("intercessor")
          )?.name || "",
        offertory:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("offertory")
          )?.name || "",
        special: overlays
          .filter((overlay) => overlay.event?.toLowerCase().includes("special"))
          .map((overlay) => overlay.name)
          .join("\n")
          .trim(),
        sermon:
          overlays.find((overlay) =>
            overlay.event?.toLowerCase().includes("sermon")
          )?.name || "",
      };

      // Dynamically determine the fallback schedule name as '3rd Quarter 2025 - Schedule' (or similar)
      const now = new Date();
      const year = now.getFullYear();
      const quarter = Math.floor(now.getMonth() / 3) + 1;
      const quarterNames = ["1st", "2nd", "3rd", "4th"];
      const fallbackScheduleName = `${quarterNames[quarter - 1]
        } Quarter ${year} - Schedule`;

      const schedule = await getScheduleFromExcel(
        `${scheduleName || fallbackScheduleName}.xlsx`,
        "/Media Team Positions.xlsx"
      );

      let updatedList = list.map((credit) => {
        // Find matching schedule entry
        const scheduleEntry = schedule.find(
          (entry) =>
            entry.heading.toLowerCase() === credit.heading.toLowerCase()
        );

        if (scheduleEntry) {
          return {
            ...credit,
            text: scheduleEntry.names,
          };
        }

        // If no schedule match, try overlay mapping
        const eventKey = Object.keys(eventNameMapping).find((key) =>
          credit.heading.toLowerCase().includes(key)
        );

        if (eventKey) {
          return {
            ...credit,
            text: eventNameMapping[eventKey],
          };
        }

        return credit;
      });

      // Replace & and , with new lines, then trim spaces
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

      // Persist all updated credits to the db immediately (shared putCreditDoc helper)
      if (db) {
        const docsToBroadcast = (
          await Promise.all(updatedList.map((c) => putCreditDoc(db!, c)))
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
  }, [overlays, list, dispatch, scheduleName, db]);

  const creditsMenuItems = [
    {
      element: (
        <>
          <Home className="size-4 shrink-0 text-gray-300" />
          Home
        </>
      ),
      onClick: () => navigate("/"),
    },
    {
      element: (
        <>
          <Settings className="size-4 shrink-0 text-indigo-400" />
          Settings
        </>
      ),
      onClick: () => setIsSettingsDrawerOpen(true),
    },
    {
      element: (
        <>
          <History className="size-4 shrink-0 text-amber-400" />
          History
        </>
      ),
      onClick: () => setIsHistoryDrawerOpen(true),
    },
  ];

  const generateCreditsButton = (
    <Button
      className="text-xs px-2 py-1"
      data-testid="generate-credits-button"
      disabled={overlays.length === 0 || isGenerating}
      onClick={() => generateFromOverlays()}
      color={justGenerated ? "#84cc16" : "#22d3ee"}
      svg={justGenerated ? Check : RefreshCcw}
    >
      {isGenerating
        ? "Generating..."
        : justGenerated
          ? "Generated!"
          : "Generate Credits"}
    </Button>
  );

  return (
    <div
      ref={editorRef}
      className="w-dvw h-dvh bg-gray-700 text-white flex flex-col gap-2 overflow-hidden"
    >
      <div className="min-h-0">
        <div className="bg-gray-800 w-full px-4 py-1 flex gap-2 items-center">
          <Menu
            menuItems={creditsMenuItems}
            align="start"
            TriggeringButton={
              <Button
                variant="tertiary"
                className="w-fit p-1"
                padding="p-1"
                aria-label="Open menu"
                svg={MenuIcon}
              />
            }
          />
          <div className="border-l-2 border-gray-400 pl-4">
            <Undo />
          </div>
          <div className="flex gap-2 items-center border-l-2 border-gray-400 pl-4">
            {generateCreditsButton}
          </div>
          <div className="ml-auto">
            <UserSection />
          </div>
        </div>
        <div className="md:hidden flex items-center mt-2">
          <Button
            variant={isPreviewOpen ? "secondary" : "primary"}
            onClick={() => setIsPreviewOpen(false)}
            className="flex-1 justify-center rounded-r-none"
          >
            Show Editor
          </Button>
          <Button
            variant={isPreviewOpen ? "primary" : "secondary"}
            onClick={() => setIsPreviewOpen(true)}
            className="flex-1 justify-center rounded-l-none"
          >
            Show Preview
          </Button>
        </div>
      </div>

      {dbProgress !== 100 && (
        <div
          data-testid="loading-overlay"
          className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8"
        >
          <p>
            Setting up <span className="font-bold">Worship</span>
            <span className="text-orange-500 font-semibold">Sync</span> for{" "}
            <span className="font-semibold">{user}</span>
          </p>
          <Spinner />
          <p>
            Progress: <span className="text-orange-500">{dbProgress}%</span>
          </p>
        </div>
      )}

      <div className="flex gap-2 px-4 pb-4 flex-1 min-h-0">
        <CreditsEditorContainer
          className={isPreviewOpen ? "max-md:hidden" : ""}
        />

        <section
          data-testid="credits-preview-container"
          className={cn(
            "flex-1 text-center flex flex-col",
            !isPreviewOpen && "max-md:hidden"
          )}
        >
          <h2 className="text-lg font-semibold min-h-0">Preview</h2>
          <Credits isPreview credits={list} />
        </section>
      </div>
      <CreditsSettingsDrawer
        isOpen={isSettingsDrawerOpen}
        onClose={() => setIsSettingsDrawerOpen(false)}
        size={isMobile ? "xl" : "md"}
        position={isMobile ? "bottom" : "right"}
      />
      <CreditHistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        size={isMobile ? "xl" : "lg"}
        position={isMobile ? "bottom" : "right"}
      />
    </div>
  );
};

export default CreditsEditor;
