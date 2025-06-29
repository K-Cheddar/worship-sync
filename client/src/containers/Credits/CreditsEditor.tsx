import Button from "../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as SaveSVG } from "../../assets/icons/save.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { useDispatch, useSelector } from "../../hooks";
import { selectCredit, updateList } from "../../store/creditsSlice";
import "./Credits.scss";
import { useEffect, useState } from "react";
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
  updatePublishedCreditsList,
} from "../../store/creditsSlice";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";

const CreditsEditor = ({ className }: { className?: string }) => {
  const { list, publishedList, initialList, isLoading, selectedCreditId } =
    useSelector((state: RootState) => state.undoable.present.credits);
  const dispatch = useDispatch();
  // const { isMobile } = useContext(ControllerInfoContext) || {};

  const [justAdded, setJustAdded] = useState(false);
  const [justPublished, setJustPublished] = useState(false);

  const { setNodeRef } = useDroppable({
    id: "credits-list",
  });

  const sensors = useSensors();

  const hasUnpublishedChanges = () => {
    const visibleList = list
      .filter((credit) => !credit.hidden)
      .map((credit) => ({
        heading: credit.heading,
        text: credit.text,
      }));
    const visiblePublishedList = publishedList
      .filter((credit) => !credit.hidden)
      .map((credit) => ({
        heading: credit.heading,
        text: credit.text,
      }));
    return JSON.stringify(visiblePublishedList) !== JSON.stringify(visibleList);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedCredits = [...list];
    const newIndex = updatedCredits.findIndex((credit) => credit.id === overId);
    const oldIndex = updatedCredits.findIndex(
      (credit) => credit.id === activeId
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
  }, [selectedCreditId, list]);

  return (
    <DndContext onDragEnd={onDragEnd} sensors={sensors}>
      <div
        data-testid="credits-editor-container"
        className={cn(
          "flex flex-col p-2 gap-2 max-md:w-full md:w-1/2 h-full",
          className
        )}
      >
        <h2 className="text-xl font-semibold text-center h-fit">
          Credits
          {hasUnpublishedChanges() ? (
            <span className="text-yellow-500 ml-2">(Draft)</span>
          ) : (
            <span className="text-green-500 ml-2">(Published)</span>
          )}
        </h2>
        {!isLoading && list.length === 0 && (
          <p className="text-sm px-2">
            This credits list is empty. Click the button below to add some
            credits.
          </p>
        )}
        {isLoading && (
          <h3 className="text-lg text-center">Loading credits...</h3>
        )}
        {!isLoading && (
          <>
            <ul
              className="credits-list-editor"
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
                      selectCredit={() => dispatch(selectCredit(credit.id))}
                      selectedCreditId={selectedCreditId}
                      key={credit.id}
                      initialList={initialList}
                      heading={credit.heading}
                      text={credit.text}
                      hidden={credit.hidden}
                      id={credit.id}
                    />
                  );
                })}
              </SortableContext>
            </ul>
            <section className="flex-1 flex flex-col gap-2">
              <Button
                className="text-sm w-full justify-center mt-2"
                svg={justAdded ? CheckSVG : AddSVG}
                color={justAdded ? "#84cc16" : "#22d3ee"}
                disabled={justAdded}
                onClick={() => {
                  setJustAdded(true);
                  dispatch(addCredit());
                  setTimeout(() => {
                    setJustAdded(false);
                  }, 500);
                }}
              >
                {justAdded ? "Added!" : "Add Credit"}
              </Button>
              <Button
                className="text-sm w-full justify-center mt-2"
                svg={justPublished ? CheckSVG : SaveSVG}
                color={justPublished ? "#84cc16" : "#0284c7"}
                variant="cta"
                disabled={justPublished}
                onClick={() => {
                  setJustPublished(true);
                  dispatch(updatePublishedCreditsList());
                  setTimeout(() => {
                    setJustPublished(false);
                  }, 5000);
                }}
              >
                {justPublished
                  ? "Published Credits and Scenes!"
                  : "Publish Credits and Scenes"}
              </Button>
            </section>
          </>
        )}
      </div>
    </DndContext>
  );
};

export default CreditsEditor;
