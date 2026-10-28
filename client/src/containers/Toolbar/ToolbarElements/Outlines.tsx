import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Check, List } from "lucide-react";
import { useDispatch, useSelector } from "../../../hooks";
import {
  initiateItemLists,
  removeFromItemLists,
  selectItemList,
  setInitialItemList,
  updateItemLists,
  updateItemListsFromRemote,
  setActiveItemList,
  reviewRegistryRevisions,
  retryRegistrySave,
  resolveRegistrySave,
} from "../../../store/itemListsSlice";
import PopoverPanel from "../../../components/PopOver/PopoverPanel";
import Button from "../../../components/Button/Button";
import Outline from "./Outline";
import { DBItemListDetails, DBItemLists, ItemLists, ItemList } from "../../../types";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import {
  createItemListFromExisting,
  createNewItemList,
} from "../../../utils/itemUtil";
import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { useSensors } from "../../../utils/dndUtils";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useGlobalBroadcast } from "../../../hooks/useGlobalBroadcast";
import { ActionCreators } from "redux-undo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { cn } from "../../../utils/cnHelper";
import { toolbarTabClassName } from "./ToolbarButton";
import OutlinesPickerSkeleton from "./OutlinesPickerSkeleton";
import { loadOrCreateItemListsDoc } from "../../../utils/controllerBootstrapDocs";
import { useToast } from "../../../context/toastContext";
import {
  DEFAULT_OUTLINE_SCOPE,
  filterOutlinesByScope,
  isOutlineInScope,
} from "../../../utils/outlineScope";
import { useActiveControllerProfile } from "../../../context/activeController";
import { publishPreparedMediaContext } from "../../../utils/preparedMediaContext";
import { usePresentationControllerMode } from "../../../context/presentationControllerMode";

/** Shared popover chrome (matches service outlines left column). */
const OUTLINE_POPOVER_CONTENT =
  "min-w-[18rem] max-w-[min(26rem,calc(100vw-1.5rem))] overflow-x-visible border-gray-600 bg-gray-800 text-white shadow-md";
const OUTLINE_POPOVER_HEADER = "px-5 pt-2 pb-1.5";
const OUTLINE_POPOVER_BODY = "px-5 pb-3 pt-1.5";
const REGISTRY_FIELD_LABELS: Record<string, string> = {
  activeList: "Live outline", name: "Outline name", controllerScope: "Controller", order: "Outline order",
};

type OutlinesProps = {
  className?: string;
  /** Full-width header-style trigger for the service outline column (vs compact toolbar). */
  servicePanel?: boolean;
  /** Use the same tab styling as the main toolbar row (overlay controller). */
  matchToolbarTabs?: boolean;
};

const Services = ({
  className,
  servicePanel = false,
  matchToolbarTabs = false,
}: OutlinesProps) => {
  const {
    currentLists,
    activeList,
    selectedList,
    scope,
    isInitialized: itemListsReady,
    registrySave = { status: "idle" },
  } = useSelector((state) => state.undoable.present.itemLists);

  const scopedLists = useMemo(
    () => filterOutlinesByScope(currentLists, scope),
    [currentLists, scope],
  );
  const canSetActive = scope === DEFAULT_OUTLINE_SCOPE;
  const { mode } = usePresentationControllerMode();
  const isEditMode = mode === "edit";
  const heading = `Current Outlines (${scopedLists.length})`;

  const dispatch = useDispatch();
  const [outlinePopoverOpen, setOutlinePopoverOpen] = useState(false);
  const [registryChoices, setRegistryChoices] = useState<Record<string, "local" | "remote">>({});
  useEffect(() => { setRegistryChoices(registrySave.choices ?? {}); }, [registrySave.reviewId, registrySave.choices]);
  const activeControllerProfile = useActiveControllerProfile();
  const selectOutline = useCallback(
    (outlineId: string) => {
      dispatch(selectItemList(outlineId));
      setOutlinePopoverOpen(false);
      const outline = currentLists.find((list) => list._id === outlineId);
      publishPreparedMediaContext({
        controllerProfileId: activeControllerProfile.id,
        controllerProfileName: activeControllerProfile.name,
        outlineScope: activeControllerProfile.outlineScope,
        outlineId,
        outlineName: outline?.name,
        contextSource: "local runtime selection",
      });
    },
    [activeControllerProfile, currentLists, dispatch],
  );

  const { db, updater } = useContext(ControllerInfoContext) || {};
  const currentDatabaseRef = useRef(db);
  currentDatabaseRef.current = db;
  const { access } = useContext(GlobalInfoContext) || {};
  const canResolveRegistry = access === "full";
  const { showToast } = useToast();
  const [justAdded, setJustAdded] = useState(false);
  const currentListsRef = useRef(currentLists);
  currentListsRef.current = currentLists;
  const registrySyncTrackerRef = useRef({
    database: db,
    processedRevisions: new Set<string>(),
    pendingRevisions: new Set<string>(),
    conflictFingerprint: null as string | null,
  });
  if (registrySyncTrackerRef.current.database !== db) {
    registrySyncTrackerRef.current = {
      database: db,
      processedRevisions: new Set<string>(),
      pendingRevisions: new Set<string>(),
      conflictFingerprint: null,
    };
  }
  const rememberRegistryRevision = useCallback((revision?: string) => {
    if (!revision) return;
    const revisions = registrySyncTrackerRef.current.processedRevisions;
    revisions.add(revision);
    if (revisions.size > 100) {
      const oldestRevision = revisions.values().next().value;
      if (oldestRevision) revisions.delete(oldestRevision);
    }
  }, []);
  const observeRegistryConflict = useCallback((document: DBItemLists & { _conflicts?: string[] }) => {
    dispatch(reviewRegistryRevisions(Boolean(document._conflicts?.length)));
    const tracker = registrySyncTrackerRef.current;
    if (!document._conflicts?.length) {
      tracker.conflictFingerprint = null;
      return;
    }
    const fingerprint = [document._rev, ...[...document._conflicts].sort()].join(":");
    if (tracker.conflictFingerprint === fingerprint) return;
    tracker.conflictFingerprint = fingerprint;
    showToast(
      "The outline list has competing saved versions. Open the outline picker to review them. Unsaved changes stay available while this app is open.",
      "error",
    );
  }, [dispatch, showToast]);
  /** One aux bootstrap create per scope — avoids duplicate empties under Strict Mode / remount. */
  const bootstrapInFlightByScopeRef = useRef(new Set<string>());

  const { setNodeRef } = useDroppable({
    id: "items-lists",
  });

  const sensors = useSensors();

  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const { id } = over;
    const { id: activeId } = active;
    const updatedItemLists = [...currentLists];
    const newIndex = updatedItemLists.findIndex((list) => list._id === id);
    const oldIndex = updatedItemLists.findIndex(
      (list) => list._id === activeId,
    );
    if (newIndex < 0 || oldIndex < 0) return;
    const element = currentLists[oldIndex];
    updatedItemLists.splice(oldIndex, 1);
    updatedItemLists.splice(newIndex, 0, element);
    dispatch(updateItemLists(updatedItemLists));
  };

  useEffect(() => {
    let cancelled = false;
    const getItemLists = async () => {
      if (!db) return;
      const dbAtStart = db;
      try {
        const response = await loadOrCreateItemListsDoc(dbAtStart);
        if (cancelled || currentDatabaseRef.current !== dbAtStart) return;
        rememberRegistryRevision(response._rev);
        const _itemLists = response.itemLists || [];
        const _activeList = response.activeList;
        if (!itemListsReady) {
          dispatch(
            initiateItemLists({
              itemLists: _itemLists,
              selectedIdByScope: response.selectedIdByScope,
            }),
          );
          if (_activeList?._id) {
            dispatch(setInitialItemList(_activeList._id));
          }
        } else {
          dispatch(
            updateItemListsFromRemote({
              itemLists: _itemLists,
              activeListId: _activeList?._id,
              selectedIdByScope: response.selectedIdByScope,
            }),
          );
        }
        observeRegistryConflict(response);
      } catch (e) {
        if (cancelled || currentDatabaseRef.current !== dbAtStart) return;
        console.error(e);
        if (!itemListsReady) {
          dispatch(initiateItemLists([]));
          showToast(
            "Could not load service outlines. Reload the page before editing outlines.",
            "error",
          );
        }
      }
    };

    void getItemLists();
    return () => {
      cancelled = true;
    };
  }, [db, dispatch, itemListsReady, observeRegistryConflict, rememberRegistryRevision, showToast]);

  /**
   * Aux controllers with no outlines in their scope get one empty outline so
   * the picker is never stuck on a blank selection (and never borrows a
   * sanctuary outline).
   */
  useEffect(() => {
    if (!itemListsReady || !db || access !== "full") return;
    if (scope === DEFAULT_OUTLINE_SCOPE) return;
    if (scopedLists.length > 0) return;
    if (bootstrapInFlightByScopeRef.current.has(scope)) return;

    bootstrapInFlightByScopeRef.current.add(scope);
    let cancelled = false;
    void (async () => {
      try {
        const listsAtStart = currentListsRef.current;
        const newList = await createNewItemList({
          db,
          name: "New Outline",
          currentLists: listsAtStart,
          controllerScope: scope,
        });
        if (cancelled) return;
        // Append onto the latest registry so concurrent remote updates to other
        // scopes are not wiped by a pre-await snapshot.
        const latestLists = currentListsRef.current;
        const scopeStillEmpty = !latestLists.some((list) =>
          isOutlineInScope(list, scope),
        );
        if (!scopeStillEmpty) return;
        dispatch(updateItemLists([...latestLists, newList]));
        selectOutline(newList._id);
      } catch (e) {
        console.error(e);
      } finally {
        bootstrapInFlightByScopeRef.current.delete(scope);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemListsReady, db, access, scope, scopedLists.length, dispatch, selectOutline]);

  const updateItemListsFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        if (!Array.isArray(updates)) return;
        for (const _update of updates) {
          if (_update._id === "ItemLists") {
            const incoming = _update as ItemLists & { _rev?: string };
            const dbAtStart = db;
            if (!dbAtStart) continue;
            const tracker = registrySyncTrackerRef.current;
            if (tracker.database !== dbAtStart) continue;
            if (incoming._rev && (
              tracker.processedRevisions.has(incoming._rev) ||
              tracker.pendingRevisions.has(incoming._rev)
            )) continue;
            if (incoming._rev) tracker.pendingRevisions.add(incoming._rev);
            try {
              const update = await dbAtStart.get("ItemLists", { conflicts: true }) as DBItemLists & { _conflicts?: string[] };
              if (currentDatabaseRef.current !== dbAtStart) continue;
              rememberRegistryRevision(incoming._rev);
              rememberRegistryRevision(update._rev);
              dispatch(
                updateItemListsFromRemote({
                  itemLists: update.itemLists,
                  activeListId: update.activeList?._id,
                  selectedIdByScope: update.selectedIdByScope,
                }),
              );
              observeRegistryConflict(update);
            } finally {
              if (incoming._rev) tracker.pendingRevisions.delete(incoming._rev);
            }
          }
        }
      } catch (e) {
        console.error(e);
        showToast(
          "Could not check for conflicting outline list versions. Your current outline list is still open.",
          "error",
        );
      }
    },
    [db, dispatch, observeRegistryConflict, rememberRegistryRevision, showToast],
  );

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updateItemListsFromExternal);

    return () =>
      updater.removeEventListener("update", updateItemListsFromExternal);
  }, [updater, updateItemListsFromExternal]);

  useGlobalBroadcast(updateItemListsFromExternal);

  const _updateItemLists = (list: ItemList) => {
    dispatch(
      updateItemLists(
        currentLists.map((item) => (item._id === list._id ? list : item)),
      ),
    );
    if (list._id === selectedList?._id) {
      selectOutline(list._id);
    }
  };

  const addOutline = async () => {
    const newList = await createNewItemList({
      db,
      name: "New Outline",
      currentLists,
      controllerScope: scope,
    });
    setJustAdded(true);
    dispatch(updateItemLists([...currentLists, newList]));
    selectOutline(newList._id);
    setTimeout(() => setJustAdded(false), 2000);
  };

  const triggerIconSize = "md";
  const triggerVariant = servicePanel
    ? "tertiary"
    : matchToolbarTabs
      ? outlinePopoverOpen
        ? "none"
        : "tertiary"
      : "primary";
  const triggerClass = cn(
    servicePanel
      ? "w-full max-w-none justify-center gap-2 border-0 px-3 py-2.5 text-xs font-bold text-white shadow-none hover:bg-white/10 active:bg-white/[0.12]"
      : matchToolbarTabs
        ? cn(toolbarTabClassName(outlinePopoverOpen, false), "max-w-64")
        : "max-w-64",
  );
  const triggerColor =
    matchToolbarTabs && !servicePanel && outlinePopoverOpen
      ? "#ffffff"
      : undefined;

  if (!itemListsReady) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          servicePanel && "w-full",
          className,
        )}
      >
        <OutlinesPickerSkeleton
          servicePanel={servicePanel}
          matchToolbarTabs={matchToolbarTabs}
          className={servicePanel ? "w-full min-w-0" : undefined}
        />
      </div>
    );
  }

  return (
    <DndContext
      onDragEnd={access === "full" && isEditMode ? onDragEnd : undefined}
      sensors={sensors}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          servicePanel && "w-full",
          className,
        )}
      >
        <PopoverPanel
          open={outlinePopoverOpen}
          onOpenChange={setOutlinePopoverOpen}
          TriggeringButton={
            <Button
              data-testid="controller-outline-picker"
              data-outline-id={selectedList?._id}
              svg={List}
              iconSize={triggerIconSize}
              variant={triggerVariant}
              color={triggerColor}
              className={triggerClass}
              truncate
            >
              {selectedList?.name}{registrySave.status === "error" || registrySave.status === "review" ? " · Needs attention" : ""}
            </Button>
          }
          align="start"
          contentClassName={OUTLINE_POPOVER_CONTENT}
          headerRowClassName={OUTLINE_POPOVER_HEADER}
          bodyClassName={OUTLINE_POPOVER_BODY}
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            {registrySave.status !== "idle" && (
              <section className="space-y-2 border-b border-amber-400/40 pb-3 text-sm" aria-label="Outline list recovery" aria-busy={registrySave.status === "saving"}>
                <p role="status">{registrySave.status === "saving" ? "Saving outline list…" : "Some outline list changes need your attention."}</p>
                {registrySave.status !== "saving" && (
                  <>
                    <p className="text-xs text-amber-100">Unsaved changes stay available while this app is open. Closing or reloading the app clears them.</p>
                    {!canResolveRegistry && (registrySave.hasBranches || Boolean(registrySave.conflicts?.length)) && <p className="text-xs text-amber-100">Ask someone with full controller access to resolve these saved versions.</p>}
                    {registrySave.reviewChanged && <p className="text-xs text-amber-100">Some values changed during review. Check your choices before saving.</p>}
                    <div className="max-h-56 space-y-3 overflow-y-auto">
                      {registrySave.conflicts?.map((conflict) => {
                        const outline = currentLists.find((list) => list._id === conflict.outlineId);
                        const field = REGISTRY_FIELD_LABELS[conflict.field ?? ""] ??
                          (conflict.field?.startsWith("selection:") ? "Last opened outline" : conflict.field ?? "Outline");
                        const describe = (value: unknown): string => {
                          if (value === undefined || value === null) return "Removed";
                          if (Array.isArray(value)) return value.map(describe).join(", ");
                          if (typeof value === "object") {
                            if ("name" in value && typeof value.name === "string") return value.name;
                            return "Saved value";
                          }
                          if (conflict.field?.startsWith("selection:")) return currentLists.find((list) => list._id === value)?.name ?? "Outline no longer available";
                          return String(value);
                        };
                        return <fieldset key={conflict.key} className="space-y-1">
                          <legend className="font-semibold">{outline?.name ? `${outline.name}: ` : ""}{field}</legend>
                          <p className="text-xs text-gray-300">{conflict.key.startsWith("saved-") ? "Compare saved versions" : "Compare your changes with the saved value"}</p>
                          {conflict.field === "activeList" && <p className="text-xs text-amber-100">This choice sets the live outline for the church.</p>}
                          <Button disabled={!canResolveRegistry} aria-pressed={registryChoices[conflict.key] === "local"} variant={registryChoices[conflict.key] === "local" ? "secondary" : "tertiary"} className="w-full justify-start whitespace-normal" onClick={() => setRegistryChoices((choices) => ({ ...choices, [conflict.key]: "local" }))}>
                            Keep: {describe(conflict.localValue)}
                          </Button>
                          <Button disabled={!canResolveRegistry} aria-pressed={registryChoices[conflict.key] === "remote"} variant={registryChoices[conflict.key] === "remote" ? "secondary" : "tertiary"} className="w-full justify-start whitespace-normal" onClick={() => setRegistryChoices((choices) => ({ ...choices, [conflict.key]: "remote" }))}>
                            Use saved: {describe(conflict.remoteValue)}
                          </Button>
                        </fieldset>;
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(canResolveRegistry || (!registrySave.hasBranches && !registrySave.conflicts?.length)) && <Button variant="secondary" onClick={() => dispatch(retryRegistrySave())}>Retry save</Button>}
                      {canResolveRegistry && registrySave.status === "review" && registrySave.reviewId !== undefined && (registrySave.hasBranches || Boolean(registrySave.conflicts?.length)) && (
                        <Button variant="secondary" disabled={Boolean(registrySave.conflicts?.some((conflict) => !registryChoices[conflict.key]))} onClick={() => dispatch(resolveRegistrySave({ reviewId: registrySave.reviewId!, choices: registryChoices }))}>
                          {registrySave.conflicts?.length ? "Save choices" : "Save combined list"}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}
            <div className="flex min-w-0 flex-1 gap-4">
              <section className="flex h-full min-w-0 flex-1 flex-col p-0">
                <h3 className="mb-1.5 border-b border-gray-600 pb-2 text-center text-sm font-bold text-gray-100">
                  {heading}
                </h3>
                <ul
                  data-testid="controller-outline-list"
                  ref={setNodeRef}
                  className="scrollbar-variable max-h-[min(18rem,50vh)] min-w-0 flex-1 overflow-x-visible overflow-y-auto"
                >
                  <SortableContext
                    items={scopedLists.map((list) => list._id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {scopedLists.map((list, index) => (
                      <Outline
                        key={list._id}
                        list={list}
                        panel
                        canEdit={access === "full" && isEditMode}
                        disableDrag={access !== "full" || !isEditMode}
                        isSelected={list._id === selectedList?._id}
                        selectList={(listId: string) => selectOutline(listId)}
                        showSetActive={canSetActive}
                        setActiveList={
                          canSetActive
                            ? (listId: string) =>
                              dispatch(setActiveItemList(listId))
                            : undefined
                        }
                        isActive={list._id === activeList?._id}
                        copyList={async (listToCopy) => {
                          const newList = await createItemListFromExisting({
                            db,
                            currentLists,
                            list: listToCopy,
                            controllerScope: scope,
                          });
                          if (newList) {
                            dispatch(
                              updateItemLists([...currentLists, newList]),
                            );
                            selectOutline(newList._id);
                          }
                        }}
                        deleteList={
                          index === 0
                            ? undefined
                            : async (id) => {
                              dispatch(removeFromItemLists(id));
                              if (db) {
                                const existingList: DBItemListDetails =
                                  await db.get(id);
                                db.remove(existingList);
                                if (selectedList?._id === id) {
                                  const next = scopedLists.find(
                                    (l) => l._id !== id,
                                  );
                                  if (next) {
                                    selectOutline(next._id);
                                  }
                                }
                                if (canSetActive && activeList?._id === id) {
                                  const presentationFallback =
                                    filterOutlinesByScope(
                                      currentLists.filter((l) => l._id !== id),
                                      DEFAULT_OUTLINE_SCOPE,
                                    )[0];
                                  if (presentationFallback) {
                                    dispatch(
                                      setActiveItemList(
                                        presentationFallback._id,
                                      ),
                                    );
                                  }
                                }
                              }
                              dispatch(ActionCreators.clearHistory());
                            }
                        }
                        updateList={(listToUpdate) => {
                          _updateItemLists(listToUpdate);
                        }}
                      />
                    ))}
                  </SortableContext>
                </ul>
              </section>
            </div>
            {access === "full" && isEditMode && (
              <Button
                svg={justAdded ? Check : Plus}
                color={justAdded ? "#84cc16" : "#22d3ee"}
                className="w-full justify-center py-2 text-xs font-semibold"
                variant="primary"
                disabled={justAdded}
                onClick={() => {
                  void addOutline();
                }}
              >
                {justAdded ? "Added." : "Add New Service"}
              </Button>
            )}
          </div>
        </PopoverPanel>
      </div>
    </DndContext>
  );
};

export default Services;
