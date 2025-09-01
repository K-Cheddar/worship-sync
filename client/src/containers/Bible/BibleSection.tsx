import { useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import { bookType, chapterType, verseType } from "../../types";
import { keepElementInView } from "../../utils/generalUtils";

type BibleSectionProps = {
  initialList: bookType[] | chapterType[] | verseType[];
  setValue: (value: number) => void;
  value: number;
  type: "book" | string;
  min?: number;
  searchValue: string;
  label?: string;
};

const BibleSection = ({
  initialList = [],
  setValue,
  value,
  type,
  min,
  searchValue,
  label,
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
  }, [searchValue, initialList, setValue, type, value, min, label]);

  useEffect(() => {
    const currentElement = document.getElementById(
      `bible-section-${label || type}-${value}`
    );
    const parentElement = document.getElementById(
      `bible-section-${label || type}`
    );

    const scrollToElement = () => {
      if (currentElement && parentElement) {
        keepElementInView({
          child: currentElement,
          parent: parentElement,
        });
      }
    };

    scrollToElement();
  }, [value, label, type]);

  return (
    <div
      className={"flex flex-col gap-2 h-full"}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          const currentIndex = filteredList.findIndex(
            ({ index }) => index === value
          );
          const nextIndex = Math.min(currentIndex + 1, filteredList.length - 1);
          const nextItem = filteredList[nextIndex];
          if (nextItem) {
            setValue(nextItem.index);
          }
          e.preventDefault();
        }
        if (e.key === "ArrowUp") {
          const currentIndex = filteredList.findIndex(
            ({ index }) => index === value
          );
          const prevIndex = Math.max(currentIndex - 1, 0);
          const prevItem = filteredList[prevIndex];
          if (prevItem) {
            setValue(prevItem.index);
          }
          e.preventDefault();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const currentElement = document.getElementById(
            `bible-section-${label || type}-${value}`
          );
          if (currentElement) {
            currentElement.focus();
          }
        }
      }}
    >
      <p className="text-sm font-semibold text-center capitalize bg-gray-800 px-2 py-1 rounded-md">
        {label || type}
      </p>
      <ul
        className="bible-section"
        id={`bible-section-${label || type}`}
        tabIndex={-1}
      >
        {filteredList.map(({ name, index }) => {
          const isSelected = index === value;
          return (
            <li key={name}>
              <Button
                tabIndex={-1}
                variant="none"
                truncate
                id={`bible-section-${label || type}-${index}`}
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
