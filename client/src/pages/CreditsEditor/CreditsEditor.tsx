import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router-dom";
import Credits from "../../containers/Credits/Credits";
import { default as CreditsEditorContainer } from "../../containers/Credits/CreditsEditor";
import {
  ArrowLeft,
  Check,
  History,
  Home,
  Layers,
  Menu as MenuIcon,
  Presentation,
  RefreshCcw,
  Settings,
} from "lucide-react";
import Icon from "../../components/Icon/Icon";
import { useDispatch, useSelector } from "../../hooks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  CREDIT_HISTORY_ID_PREFIX,
  DBCredits,
  DBCredit,
  DBItemListDetails,
  DocType,
  getCreditDocId,
  getCreditsDocId,
  ItemLists,
} from "../../types";
import {
  ensureCreditsIndexDoc,
  getAllCreditsHistory,
  getCreditsByIds,
  getOverlaysByIds,
} from "../../utils/dbUtils";
import {
  initiateCreditsHistory,
  initiateCreditsList,
  initiateCreditsScene,
  initiateLiveCredits,
  initiateTransitionScene,
  setIsInitialized as setCreditsIsInitialized,
  setIsLoading,
  setScheduleName,
  syncVisibleCreditsMirrorAndHistory,
  updateCredit,
  updateCreditsListFromRemote,
} from "../../store/creditsSlice";
import {
  initiateItemLists,
  setInitialItemList,
  updateItemListsFromRemote,
} from "../../store/itemListsSlice";
import Spinner from "../../components/Spinner/Spinner";
import { useStuckDbProgress } from "../../hooks/useStuckDbProgress";
import {
  DbStartupConnectionFailedPanel,
  DbStartupStuckRecoveryPanel,
} from "../../components/ControllerPageShell/DbProgressStartupRecoveryUi";
import { GlobalInfoContext } from "../../context/globalInfo";
import Button from "../../components/Button/Button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "@/components/ui/tabs";
import cn from "classnames";
import { onValue, ref, set } from "firebase/database";
import Menu from "../../components/Menu/Menu";
import Outlines from "../../containers/Toolbar/ToolbarElements/Outlines";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import Undo from "../../containers/Toolbar/ToolbarElements/Undo";
import { setItemListIsLoading } from "../../store/itemListSlice";
import { initiateOverlayList } from "../../store/overlaysSlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { useSyncOnReconnect } from "../../hooks";
import { getChurchDataPath } from "../../utils/firebasePaths";
import { CREDITS_EDITOR_PAGE_READY, type RootState } from "../../store/store";
import CreditHistoryDrawer from "../../containers/Credits/CreditHistoryDrawer";
import CreditsSettingsDrawer from "../../containers/Credits/CreditsSettingsDrawer";
import { CreditsPreviewSkeleton } from "../../containers/Credits/CreditsEditorSkeleton";
import { useGenerateCreditsFromOverlays } from "../../hooks/useGenerateCreditsFromOverlays";

const cleanForRtdb = (obj: object) =>
  JSON.parse(JSON.stringify(obj, (_, val) => (val === undefined ? null : val)));

export type CreditsEditorProps = {
  /** Render inside overlay controller shell (no duplicate menu, outlines, or full-page loading). */
  embeddedInOverlayController?: boolean;
};

const CreditsEditor = ({
  embeddedInOverlayController = false,
}: CreditsEditorProps) => {
  const navigate = useNavigate();
  const { list, isInitialized: creditsInitialized, isLoading: creditsLoading } =
    useSelector((state) => state.undoable.present.credits);
  /** Which outline's credits we edit (Outlines dropdown updates `selectedList`). */
  const outlineIdForCredits = useSelector(
    (state) =>
      state.undoable.present.itemLists.selectedList?._id ??
      state.undoable.present.itemLists.activeList?._id,
  );
  /** RTDB live credits (`publishedList` key) follow the active outline only (Set Active). */
  const activeOutlineId = useSelector(
    (state) => state.undoable.present.itemLists.activeList?._id,
  );
  const itemListsReady = useSelector(
    (state) => state.undoable.present.itemLists.isInitialized,
  );
  const hasDispatchedPageReady = useRef(false);

  const {
    generateFromOverlays,
    isGenerating,
    justGenerated,
    hasOverlays,
  } = useGenerateCreditsFromOverlays();
  const scrollbarWidth = useSelector(
    (state: RootState) =>
      state.undoable.present.preferences?.scrollbarWidth ?? "thin",
  );

  const {
    db,
    dbProgress,
    connectionStatus,
    isMobile = false,
    setIsMobile,
    updater,
    pullFromRemote,
  } = useContext(ControllerInfoContext) ?? {};

  const dbProgressValue = dbProgress ?? 0;
  const isConnectionFailed = connectionStatus?.status === "failed";
  const isStartupStuck = useStuckDbProgress(dbProgressValue, isConnectionFailed);
  const { churchId, firebaseDb, user, access } = useContext(GlobalInfoContext) || {};
  const canEditCredits = access !== "view";
  const dispatch = useDispatch();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  useEffect(() => {
    if (embeddedInOverlayController) return;
    return () => {
      dispatch(setCreditsIsInitialized(false));
      dispatch(setIsLoading(true));
    };
  }, [dispatch, embeddedInOverlayController]);

  useEffect(() => {
    if (!db) return;
    (async () => {
      try {
        const response: ItemLists | undefined = await db.get("ItemLists");
        const lists = response?.itemLists ?? [];
        if (lists.length) {
          if (!itemListsReady) {
            dispatch(initiateItemLists(lists));
            if (response?.activeList) {
              dispatch(setInitialItemList(response.activeList._id));
            }
          } else {
            dispatch(updateItemListsFromRemote(lists));
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [db, dispatch, itemListsReady]);

  useEffect(() => {
    if (!db || !outlineIdForCredits) return;
    dispatch(setItemListIsLoading(true));
    (async () => {
      try {
        const response: DBItemListDetails | undefined = await db.get(
          outlineIdForCredits,
        );
        const overlaysIds = response?.overlays || [];
        const formattedOverlays = await getOverlaysByIds(db, overlaysIds);
        dispatch(initiateOverlayList(formattedOverlays));
      } catch (e) {
        console.error(e);
      }
      dispatch(setItemListIsLoading(false));
    })();
  }, [db, outlineIdForCredits, dispatch]);

  useEffect(() => {
    if (!db || !outlineIdForCredits) return;

    let cancelled = false;
    const outlineId = outlineIdForCredits;

    const loadCreditsForOutline = async () => {
      dispatch(setIsLoading(true));
      dispatch(setCreditsIsInitialized(false));
      try {
        if (cancelled) return;

        await ensureCreditsIndexDoc(db, outlineId);
        if (cancelled) return;

        const creditsDoc = (await db.get(
          getCreditsDocId(outlineId),
        )) as DBCredits;
        const creditIds = creditsDoc.creditIds ?? [];
        const credits = await getCreditsByIds(db, outlineId, creditIds);
        if (cancelled) return;

        dispatch(initiateCreditsList(credits));

        const historyMap = await getAllCreditsHistory(db);
        if (cancelled) return;

        dispatch(initiateCreditsHistory(historyMap));

        dispatch(syncVisibleCreditsMirrorAndHistory());

        if (
          firebaseDb &&
          churchId &&
          activeOutlineId &&
          outlineId === activeOutlineId
        ) {
          const visible = credits.filter((c) => !c.hidden);
          set(
            ref(
              firebaseDb,
              getChurchDataPath(churchId, "credits", "publishedList"),
            ),
            cleanForRtdb(visible as unknown as object),
          );
        }
      } catch (error: unknown) {
        if (cancelled) return;
        console.error(error);
        dispatch(initiateCreditsList([]));
        dispatch(initiateCreditsHistory({}));
      } finally {
        if (!cancelled) {
          dispatch(setIsLoading(false));
        }
      }
    };

    loadCreditsForOutline();
    return () => {
      cancelled = true;
    };
  }, [
    db,
    outlineIdForCredits,
    activeOutlineId,
    dispatch,
    firebaseDb,
    churchId,
  ]);

  useEffect(() => {
    if (creditsInitialized && !hasDispatchedPageReady.current) {
      hasDispatchedPageReady.current = true;
      dispatch({ type: CREDITS_EDITOR_PAGE_READY });
    }
  }, [creditsInitialized, dispatch]);

  const updateCreditsListFromExternal = useCallback(
    async (event: CustomEventInit) => {
      if (!db) return;
      const outlineId = outlineIdForCredits;
      if (!outlineId) return;
      const expectedIndexId = getCreditsDocId(outlineId);
      try {
        const updates = event.detail as { _id?: string; docType?: DocType }[] | undefined;
        if (!Array.isArray(updates)) return;
        const indexFromUpdates = updates.find(
          (u): u is DBCredits => u._id === expectedIndexId,
        );
        if (!indexFromUpdates) return;

        const creditIds = indexFromUpdates.creditIds ?? [];

        const creditsFromDb = await getCreditsByIds(db, outlineId, creditIds);
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

        dispatch(updateCreditsListFromRemote(credits));
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, db, outlineIdForCredits]
  );

  const updateCreditFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail as (DBCredit | { docType?: DocType })[] | undefined;
        if (!Array.isArray(updates)) return;

        const outlineId = outlineIdForCredits;
        if (!outlineId) return;

        const creditDocs = updates
          .filter((u): u is DBCredit => u.docType === "credit")
          .filter((doc) => {
            if (doc.outlineId) return doc.outlineId === outlineId;
            return doc._id === getCreditDocId(outlineId, doc.id);
          });
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
    [dispatch, outlineIdForCredits]
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
        getChurchDataPath(churchId, "credits", "transitionScene")
      );
      onValue(transitionSceneRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateTransitionScene(data));
        }
      });

      const creditsSceneRef = ref(
        firebaseDb,
        getChurchDataPath(churchId, "credits", "creditsScene")
      );
      onValue(creditsSceneRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateCreditsScene(data));
        }
      });

      const scheduleNameRef = ref(
        firebaseDb,
        getChurchDataPath(churchId, "credits", "scheduleName")
      );
      onValue(scheduleNameRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(setScheduleName(data));
        }
      });

      const liveCreditsRtdbRef = ref(
        firebaseDb,
        getChurchDataPath(churchId, "credits", "publishedList")
      );
      onValue(liveCreditsRtdbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          dispatch(initiateLiveCredits(data));
        }
      });
    };

    getCreditsFromFirebase();
  }, [churchId, dispatch, firebaseDb]);

  const editorRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0].borderBoxSize[0].inlineSize;
          // Match Tailwind `md` (768px) so `isMobile` aligns with max-md/md layout on this page.
          if (width < 768) {
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

  const handleBack = useCallback(() => {
    const historyIndex =
      typeof window.history.state?.idx === "number"
        ? window.history.state.idx
        : undefined;

    if ((historyIndex ?? 0) > 0 || window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  }, [navigate]);

  const creditsMenuItems = useMemo(
    () => [
      {
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={ArrowLeft} color="#d1d5dc" />
            Back
          </div>
        ),
        onClick: handleBack,
      },
      {
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={Home} color="#d1d5dc" />
            Home
          </div>
        ),
        onClick: () => navigate("/"),
      },
      {
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={Presentation} color="#d1d5dc" />
            Presentation Controller
          </div>
        ),
        to: "/controller",
      },
      {
        element: (
          <div className="flex items-center gap-2 max-md:min-h-12">
            <Icon svg={Layers} color="#d1d5dc" />
            Overlay Controller
          </div>
        ),
        to: "/overlay-controller",
      },
      ...(canEditCredits
        ? [
          {
            element: (
              <div className="flex items-center gap-2 max-md:min-h-12">
                <Icon svg={Settings} color="#d1d5dc" />
                Settings
              </div>
            ),
            onClick: () => setIsSettingsDrawerOpen(true),
          },
          {
            element: (
              <>
                <Icon svg={History} color="#d1d5dc" />
                History
              </>
            ),
            onClick: () => setIsHistoryDrawerOpen(true),
          },
        ]
        : []),
    ],
    [handleBack, navigate, canEditCredits]
  );

  const generateCreditsButton = (
    <Button
      data-testid="generate-credits-button"
      disabled={!hasOverlays || isGenerating}
      onClick={() => generateFromOverlays()}
      color={justGenerated ? "#84cc16" : "#22d3ee"}
      svg={justGenerated ? Check : RefreshCcw}
    >
      {isGenerating
        ? "Generating..."
        : justGenerated
          ? "Generated."
          : "Generate Credits"}
    </Button>
  );

  const mobileEditorPreviewTabs = (
    <Tabs
      value={isPreviewOpen ? "preview" : "editor"}
      onValueChange={(v) => setIsPreviewOpen(v === "preview")}
      className="w-full gap-0"
    >
      <TabsList variant="line" className={lineTabsListShellClassName}>
        <TabsTrigger value="editor" className={lineTabsTriggerClassName}>
          Editor
        </TabsTrigger>
        <TabsTrigger value="preview" className={lineTabsTriggerClassName}>
          Preview
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return (
    <div
      ref={editorRef}
      className={cn(
        embeddedInOverlayController
          ? "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden bg-homepage-canvas text-white"
          : "flex h-dvh w-dvw flex-col gap-2 overflow-hidden bg-homepage-canvas text-white",
      )}
      style={{ "--scrollbar-width": scrollbarWidth } as CSSProperties}
    >
      {!embeddedInOverlayController && (
        <div className="min-h-0">
          <div className="flex w-full flex-col gap-2 bg-gray-800 px-4 py-2 md:flex-row md:items-center md:gap-2 md:py-1">
            <div className="flex w-full min-w-0 items-center gap-2">
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
              {canEditCredits && (
                <div className="border-l-2 border-gray-400 pl-4">
                  <Undo />
                </div>
              )}
              <div className="hidden max-w-xl min-w-0 flex-1 items-center gap-2 border-l-2 border-gray-400 pl-4 md:flex">
                <Outlines className="min-w-0" />
                {canEditCredits && (
                  <div className="shrink-0">{generateCreditsButton}</div>
                )}
              </div>
              <div className="ml-auto shrink-0">
                <UserSection />
              </div>
            </div>
            <div className="flex w-full justify-around min-w-0 border-t border-gray-600 pt-2 md:hidden">
              <Outlines />
              {canEditCredits && (
                <div>{generateCreditsButton}</div>
              )}
            </div>
          </div>
          <div className="mt-2 px-4 md:hidden">{mobileEditorPreviewTabs}</div>
        </div>
      )}

      {embeddedInOverlayController && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-gray-700 px-4 pb-3 pt-1 md:hidden">
          {mobileEditorPreviewTabs}
        </div>
      )}

      {!embeddedInOverlayController && dbProgressValue !== 100 && (
        <div
          data-testid="loading-overlay"
          className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8"
        >
          {isConnectionFailed ? (
            <DbStartupConnectionFailedPanel />
          ) : isStartupStuck ? (
            <>
              <DbStartupStuckRecoveryPanel
                dbProgress={dbProgressValue}
                connectionStatus={connectionStatus}
              />
              {connectionStatus?.status === "retrying" && (
                <p className="text-center text-lg text-yellow-400">
                  Connection failed. Retrying...
                </p>
              )}
              <Spinner />
            </>
          ) : (
            <>
              <p>
                Setting up <span className="font-bold">Worship</span>
                <span className="text-orange-500 font-semibold">Sync</span> for{" "}
                <span className="font-semibold">{user}</span>
              </p>
              {connectionStatus?.status === "retrying" && (
                <p className="text-center text-lg text-yellow-400">
                  Connection failed. Retrying...
                </p>
              )}
              <Spinner />
              <p>
                Progress:{" "}
                <span className="text-orange-500">{dbProgressValue}%</span>
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2 px-4 pb-4">
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
          {creditsLoading ? (
            <CreditsPreviewSkeleton />
          ) : (
            <Credits isPreview credits={list} />
          )}
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
