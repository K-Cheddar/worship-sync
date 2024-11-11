import Button from "../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { useDispatch, useSelector } from "../../hooks";
import {
  addParticipant,
  updateList,
  updateParticipant,
} from "../../store/participantsSlice";
import Input from "../../components/Input/Input";
import "./Participants.scss";
import { useEffect, useState } from "react";
import Toggle from "../../components/Toggle/Toggle";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Participant from "./Participant";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

const Participants = () => {
  const { list, id, name, title, event, showDelete } = useSelector(
    (state) => state.undoable.present.participants
  );
  const { isStreamTransmitting } = useSelector((state) => state.presentation);
  const [localName, setLocalName] = useState(name);
  const [localTitle, setLocalTitle] = useState(title);
  const [localEvent, setLocalEvent] = useState(event);
  const [localShowDelete, setLocalShowDelete] = useState(showDelete);
  const dispatch = useDispatch();

  useEffect(() => {
    setLocalName(name);
    setLocalTitle(title);
    setLocalEvent(event);
    setLocalShowDelete(showDelete);
  }, [name, title, event, id, showDelete]);

  const { setNodeRef } = useDroppable({
    id: "participants-list",
  });

  const sensors = useSensors();

  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedParticipants = [...list];
    const newIndex = updatedParticipants.findIndex(
      (participant) => participant.id === overId
    );
    const oldIndex = updatedParticipants.findIndex(
      (participant) => participant.id === activeId
    );
    const element = list[oldIndex];
    updatedParticipants.splice(oldIndex, 1);
    updatedParticipants.splice(newIndex, 0, element);
    dispatch(updateList(updatedParticipants));
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex flex-col w-full h-full p-2 gap-2">
        <h2 className="text-xl font-semibold text-center h-fit">
          Participants
        </h2>
        <div className="flex gap-2 h-full">
          <section className="w-1/2 flex flex-col gap-2 h-full">
            <ul className="participants-list" ref={setNodeRef}>
              <SortableContext
                items={list}
                strategy={verticalListSortingStrategy}
              >
                {list.map((participant) => {
                  return (
                    <Participant
                      key={participant.id}
                      participant={participant}
                      selectedId={id}
                      isStreamTransmitting={isStreamTransmitting}
                    />
                  );
                })}
              </SortableContext>
            </ul>
            <Button
              className="text-sm h-7 w-fit mr-auto"
              svg={AddSVG}
              onClick={() => dispatch(addParticipant())}
            >
              Add Participant
            </Button>
          </section>
          <div className="flex flex-col items-center gap-4 flex-1">
            {id && (
              <>
                <div>
                  <h2 className="bg-slate-900 text-center font-semibold text-base">
                    Preview
                  </h2>
                  <DisplayWindow
                    showBorder
                    width={25}
                    participantInfo={{
                      name: localName,
                      title: localTitle,
                      event: localEvent,
                    }}
                    displayType="stream"
                  />
                </div>
                <section className="flex flex-col gap-2 bg-slate-800 p-2 rounded-md min-w-1/2">
                  <Input
                    className="text-sm flex gap-2 items-center"
                    lableClassName="w-10"
                    label="Name"
                    value={localName}
                    onChange={(val) => setLocalName(val as string)}
                  />
                  <Input
                    className="text-sm flex gap-2 items-center"
                    lableClassName="w-10"
                    label="Title"
                    value={localTitle}
                    onChange={(val) => setLocalTitle(val as string)}
                  />
                  <Input
                    className="text-sm flex gap-2 items-center"
                    lableClassName="w-10"
                    label="Event"
                    value={localEvent}
                    onChange={(val) => setLocalEvent(val as string)}
                  />
                  <span className="flex gap-1 items-center">
                    <Toggle
                      label="Show Delete"
                      value={localShowDelete}
                      onChange={(val) => setLocalShowDelete(val)}
                    />
                    <Button
                      className="text-sm h-7 w-fit ml-auto"
                      onClick={() =>
                        dispatch(
                          updateParticipant({
                            id,
                            name: localName,
                            title: localTitle,
                            event: localEvent,
                            showDelete: localShowDelete,
                          })
                        )
                      }
                    >
                      Update Participant
                    </Button>
                  </span>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </DndContext>
  );
};

export default Participants;
