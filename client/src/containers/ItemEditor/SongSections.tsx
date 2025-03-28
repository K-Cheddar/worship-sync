import Button from "../../components/Button/Button";
import { SongOrder } from "../../types";
import Select from "../../components/Select/Select";
import { useEffect, useState } from "react";
import generateRandomId from "../../utils/generateRandomId";
import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { useSensors } from "../../utils/dndUtils";
import { SortableContext } from "@dnd-kit/sortable";
import SongSection from "./SongSection";

type SongSectionsProps = {
  songOrder: SongOrder[];
  setSongOrder: (songOrder: SongOrder[]) => void;
  currentSections: { value: string; label: string }[];
};

const SongSections = ({
  songOrder,
  setSongOrder,
  currentSections,
}: SongSectionsProps) => {
  const [section, setSection] = useState(currentSections[0]?.value || "");

  useEffect(() => {
    setSection(currentSections[0]?.value || "");
  }, [currentSections]);

  const { setNodeRef } = useDroppable({
    id: "song-sections-list",
  });

  const sensors = useSensors();

  // TODO make this a Utility
  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const { id } = over;
    const { id: activeId } = active;
    const updatedSongOrder = [...songOrder];
    const newIndex = updatedSongOrder.findIndex((item) => item.id === id);
    const oldIndex = updatedSongOrder.findIndex((item) => item.id === activeId);
    const element = songOrder[oldIndex];
    updatedSongOrder.splice(oldIndex, 1);
    updatedSongOrder.splice(newIndex, 0, element);
    setSongOrder(updatedSongOrder);
  };

  return (
    <DndContext onDragEnd={onDragEnd} sensors={sensors}>
      <h2 className="text-lg mb-2 text-center font-semibold">Song Order</h2>
      <ul id="song-sections-list" className="song-sections" ref={setNodeRef}>
        <SortableContext items={songOrder.map(({ id }) => id)}>
          {songOrder.map(({ id, name }, index) => (
            <SongSection
              key={id}
              name={name}
              index={index}
              setSongOrder={setSongOrder}
              songOrder={songOrder}
              id={id}
            />
          ))}
        </SortableContext>
      </ul>
      <div className="mt-4">
        <h4 className="text-sm font-semibold w-full text-center">
          Select Section:
        </h4>
        <Select
          className="song-section-select"
          options={currentSections}
          value={section}
          onChange={(value) => setSection(value)}
        />
        <Button
          onClick={() =>
            setSongOrder([
              ...songOrder,
              { id: generateRandomId(), name: section || songOrder[0]?.name },
            ])
          }
          className="text-base mt-2 w-full justify-center h-7"
          disabled={!section}
        >
          Add Section
        </Button>
      </div>
    </DndContext>
  );
};

export default SongSections;
