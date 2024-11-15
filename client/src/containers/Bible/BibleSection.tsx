import { useEffect, useState } from "react";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { bookType, chapterType, verseType } from "../../types";

type BibleSectionProps = {
  initialList: bookType[] | chapterType[] | verseType[];
  setValue: (value: number) => void;
  value: number;
  type: "book" | string;
  min?: number;
  searchValue: string;
  setSearchValue: (val: string) => void;
};

const BibleSection = ({
  initialList = [],
  setValue,
  value,
  type,
  min,
  searchValue,
  setSearchValue,
}: BibleSectionProps) => {
  const [filteredList, setFilteredList] = useState(initialList);

  useEffect(() => {
    let updatedFilteredList;

    if (type === "book") {
      updatedFilteredList = (initialList as bookType[]).filter(({ name }) =>
        name.toLowerCase().includes(searchValue.toLowerCase())
      );
      setFilteredList(updatedFilteredList);
    } else if (type === "chapter") {
      updatedFilteredList = (initialList as chapterType[]).filter(({ name }) =>
        name.includes(searchValue)
      );
      setFilteredList(updatedFilteredList);
    } else if (type === "verse") {
      updatedFilteredList = (initialList as verseType[]).filter(
        ({ name, index }) => {
          if (min) {
            return name.includes(searchValue) && index >= min;
          }
          return name.includes(searchValue);
        }
      );
      setFilteredList(updatedFilteredList);
    }

    const isValueInList = updatedFilteredList?.some(
      ({ index }) => index === value
    );

    if (updatedFilteredList?.[0] && !isValueInList) {
      setValue(updatedFilteredList[0].index);
    }
  }, [searchValue, initialList, setValue, type, value, min]);

  return (
    <div
      className={`flex flex-col gap-2 ${type === "book" ? "w-1/5" : "w-14"}`}
    >
      <Input
        data-ignore-undo="true"
        value={searchValue}
        onChange={(val) => setSearchValue(val as string)}
        label={type}
        className="bible-section-input"
        svg={searchValue ? CloseSVG : undefined}
        svgAction={() => setSearchValue("")}
      />
      <ul className="bible-section" tabIndex={-1}>
        {filteredList.map(({ name, index }) => {
          const isSelected = index === value;
          return (
            <li key={name}>
              <Button
                tabIndex={-1}
                variant="none"
                onClick={() => setValue(index)}
                className={`w-full items-center justify-center ${
                  isSelected ? "bg-gray-900" : "hover:bg-gray-500"
                }`}
              >
                {name}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default BibleSection;
