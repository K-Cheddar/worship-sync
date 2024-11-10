import Button from "../../components/Button/Button";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { itemSectionBorderColorMap } from "../../utils/slideColorMap";
import { SongOrder } from "../../types";
import Select from "../../components/Select/Select";
import { useEffect, useState } from "react";
import generateRandomId from "../../utils/generateRandomId";

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

  return (
    <>
      <h2 className="text-lg mb-2 text-center font-semibold">Song Order</h2>
      <ul className="song-sections">
        {songOrder.map(({ id, name }, index) => (
          <li
            key={id}
            className={`flex items-center px-2 h-7 bg-black rounded-lg hover:bg-gray-800 cursor-pointer border-b-4 ${itemSectionBorderColorMap.get(
              name.split(" ")[0]
            )}`}
          >
            <p className="pr-1 text-base">{name}</p>
            <Button
              className="ml-auto"
              variant="tertiary"
              color="#dc2626"
              svg={DeleteSVG}
              onClick={() => {
                const copiedSongOrder = [...songOrder];
                copiedSongOrder.splice(index, 1);
                setSongOrder(copiedSongOrder);
              }}
            />
          </li>
        ))}
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
    </>
  );
};

export default SongSections;
