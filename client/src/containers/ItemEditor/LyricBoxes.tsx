import { useState } from "react";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import TextArea from "../../components/TextArea/TextArea";
import { useSelector } from "../../hooks";
import { sectionTypes, itemSectionBgColorMap } from "../../utils/slideColorMap";
import { FormattedLyrics as FormattedLyricsType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
  [1, "grid-cols-1"],
]);

type FormattedLyricsProps = {
  formattedLyrics: FormattedLyricsType[];
  setFormattedLyrics: (formattedLyrics: FormattedLyricsType[]) => void;
  reformatLyrics: (formattedLyrics: FormattedLyricsType[]) => void;
  availableSections: { value: string; label: string }[];
  onFormattedLyricsDelete: (index: number) => void;
  isMobile: boolean;
};

const LyricBoxes = ({
  formattedLyrics,
  setFormattedLyrics,
  reformatLyrics,
  availableSections,
  onFormattedLyricsDelete,
  isMobile,
}: FormattedLyricsProps) => {
  const { formattedLyricsPerRow } = useSelector((state) => state.preferences);

  const [newSectionType, setNewSectionType] = useState("Verse");

  const addSection = () => {
    reformatLyrics([
      ...formattedLyrics,
      {
        type: newSectionType,
        name: "",
        words: "",
        slideSpan: 1,
        id: generateRandomId(),
      },
    ]);
  };

  const changeSectionType = (name: string, index: number) => {
    const copiedFormattedLyrics = [...formattedLyrics];
    const lyric = { ...copiedFormattedLyrics[index] };

    const type = name.replace(/\s\d+$/, "");
    lyric.type = type;
    const newIndex =
      name === type
        ? formattedLyrics.length - 1
        : formattedLyrics.findIndex((item) => item.name === name);

    copiedFormattedLyrics.splice(index, 1);
    copiedFormattedLyrics.splice(newIndex, 0, lyric);

    reformatLyrics(copiedFormattedLyrics);
  };

  return (
    <ul
      className={`formatted-lyrics-list ${
        isMobile ? "grid-cols-1" : sizeMap.get(formattedLyricsPerRow)
      }`}
    >
      {formattedLyrics.map(({ id, type, name, words }, index) => (
        <li key={id} className="text-sm px-2">
          <div
            className={`formatted-lyrics-section ${itemSectionBgColorMap.get(
              type
            )}`}
          >
            <Select
              onChange={(val) => changeSectionType(val, index)}
              value={name}
              options={availableSections}
              className=""
            />
            <Button
              className="ml-auto"
              variant="tertiary"
              svg={DeleteSVG}
              onClick={() => {
                onFormattedLyricsDelete(index);
              }}
            />
          </div>
          <TextArea
            hideLabel
            className="h-[30vh]"
            data-ignore-undo="true"
            value={words}
            onChange={(val) => {
              const copiedFormattedLyrics = [...formattedLyrics];
              const lyric = { ...copiedFormattedLyrics[index] };
              lyric.words = val;
              copiedFormattedLyrics[index] = lyric;
              setFormattedLyrics(copiedFormattedLyrics);
            }}
          />
        </li>
      ))}
      <li className="flex flex-col px-2">
        <Select
          onChange={(val) => {
            setNewSectionType(val);
          }}
          value={newSectionType}
          options={sectionTypes.map((type) => ({ value: type, label: type }))}
          className={`formatted-lyrics-section ${itemSectionBgColorMap.get(
            newSectionType
          )}`}
        />
        <Button
          key="lyrics-box-add-section"
          onClick={() => addSection()}
          variant="tertiary"
          svg={AddSVG}
          iconSize={64}
          className="w-full flex-1 justify-center border border-slate-500 rounded-md"
        />
      </li>
    </ul>
  );
};

export default LyricBoxes;
