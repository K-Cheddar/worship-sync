import { useState } from "react";
import RadioButton from "../../components/RadioButton/RadioButton";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { useNavigate, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon/Icon";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import TextArea from "../../components/TextArea/TextArea";
import { setCreateItem } from "../../store/createItemSlice";
import { useDispatch } from "../../hooks";
import { useSelector } from "react-redux";

type ItemTypesType = {
  type: string;
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
];

const CreateItem = () => {
  const {
    name: savedName,
    type: savedType,
    text: savedText,
  } = useSelector((state: any) => state.createItem);
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
  const naviagte = useNavigate();
  const dispatch = useDispatch();

  const createItem = () => {
    dispatch(
      setCreateItem({
        name: itemName,
        type: selectedType,
        text,
      })
    );

    if (selectedType === "bible") {
      naviagte(`/controller/bible?name=${encodeURI(itemName)}`);
    }
  };

  return (
    <div>
      <h2 className="text-2xl text-center font-semibold ">Create Item</h2>
      <div className="my-2 mx-4 rounded-md p-4 bg-slate-800 w-56">
        <ul className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-center">
            Select Item Type
          </h3>
          <Input
            value={itemName}
            onChange={(val) => setItemName(val as string)}
            label="Item Name"
            className="text-base"
          />
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

        {selectedType !== "bible" && (
          <TextArea
            className="w-full h-72"
            label="Paste Text Here"
            value={text}
            onChange={(val) => setText(val)}
          />
        )}

        <Button
          disabled={!itemName}
          variant="cta"
          className="text-base w-full justify-center mt-4"
          onClick={createItem}
        >
          Create {itemTypes.find((item) => item.selected)?.label}
        </Button>
      </div>
    </div>
  );
};

export default CreateItem;
