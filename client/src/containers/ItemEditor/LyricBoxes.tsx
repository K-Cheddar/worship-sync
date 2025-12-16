import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import TextArea from "../../components/TextArea/TextArea";
import { useSelector } from "../../hooks";
import { sectionTypes, itemSectionBgColorMap } from "../../utils/slideColorMap";
import { FormattedLyrics as FormattedLyricsType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import { RootState } from "../../store/store";
import cn from "classnames";

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
  const { formattedLyricsPerRow } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

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
      className={cn(
        "scrollbar-variable grid gap-2 overflow-y-auto",
        isMobile ? "grid-cols-1" : sizeMap.get(formattedLyricsPerRow),
        "max-h-[calc(100%-clamp(2.5rem,2.5vw,3.5rem))]"
      )}
    >
      {formattedLyrics.map(({ id, type, name, words }, index) => (
        <li key={id} className="text-sm px-2">
          <div
            className={cn(
              "flex font-semibold text-sm rounded-t-md",
              itemSectionBgColorMap.get(type),
              "[&_select]:bg-gray-900/45 [&_select_option]:bg-gray-900 [&_select_option]:w-full [&_select_option]:text-base"
            )}
          >
            <Select
              onChange={(val) => changeSectionType(val, index)}
              value={name}
              options={availableSections}
              textColor="text-white"
            />
            <Button
              className="ml-auto"
              variant="tertiary"
              svg={Trash2}
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
            autoResize={isMobile}
            onChange={(val) => {
              const copiedFormattedLyrics = [...formattedLyrics];
              const lyric = { ...copiedFormattedLyrics[index] };
              lyric.words = val as string;
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
          className={cn(
            "flex font-semibold text-sm rounded-t-md",
            itemSectionBgColorMap.get(newSectionType),
            "[&_select]:bg-gray-900/45 [&_select_option]:bg-gray-900 [&_select_option]:w-full [&_select_option]:text-base"
          )}
          textColor="text-white"
        />
        <Button
          key="lyrics-box-add-section"
          onClick={() => addSection()}
          variant="tertiary"
          svg={Plus}
          iconSize={64}
          className="w-full flex-1 justify-center border border-gray-500 rounded-md"
        />
      </li>
    </ul>
  );
};

export default LyricBoxes;
