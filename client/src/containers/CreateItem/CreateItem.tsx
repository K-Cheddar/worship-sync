import { useContext, useMemo, useState } from "react";
import RadioButton from "../../components/RadioButton/RadioButton";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { useNavigate, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon/Icon";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import TextArea from "../../components/TextArea/TextArea";
import { setCreateItem } from "../../store/createItemSlice";
import { useDispatch } from "../../hooks";
import { useSelector } from "react-redux";
import {
  createNewFreeForm,
  createNewSong,
  createNewTimer,
  createSections,
  updateFormattedSections,
} from "../../utils/itemUtil";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { ItemState, ItemType, ServiceItem } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { addTimer } from "../../store/timersSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

type ItemTypesType = {
  type: ItemType;
  selected: boolean;
  label: string;
};

const types: ItemTypesType[] = [
  {
    type: "song",
    selected: true,
    label: "Song",
  },
  {
    type: "bible",
    selected: false,
    label: "Bible",
  },
  {
    type: "free",
    selected: false,
    label: "Free Form",
  },
  {
    type: "timer",
    selected: false,
    label: "Timer",
  },
];

const CreateItem = () => {
  const {
    name: savedName,
    type: savedType,
    text: savedText,
  } = useSelector((state: RootState) => state.createItem);
  const { list } = useSelector((state: RootState) => state.allItems);

  const {
    preferences: {
      defaultSongBackground,
      defaultTimerBackground,
      defaultFreeFormBackground,
      defaultSongBackgroundBrightness,
      defaultTimerBackgroundBrightness,
      defaultFreeFormBackgroundBrightness,
    },
  } = useSelector((state: RootState) => state.undoable.present.preferences);
  const { hostId } = useContext(GlobalInfoContext) || {};

  const [searchParams] = useSearchParams();
  const initialType = decodeURI(
    searchParams.get("type") || savedType || "song"
  );
  const initialName = decodeURI(searchParams.get("name") || savedName || "");
  const [text, setText] = useState<string>(savedText);
  const [selectedType, setSelectedType] = useState<string>(initialType);
  const [itemTypes, setItemTypes] = useState<ItemTypesType[]>(
    types.map((type) => ({ ...type, selected: type.type === initialType }))
  );
  const [itemName, setItemName] = useState<string>(initialName);
  const [duration, setDuration] = useState<number>(60);
  const [time, setTime] = useState<string>("00:00");
  const [timerType, setTimerType] = useState<"countdown" | "timer">("timer");
  const [justAdded, setJustAdded] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};

  const naviagte = useNavigate();
  const dispatch = useDispatch();

  const existingItem: ServiceItem | undefined = useMemo(() => {
    if (selectedType !== "bible") {
      return (list as ServiceItem[]).find(
        (item) =>
          item.name.toLowerCase().trim() === itemName.toLowerCase().trim() &&
          item.type === selectedType
      );
    }
    return undefined;
  }, [itemName, list, selectedType]);

  const dispatchNewItem = (item: ItemState) => {
    const listItem = {
      name: item.name,
      type: item.type,
      background: item.background,
      _id: item._id,
      listId: generateRandomId(),
    };
    dispatch(setActiveItem(item));
    dispatch(addItemToItemList(listItem));
    dispatch(addItemToAllItemsList(listItem));
  };

  const createItem = async () => {
    if (selectedType === "song") {
      const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
        createSections({
          unformattedLyrics: text,
        });

      const { formattedLyrics, songOrder } = updateFormattedSections({
        formattedLyrics: _formattedLyrics,
        songOrder: _songOrder,
      });

      const newItem = await createNewSong({
        name: itemName,
        formattedLyrics,
        songOrder,
        list,
        db,
        background: defaultSongBackground,
        brightness: defaultSongBackgroundBrightness,
        isMobile,
      });

      dispatchNewItem(newItem);
    }

    if (selectedType === "free") {
      const newItem = await createNewFreeForm({
        name: itemName,
        list,
        db,
        background: defaultFreeFormBackground,
        brightness: defaultFreeFormBackgroundBrightness,
        text,
        isMobile,
      });

      dispatchNewItem(newItem);
    }

    if (selectedType === "bible") {
      dispatch(
        setCreateItem({
          name: itemName,
          type: selectedType,
          text,
        })
      );
      naviagte(`/controller/bible?name=${encodeURI(itemName)}`);
    }

    if (selectedType === "timer") {
      const newItem = await createNewTimer({
        name: itemName,
        list,
        db,
        hostId: hostId || "",
        duration,
        countdownTime: time,
        timerType,
        background: defaultTimerBackground,
        brightness: defaultTimerBackgroundBrightness,
      });

      dispatchNewItem(newItem);
      if (newItem.timerInfo) {
        dispatch(addTimer(newItem.timerInfo));
      }
    }

    setItemName("");
    setText("");
    setJustCreated(true);
    setTimeout(() => setJustCreated(false), 2000);
  };

  const addItem = () => {
    if (!existingItem) return;
    dispatch(addItemToItemList(existingItem));
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2000);
  };

  return (
    <ErrorBoundary>
      <h2 className="text-2xl text-center font-semibold ">Create Item</h2>
      <div className="my-2 mx-4 rounded-md p-4 bg-gray-800 w-1/2 max-lg:w-[95%]">
        <ul className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-center">
            Select Item Type
          </h3>
          <Input
            value={itemName}
            onChange={(val) => setItemName(val as string)}
            label="Item Name"
            className="text-base"
            data-ignore-undo="true"
          />
          {existingItem && (
            <p className="text-cyan-400 bg-gray-600 text-sm rounded-md p-1">
              <span className="italic">"{existingItem.name}"</span>
              <span> already exists.</span>
              <Button
                variant="tertiary"
                className="inline"
                onClick={addItem}
                svg={justAdded ? CheckSVG : AddSVG}
                color={justAdded ? "#84cc16" : "#22d3ee"}
                disabled={justAdded}
              >
                {justAdded ? "Added!" : "Add to outline"}
              </Button>
            </p>
          )}
          {itemTypes.map((itemType) => (
            <li key={itemType.type} className="flex gap-2 item-center">
              <Icon
                svg={svgMap.get(itemType.type) || UnknownSVG}
                color={iconColorMap.get(itemType.type)}
              />
              <RadioButton
                label={itemType.label}
                value={itemType.selected}
                textSize="text-base"
                className="w-24"
                onChange={() => {
                  setSelectedType(itemType.type);
                  setItemTypes((prev) =>
                    prev.map((item) => ({
                      ...item,
                      selected: item.type === itemType.type,
                    }))
                  );
                }}
              />
            </li>
          ))}
        </ul>

        {(selectedType === "song" || selectedType === "free") && (
          <TextArea
            className="w-full h-72 mt-2 flex flex-col"
            label="Paste Text Here"
            value={text}
            onChange={(val) => setText(val as string)}
            data-ignore-undo="true"
          />
        )}

        {selectedType === "timer" && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex gap-4">
              <RadioButton
                label="Timer"
                value={timerType === "timer"}
                textSize="text-base"
                onChange={() => setTimerType("timer")}
                data-ignore-undo="true"
              />
              <RadioButton
                label="Countdown"
                value={timerType === "countdown"}
                textSize="text-base"
                onChange={() => setTimerType("countdown")}
                data-ignore-undo="true"
              />
            </div>
            {timerType === "countdown" && (
              <div className="flex gap-2">
                <Input
                  type="time"
                  label="Countdown To"
                  value={time}
                  onChange={(val) => setTime(val as string)}
                  data-ignore-undo="true"
                />
              </div>
            )}
            {timerType === "timer" && (
              <div className="flex gap-2">
                <Input
                  label="Hours"
                  type="number"
                  hideSpinButtons
                  min={0}
                  value={Math.floor(duration / 3600)}
                  onChange={(val) =>
                    setDuration(
                      Number(val) * 3600 +
                        Math.floor((duration % 3600) / 60) * 60 +
                        (duration % 60)
                    )
                  }
                  data-ignore-undo="true"
                />
                <Input
                  label="Minutes"
                  type="number"
                  min={0}
                  max={59}
                  hideSpinButtons
                  value={Math.floor((duration % 3600) / 60)}
                  onChange={(val) =>
                    setDuration(
                      Math.floor(duration / 3600) * 3600 +
                        Number(val) * 60 +
                        (duration % 60)
                    )
                  }
                  data-ignore-undo="true"
                />
                <Input
                  label="Seconds"
                  type="number"
                  min={0}
                  max={59}
                  hideSpinButtons
                  value={duration % 60}
                  onChange={(val) =>
                    setDuration(
                      Math.floor(duration / 3600) * 3600 +
                        Math.floor((duration % 3600) / 60) * 60 +
                        Number(val)
                    )
                  }
                  data-ignore-undo="true"
                />
              </div>
            )}
          </div>
        )}

        <Button
          disabled={!itemName || !!existingItem || justCreated}
          variant="cta"
          className="text-base w-full justify-center mt-4"
          onClick={createItem}
          svg={justCreated ? CheckSVG : AddSVG}
          color={justCreated ? "#84cc16" : undefined}
        >
          {justCreated
            ? "Created!"
            : `Create ${itemTypes.find((item) => item.selected)?.label}`}
        </Button>
      </div>
    </ErrorBoundary>
  );
};

export default CreateItem;
