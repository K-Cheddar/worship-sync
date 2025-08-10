import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import { useDispatch, useSelector } from "../../../hooks";
import { updateSlides } from "../../../store/itemSlice";
import { useMemo, useRef, useState } from "react";
import RadioButton from "../../../components/RadioButton/RadioButton";
import { ReactComponent as ColorSVG } from "../../../assets/icons/text-color.svg";
import { ReactComponent as ExpandSVG } from "../../../assets/icons/expand.svg";
import { ReactComponent as BGOne } from "../../../assets/icons/background-one.svg";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../../assets/icons/remove.svg";
import { ReactComponent as AlignLeftSVG } from "../../../assets/icons/align-left.svg";
import { ReactComponent as AlignCenterSVG } from "../../../assets/icons/align-center.svg";
import { ReactComponent as AlignRightSVG } from "../../../assets/icons/align-right.svg";
import { ReactComponent as TextFieldSVG } from "../../../assets/icons/text-field.svg";
import { ReactComponent as BoldSVG } from "../../../assets/icons/format-bold.svg";
import { ReactComponent as ItalicSVG } from "../../../assets/icons/format-italic.svg";
import PopOver from "../../../components/PopOver/PopOver";
import { updateFormattedTextDisplayInfo } from "../../../utils/formatter";
import {
  HexColorInput,
  HexColorPicker,
  HexAlphaColorPicker,
} from "react-colorful";
import cn from "classnames";
import Icon from "../../../components/Icon/Icon";

type fieldType =
  | "paddingX"
  | "paddingY"
  | "fontSize"
  | "textColor"
  | "backgroundColor"
  | "align"
  | "isBold"
  | "isItalic";

const FormattedTextEditor = ({ className }: { className?: string }) => {
  const item = useSelector((state) => state.undoable.present.item);

  const { slides, selectedSlide, type } = item;

  const formattedTextDisplayInfo = useMemo(() => {
    return slides[selectedSlide]?.formattedTextDisplayInfo;
  }, [slides, selectedSlide]);

  const [formattedTextState, setFormattedTextState] = useState({
    backgroundColor: formattedTextDisplayInfo?.backgroundColor || "#eb8934",
    textColor: formattedTextDisplayInfo?.textColor || "#ffffff",
    fontSize: (formattedTextDisplayInfo?.fontSize || 1.5) * 10,
    paddingX: formattedTextDisplayInfo?.paddingX || 2,
    paddingY: formattedTextDisplayInfo?.paddingY || 1,
    align: formattedTextDisplayInfo?.align || "left",
    isBold: formattedTextDisplayInfo?.isBold || false,
    isItalic: formattedTextDisplayInfo?.isItalic || false,
  });

  const dispatch = useDispatch();

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [shouldApplyToAll, setShouldApplyToAll] = useState(true);

  const runUpdate = (
    field: fieldType,
    updatedValue: string | number | boolean,
  ) => {
    const updatedItem = updateFormattedTextDisplayInfo({
      formattedTextDisplayInfo: {
        ...formattedTextDisplayInfo,
        text: formattedTextDisplayInfo?.text || "",
        [field]: updatedValue,
      },
      item: item,
      shouldApplyToAll: shouldApplyToAll,
    });
    dispatch(updateSlides({ slides: updatedItem.slides }));
  };

  const handleChange = (field: fieldType, value: string) => {
    let updatedValue: string | number | boolean = value;
    let numValue = parseFloat(value);

    if (field === "paddingX" || field === "paddingY") {
      if (numValue > 100) numValue = 100;
      if (numValue < 0) numValue = 0;
      if (isNaN(numValue)) numValue = 0;
      updatedValue = numValue;
    }
    if (field === "fontSize") {
      let numValue = parseFloat(value);
      numValue = Math.round(Math.max(Math.min(numValue, 150), 1));
      updatedValue = numValue / 10;
    }
    if (field === "isBold" || field === "isItalic") {
      updatedValue = value === "true" ? true : false;
    }

    if (field === "textColor" || field === "backgroundColor") {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        setFormattedTextState({
          ...formattedTextState,
          [field]: updatedValue,
        });
        runUpdate(field, updatedValue);
      }, 250);
    } else if (field === "fontSize") {
      setFormattedTextState({
        ...formattedTextState,
        [field]: numValue,
      });
      runUpdate(field, updatedValue);
    } else {
      runUpdate(field, updatedValue);
      setFormattedTextState({
        ...formattedTextState,
        [field]: updatedValue,
      });
    }
  };

  if (type !== "free")
    return (
      <section className="flex flex-wrap max-lg:pb-4 invisible">
        <Button
          svg={TextFieldSVG}
          iconSize="lg"
          padding="py-1 px-0"
          className="w-0"
        />
      </section>
    );

  const controls = (
    <>
      <section className="flex gap-1 items-center">
        <Icon svg={TextFieldSVG} className="border-b border-black" />
        <Button
          svg={MinusSVG}
          variant="tertiary"
          onClick={() =>
            handleChange(
              "fontSize",
              (formattedTextState.fontSize - 1).toString(),
            )
          }
        />
        <Input
          label="Font Size"
          type="number"
          value={formattedTextState.fontSize}
          onChange={(val) => handleChange("fontSize", val.toString())}
          className="w-8 2xl:w-10"
          inputTextSize="text-xs"
          hideLabel
          data-ignore-undo="true"
        />
        <Button
          svg={AddSVG}
          variant="tertiary"
          onClick={() =>
            handleChange(
              "fontSize",
              (formattedTextState.fontSize + 1).toString(),
            )
          }
        />
        <PopOver
          TriggeringButton={
            <Button
              variant="tertiary"
              className="border-b-2"
              svg={ColorSVG}
              style={{ borderColor: formattedTextState.textColor }}
            />
          }
        >
          <HexColorPicker
            color={formattedTextState.textColor}
            onChange={(val) => handleChange("textColor", val)}
          />
          <HexColorInput
            color={formattedTextState.textColor}
            prefixed
            onChange={(val) => handleChange("textColor", val)}
            className="text-black w-full mt-2"
          />
        </PopOver>
        <Button
          variant={formattedTextState.isBold ? "secondary" : "tertiary"}
          svg={BoldSVG}
          onClick={() =>
            handleChange("isBold", formattedTextState.isBold ? "false" : "true")
          }
        />
        <Button
          variant={formattedTextState.isItalic ? "secondary" : "tertiary"}
          svg={ItalicSVG}
          onClick={() =>
            handleChange(
              "isItalic",
              formattedTextState.isItalic ? "false" : "true",
            )
          }
        />
        <Button
          variant={
            formattedTextState.align === "left" ? "secondary" : "tertiary"
          }
          svg={AlignLeftSVG}
          onClick={() => handleChange("align", "left")}
        />
        <Button
          variant={
            formattedTextState.align === "center" ? "secondary" : "tertiary"
          }
          svg={AlignCenterSVG}
          onClick={() => handleChange("align", "center")}
        />
        <Button
          variant={
            formattedTextState.align === "right" ? "secondary" : "tertiary"
          }
          svg={AlignRightSVG}
          onClick={() => handleChange("align", "right")}
        />
      </section>
      <section className="flex gap-2 items-center lg:border-l-2 lg:pl-2 max-lg:border-t-2 max-lg:pt-4">
        <PopOver
          TriggeringButton={
            <Button
              variant="tertiary"
              className="border-b-2"
              svg={BGOne}
              style={{ borderColor: formattedTextState.backgroundColor }}
            />
          }
        >
          <HexAlphaColorPicker
            color={formattedTextState.backgroundColor}
            onChange={(val) => handleChange("backgroundColor", val)}
          />
          <HexColorInput
            color={formattedTextState.backgroundColor}
            prefixed
            onChange={(val) => handleChange("backgroundColor", val)}
            className="text-black w-full mt-2"
          />
        </PopOver>
        <Input
          type="number"
          value={formattedTextState.paddingX}
          inputTextSize="text-xs"
          onChange={(value) => handleChange("paddingX", value.toString())}
          label="Padding X"
          labelClassName="mr-2 text-xs"
          min={0}
          max={100}
          step={0.5}
          inputWidth="w-12"
          hideSpinButtons={false}
        />
        <Input
          type="number"
          value={formattedTextState.paddingY}
          inputTextSize="text-xs"
          onChange={(value) => handleChange("paddingY", value.toString())}
          label="Padding Y"
          labelClassName="mr-2 text-xs"
          min={0}
          max={100}
          step={0.5}
          inputWidth="w-12"
          hideSpinButtons={false}
        />
      </section>

      <section className="flex gap-1 items-center">
        <RadioButton
          className="text-xs w-fit"
          label="Apply to selected"
          value={!shouldApplyToAll}
          onChange={() => setShouldApplyToAll(false)}
        />
        <RadioButton
          label="Apply to all"
          className="text-xs w-fit"
          value={shouldApplyToAll}
          onChange={() => setShouldApplyToAll(true)}
        />
        {/* Keep the height the same as other sections */}
        <Button svg={TextFieldSVG} iconSize="lg" className="invisible" />
      </section>
    </>
  );

  return (
    <section className={cn("flex gap-1 items-center", className)}>
      <div className="max-lg:hidden flex gap-2 items-center">{controls}</div>
      <PopOver
        TriggeringButton={
          <Button className="lg:hidden" variant="tertiary" svg={ExpandSVG}>
            Tools
          </Button>
        }
      >
        <div className="flex flex-col gap-4 items-center p-4">{controls}</div>
      </PopOver>
    </section>
  );
};

export default FormattedTextEditor;
