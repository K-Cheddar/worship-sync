import React from "react";
import { OverlayFormatting } from "../../types";
import PopOver from "../PopOver/PopOver";
import Button from "../Button/Button";
import { HexAlphaColorPicker, HexColorInput } from "react-colorful";

interface ColorFieldProps {
  label: string;
  labelKey?: string;
  value: string;
  onChange: (value: string) => void;
  defaultColor?: string;
  formatting?: OverlayFormatting;
}

const getContrastingTextColor = (hex: string) => {
  // Remove '#' if present
  hex = hex.replace(/^#/, "");

  // Expand shorthand (e.g. #abc → #aabbcc)
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  // Parse RGB values
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Calculate luminance using the WCAG formula
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // Return black for light backgrounds, white for dark
  return luminance > 128 ? "#000000" : "#FFFFFF";
};

const ColorField: React.FC<ColorFieldProps> = ({
  label,
  labelKey,
  value,
  onChange,
  defaultColor = "#ffffff",
  formatting,
}) => {
  const val = value || defaultColor;
  return (
    <div className="flex flex-col gap-2 items-center">
      <label className="block text-sm font-medium text-white whitespace-nowrap">
        {labelKey && formatting
          ? `${formatting[labelKey as keyof OverlayFormatting] as string} ${label}`
          : label}
        :
      </label>
      <PopOver
        TriggeringButton={
          <Button
            variant="tertiary"
            className="w-full h-6 border-2"
            style={{
              backgroundColor: val,
              borderColor: getContrastingTextColor(val),
              color: getContrastingTextColor(val),
            }}
          >
            {val}
          </Button>
        }
      >
        <HexAlphaColorPicker color={val} onChange={onChange} />
        <HexColorInput
          color={val}
          prefixed
          onChange={onChange}
          className="text-black w-full mt-2"
        />
      </PopOver>
    </div>
  );
};

export default ColorField;
