import Button from "../../components/Button/Button";
import { SongOrder } from "../../types";
import Select from "../../components/Select/Select";
import { useEffect, useState } from "react";
import generateRandomId from "../../utils/generateRandomId";
import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { useSensors } from "../../utils/dndUtils";
import { SortableContext } from "@dnd-kit/sortable";
import SongSection from "./SongSection";
import { keepElementInView } from "../../utils/generalUtils";

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
  const [selectedIndex, setSelectedIndex] = useState(songOrder.length - 1);

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

  useEffect(() => {
    const itemElement = document.getElementById(
      `song-section-${selectedIndex}`
    );
    const parentElement = document.getElementById("song-sections-list");

    if (itemElement && parentElement) {
      keepElementInView({
        child: itemElement,
        parent: parentElement,
      });
    }
  }, [selectedIndex]);

  return (
    <DndContext onDragEnd={onDragEnd} sensors={sensors}>
      <h2 className="text-lg mb-2 text-center font-semibold">Song Order</h2>
      <ul
        id="song-sections-list"
        className="scrollbar-variable flex flex-col gap-2 overflow-y-auto overflow-x-hidden px-2 h-full"
        ref={setNodeRef}
      >
        <SortableContext items={songOrder.map(({ id }) => id)}>
          {songOrder.map(({ id, name }, index) => (
            <SongSection
              key={id}
              name={name}
              index={index}
              setSongOrder={setSongOrder}
              songOrder={songOrder}
              id={id}
              selectedIndex={selectedIndex}
              setSelectedIndex={setSelectedIndex}
            />
          ))}
        </SortableContext>
      </ul>
      <div className="mt-4">
        <h4 className="text-sm font-semibold w-full text-center">
          Select Section:
        </h4>
        <Select
          className="w-full text-sm"
          options={currentSections}
          value={section}
          onChange={(value) => setSection(value)}
        />
        <Button
          onClick={() => {
            const updatedSongOrder = [...songOrder];
            updatedSongOrder.splice(selectedIndex + 1, 0, {
              id: generateRandomId(),
              name: section || songOrder[0]?.name,
            });
            setSongOrder(updatedSongOrder);
            setSelectedIndex(selectedIndex + 1);
          }}
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
