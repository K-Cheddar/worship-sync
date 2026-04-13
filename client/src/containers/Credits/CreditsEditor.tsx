import Button from "../../components/Button/Button";
import { Plus, Check, FolderOpen } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import { selectCredit, updateList } from "../../store/creditsSlice";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import Credit from "./Credit";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";
import cn from "classnames";
import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  addCredit,
  applyRemoveLineFromCreditsHistoryMap,
  flattenCreditsHistoryLines,
  removeCreditsHistoryLineEverywhere,
} from "../../store/creditsSlice";
import { broadcastCreditsUpdate } from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  putCreditHistoryDoc,
  removeCreditHistoryDoc,
} from "../../utils/dbUtils";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import generateRandomId from "../../utils/generateRandomId";
import { getCreditDocId, type DBCredit } from "../../types";
import CreditsEditorSkeleton from "./CreditsEditorSkeleton";
import ExistingCreditsDrawer from "./ExistingCreditsDrawer";

const CreditsEditor = ({ className }: { className?: string }) => {
  const { list, initialList, isLoading, selectedCreditId, creditsHistory } =
    useSelector((state: RootState) => state.undoable.present.credits);
  /** Pouch / UI: edit whichever outline is selected in Outlines; fall back to active. */
  const outlineId = useSelector(
    (state: RootState) =>
      state.undoable.present.itemLists.selectedList?._id ??
      state.undoable.present.itemLists.activeList?._id,
  );
  const dispatch = useDispatch();
  const { db, isMobile } = useContext(ControllerInfoContext) ?? {
    isMobile: false,
  };
  const { access } = useContext(GlobalInfoContext) ?? {};
  const readOnly = access === "view";

  const [justAdded, setJustAdded] = useState(false);
  const [isAddExistingOpen, setIsAddExistingOpen] = useState(false);

  const { setNodeRef } = useDroppable({
    id: "credits-list",
  });

  const sensors = useSensors();

  const allHistoryLines = useMemo(
    () => flattenCreditsHistoryLines(creditsHistory),
    [creditsHistory],
  );

  const handleSelectCredit = useCallback((creditId: string) => {
    dispatch(selectCredit(creditId));
  }, [dispatch]);

  const removeGlobalHistoryLine = useCallback(
    (line: string) => {
      const before = creditsHistory;
      const after = applyRemoveLineFromCreditsHistoryMap(before, line);
      if (after === before) return;
      dispatch(removeCreditsHistoryLineEverywhere(line));
      if (!db) return;
      for (const h of Object.keys(before)) {
        const prevL = before[h];
        const nextL = after[h];
        if (nextL === undefined) {
          removeCreditHistoryDoc(db, h).catch(console.error);
        } else if (JSON.stringify(prevL) !== JSON.stringify(nextL)) {
          putCreditHistoryDoc(db, h, nextL).catch(console.error);
        }
      }
    },
    [creditsHistory, db, dispatch],
  );

  const listOrderKey = useMemo(
    () => list.map((c) => c.id).join(","),
    [list],
  );

  const onDragEnd = (event: DragEndEvent) => {
    if (readOnly) return;
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedCredits = [...list];
    const newIndex = updatedCredits.findIndex((credit) => credit.id === overId);
    const oldIndex = updatedCredits.findIndex(
      (credit) => credit.id === activeId,
    );
    const element = list[oldIndex];
    updatedCredits.splice(oldIndex, 1);
    updatedCredits.splice(newIndex, 0, element);
    dispatch(updateList(updatedCredits));
  };

  // keep the selected credit in view
  useEffect(() => {
    const selectedCredit = list.find(
      (credit) => credit.id === selectedCreditId
    );
    if (selectedCredit) {
      const creditElement = document.getElementById(
        `credit-editor-${selectedCreditId}`
      );
      const creditsList = document.getElementById("credits-list");
      if (creditElement && creditsList) {
        keepElementInView({
          child: creditElement,
          parent: creditsList,
        });
      }
    }
  }, [selectedCreditId, listOrderKey]);

  return (
    <DndContext onDragEnd={onDragEnd} sensors={sensors}>
      <div
        data-testid="credits-editor-container"
        className={cn(
          "flex flex-col p-2 gap-2 max-md:w-full md:w-1/2 flex-1 min-h-0",
          className
        )}
      >
        <h2 className="text-xl font-semibold text-center h-fit">Credits</h2>
        {!isLoading && list.length === 0 && (
          <p className="text-sm px-2">
            {readOnly
              ? "This credits list is empty."
              : "This credits list is empty. Click the button below to add some credits."}
          </p>
        )}
        {isLoading && <CreditsEditorSkeleton readOnly={readOnly} />}
        {!isLoading && (
          <>
            <ul
              className="scrollbar-variable flex flex-col gap-2 w-full overflow-y-auto overflow-x-hidden flex-1 min-h-0 pr-2"
              id="credits-list"
              ref={setNodeRef}
            >
              <SortableContext
                items={list.map((credit) => credit.id)}
                strategy={verticalListSortingStrategy}
              >
                {list.map((credit) => {
                  return (
                    <Credit
                      onSelectCredit={handleSelectCredit}
                      selectedCreditId={selectedCreditId}
                      key={credit.id}
                      outlineId={outlineId}
                      initialList={initialList}
                      heading={credit.heading}
                      text={credit.text}
                      hidden={credit.hidden}
                      id={credit.id}
                      historyLines={allHistoryLines}
                      onRemoveHistoryLine={
                        readOnly ? undefined : removeGlobalHistoryLine
                      }
                      readOnly={readOnly}
                    />
                  );
                })}
              </SortableContext>
            </ul>
            {!readOnly && (
              <section className="flex min-h-0 flex-col gap-2">
                <div className="mt-2 flex gap-2">
                  <Button
                    className="flex-1 justify-center text-sm"
                    svg={justAdded ? Check : Plus}
                    color={justAdded ? "#84cc16" : "#22d3ee"}
                    disabled={justAdded}
                    onClick={async () => {
                      if (!db || !outlineId) return;
                      setJustAdded(true);
                      const newId = generateRandomId();
                      const newCredit: DBCredit = {
                        _id: getCreditDocId(outlineId, newId),
                        outlineId,
                        id: newId,
                        heading: "",
                        text: "",
                        updatedAt: new Date().toISOString(),
                        docType: "credit",
                      };
                      await db.put(newCredit);
                      broadcastCreditsUpdate([newCredit]);
                      dispatch(addCredit({ id: newId, heading: "", text: "" }));
                      setTimeout(() => setJustAdded(false), 500);
                    }}
                  >
                    {justAdded ? "Added." : "Add Credit"}
                  </Button>
                  <Button
                    className="flex-1 justify-center text-sm"
                    svg={FolderOpen}
                    color="#a78bfa"
                    disabled={!db || !outlineId}
                    onClick={() => setIsAddExistingOpen(true)}
                  >
                    Existing credits
                  </Button>
                </div>
                <ExistingCreditsDrawer
                  isOpen={isAddExistingOpen}
                  onClose={() => setIsAddExistingOpen(false)}
                  db={db}
                  outlineId={outlineId}
                  currentListIds={list.map((c) => c.id)}
                  isMobile={isMobile ?? false}
                />
              </section>
            )}
          </>
        )}
      </div>
    </DndContext>
  );
};

export default CreditsEditor;
