import { Plus } from "lucide-react";
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
  /** Remount Radix Select after each add so the same option can be chosen again. */
  const [addSectionSelectKey, setAddSectionSelectKey] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(songOrder.length - 1);

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

  const addSectionFromPicker = (nextSection: string) => {
    if (!nextSection) return;

    const updatedSongOrder = [...songOrder];
    const nextIndex = Math.max(selectedIndex + 1, 0);
    updatedSongOrder.splice(nextIndex, 0, {
      id: generateRandomId(),
      name: nextSection,
    });
    setSongOrder(updatedSongOrder);
    setSelectedIndex(nextIndex);
    setAddSectionSelectKey((k) => k + 1);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <DndContext onDragEnd={onDragEnd} sensors={sensors}>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <h3 className="shrink-0 text-base font-semibold text-gray-100">
            Song order
          </h3>
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 p-2">
            <ul
              id="song-sections-list"
              className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden"
              ref={setNodeRef}
            >
              {songOrder.length === 0 ? (
                <li className="px-1 py-6 text-center text-sm leading-snug text-gray-400">
                  No sections in the order yet. Use{" "}
                  <span className="font-medium text-gray-300">Add section</span>{" "}
                  or add lyrics—new sections can follow your “Add to Song Order”
                  setting.
                </li>
              ) : (
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
              )}
            </ul>
          </div>
          <div className="shrink-0">
            <Select
              key={addSectionSelectKey}
              className="sr-only"
              options={currentSections}
              value=""
              onChange={addSectionFromPicker}
              id="song-order-add-section-select"
              hideLabel
              label="Add section"
              backgroundColor="bg-black/40"
              textColor="text-white"
              chevronColor="text-white"
              contentBackgroundColor="bg-gray-900"
              contentTextColor="text-white"
            />
            <Button
              variant="primary"
              svg={Plus}
              color="#22d3ee"
              iconSize="sm"
              onClick={() => {
                const trigger = document.getElementById(
                  "song-order-add-section-select",
                );
                if (trigger instanceof HTMLButtonElement) {
                  trigger.click();
                }
              }}
              className="h-9 w-full justify-center gap-2"
              disabled={currentSections.length === 0}
            >
              Add section
            </Button>
          </div>
        </div>
      </DndContext>
    </div>
  );
};

export default SongSections;
