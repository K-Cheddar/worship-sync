import React from "react";
import { OverlayFormatting } from "../../types";
import Section from "./Section";
import InputField from "./InputField";
import SelectField from "./SelectField";
import WidthHeightField from "./WidthHeightField";
import ColorField from "../ColorField/ColorField";

interface StyleEditorProps {
  formatting: OverlayFormatting;
  onChange: (formatting: OverlayFormatting) => void;
}

type HeightWidthType = "fit-content" | "percent" | "auto" | "unset" | "number";

const StyleEditor: React.FC<StyleEditorProps> = ({ formatting, onChange }) => {
  const updateFormatting = (updates: Partial<OverlayFormatting>) => {
    onChange({ ...formatting, ...updates });
  };

  // Helper function to check if a section should be shown
  const shouldShowSection = (fields: string[]) => {
    return fields.some(
      (field) => formatting[field as keyof OverlayFormatting] !== undefined
    );
  };

  // Helper function to check if a field should be shown
  const shouldShowField = (field: string) => {
    return formatting[field as keyof OverlayFormatting] !== undefined;
  };

  const spacingFields = [
    { label: "Padding Top", key: "paddingTop", placeholder: "0" },
    { label: "Padding Bottom", key: "paddingBottom", placeholder: "0" },
    { label: "Padding Left", key: "paddingLeft", placeholder: "0" },
    { label: "Padding Right", key: "paddingRight", placeholder: "0" },
  ];

  const borderWidthFields = [
    { label: "Top Width", key: "borderTopWidth" },
    { label: "Bottom Width", key: "borderBottomWidth" },
    { label: "Left Width", key: "borderLeftWidth" },
    { label: "Right Width", key: "borderRightWidth" },
  ];

  const positionFields = [
    { label: "Top", key: "top", placeholder: "0" },
    { label: "Bottom", key: "bottom", placeholder: "0" },
    { label: "Left", key: "left", placeholder: "0" },
    { label: "Right", key: "right", placeholder: "0" },
  ];

  const childFontFields = [
    {
      label: "Font Size",
      labelKey: "child1Text",
      key: "child1FontSize",
      placeholder: "16",
    },
    {
      label: "Font Size",
      labelKey: "child2Text",
      key: "child2FontSize",
      placeholder: "14",
    },
    {
      label: "Font Size",
      labelKey: "child3Text",
      key: "child3FontSize",
      placeholder: "12",
    },
    {
      label: "Font Size",
      labelKey: "child4Text",
      key: "child4FontSize",
      placeholder: "10",
    },
  ];

  const childFontColorFields = [
    {
      label: "Font Color",
      labelKey: "child1Text",
      key: "child1FontColor",
    },
    {
      label: "Font Color",
      labelKey: "child2Text",
      key: "child2FontColor",
    },
    {
      label: "Font Color",
      labelKey: "child3Text",
      key: "child3FontColor",
    },
    {
      label: "Font Color",
      labelKey: "child4Text",
      key: "child4FontColor",
    },
  ];

  const childFontWeightFields = [
    {
      label: "Weight",
      labelKey: "child1Text",
      key: "child1FontWeight",
      placeholder: "400",
    },
    {
      label: "Weight",
      labelKey: "child2Text",
      key: "child2FontWeight",
      placeholder: "400",
    },
    {
      label: "Weight",
      labelKey: "child3Text",
      key: "child3FontWeight",
      placeholder: "400",
    },
    {
      label: "Weight",
      labelKey: "child4Text",
      key: "child4FontWeight",
      placeholder: "400",
    },
  ];

  const childFontStyleFields = [
    {
      label: "Style",
      labelKey: "child1Text",
      key: "child1FontStyle",
    },
    {
      label: "Style",
      labelKey: "child2Text",
      key: "child2FontStyle",
    },
    {
      label: "Style",
      labelKey: "child3Text",
      key: "child3FontStyle",
    },
    {
      label: "Style",
      labelKey: "child4Text",
      key: "child4FontStyle",
    },
  ];

  const childTextAlignFields = [
    {
      label: "Align",
      labelKey: "child1Text",
      key: "child1TextAlign",
    },
    {
      label: "Align",
      labelKey: "child2Text",
      key: "child2TextAlign",
    },
    {
      label: "Align",
      labelKey: "child3Text",
      key: "child3TextAlign",
    },
    {
      label: "Align",
      labelKey: "child4Text",
      key: "child4TextAlign",
    },
  ];

  const childWidthFields = [
    {
      label: "Width",
      labelKey: "child1Text",
      key: "child1Width",
      placeholder: "0",
    },
    {
      label: "Width",
      labelKey: "child2Text",
      key: "child2Width",
      placeholder: "0",
    },
    {
      label: "Width",
      labelKey: "child3Text",
      key: "child3Width",
      placeholder: "0",
    },
    {
      label: "Width",
      labelKey: "child4Text",
      key: "child4Width",
      placeholder: "0",
    },
  ];

  const childHeightFields = [
    {
      label: "Height",
      labelKey: "child1Text",
      key: "child1Height",
      placeholder: "0",
    },
    {
      label: "Height",
      labelKey: "child2Text",
      key: "child2Height",
      placeholder: "0",
    },
    {
      label: "Height",
      labelKey: "child3Text",
      key: "child3Height",
      placeholder: "0",
    },
    {
      label: "Height",
      labelKey: "child4Text",
      key: "child4Height",
      placeholder: "0",
    },
  ];

  return (
    <div className="space-y-6 h-full overflow-y-auto">
      {/* Layout & Position Section */}
      <Section
        title="Layout & Position"
        shouldShow={shouldShowSection([
          "width",
          "height",
          "maxWidth",
          "maxHeight",
          "minWidth",
          "minHeight",
          "top",
          "bottom",
          "left",
          "right",
          "child1Width",
          "child2Width",
          "child3Width",
          "child4Width",
          "child1Height",
          "child2Height",
          "child3Height",
          "child4Height",
        ])}
      >
        {shouldShowField("width") && (
          <WidthHeightField
            label="Width"
            value={
              (formatting.width as HeightWidthType) ||
              ("fit-content" as HeightWidthType)
            }
            onChange={(value) => updateFormatting({ width: value })}
            formatting={formatting}
          />
        )}
        {shouldShowField("height") && (
          <WidthHeightField
            label="Height"
            value={
              (formatting.height as HeightWidthType) ||
              ("fit-content" as HeightWidthType)
            }
            onChange={(value) => updateFormatting({ height: value })}
            formatting={formatting}
          />
        )}
        {shouldShowField("maxWidth") && (
          <InputField
            label="Max Width"
            type="number"
            value={formatting.maxWidth || ""}
            onChange={(value) => updateFormatting({ maxWidth: Number(value) })}
            placeholder="0"
            formatting={formatting}
            endAdornment={<div className="text-gray-500 text-sm">%</div>}
            step={0.5}
          />
        )}
        {shouldShowField("maxHeight") && (
          <InputField
            label="Max Height"
            type="number"
            value={formatting.maxHeight || ""}
            onChange={(value) => updateFormatting({ maxHeight: Number(value) })}
            placeholder="0"
            formatting={formatting}
            endAdornment={<div className="text-gray-500 text-sm">%</div>}
            step={0.5}
          />
        )}
        {shouldShowField("minWidth") && (
          <InputField
            label="Min Width"
            type="number"
            value={formatting.minWidth || ""}
            onChange={(value) => updateFormatting({ minWidth: Number(value) })}
            placeholder="0"
            formatting={formatting}
            endAdornment={<div className="text-gray-500 text-sm">%</div>}
            step={0.5}
          />
        )}
        {shouldShowField("minHeight") && (
          <InputField
            label="Min Height"
            type="number"
            value={formatting.minHeight || ""}
            onChange={(value) => updateFormatting({ minHeight: Number(value) })}
            placeholder="0"
            formatting={formatting}
            endAdornment={<div className="text-gray-500 text-sm">%</div>}
            step={0.5}
          />
        )}
        {positionFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                type="number"
                value={formatting[field.key as keyof OverlayFormatting] || ""}
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) })
                }
                placeholder={field.placeholder}
                formatting={formatting}
                endAdornment={<div className="text-gray-500 text-sm">%</div>}
                step={0.5}
              />
            ) : null
          )}
        {positionFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                type="number"
                value={formatting[field.key as keyof OverlayFormatting] || ""}
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) })
                }
                placeholder={field.placeholder}
                formatting={formatting}
                endAdornment={<div className="text-gray-500 text-sm">%</div>}
                step={0.5}
              />
            ) : null
          )}
        {childWidthFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <WidthHeightField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                value={
                  (formatting[
                    field.key as keyof OverlayFormatting
                  ] as HeightWidthType) || ("fit-content" as HeightWidthType)
                }
                onChange={(value) => updateFormatting({ [field.key]: value })}
                formatting={formatting}
              />
            ) : null
          )}
        {childWidthFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <WidthHeightField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                value={
                  (formatting[
                    field.key as keyof OverlayFormatting
                  ] as HeightWidthType) || ("fit-content" as HeightWidthType)
                }
                onChange={(value) => updateFormatting({ [field.key]: value })}
                formatting={formatting}
              />
            ) : null
          )}
        {childHeightFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <WidthHeightField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                value={
                  (formatting[
                    field.key as keyof OverlayFormatting
                  ] as HeightWidthType) || ("fit-content" as HeightWidthType)
                }
                onChange={(value) => updateFormatting({ [field.key]: value })}
                formatting={formatting}
              />
            ) : null
          )}
        {childHeightFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <WidthHeightField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                value={
                  (formatting[
                    field.key as keyof OverlayFormatting
                  ] as HeightWidthType) || ("fit-content" as HeightWidthType)
                }
                onChange={(value) => updateFormatting({ [field.key]: value })}
                formatting={formatting}
              />
            ) : null
          )}
      </Section>

      {/* Typography Section */}
      <Section
        title="Typography"
        shouldShow={shouldShowSection([
          "fontSize",
          "fontWeight",
          "fontStyle",
          "textAlign",
          "fontColor",
          "child1FontSize",
          "child2FontSize",
          "child3FontSize",
          "child4FontSize",
          "child1FontColor",
          "child2FontColor",
          "child3FontColor",
          "child4FontColor",
          "child1FontWeight",
          "child2FontWeight",
          "child3FontWeight",
          "child4FontWeight",
          "child1FontStyle",
          "child2FontStyle",
          "child3FontStyle",
          "child4FontStyle",
          "child1TextAlign",
          "child2TextAlign",
          "child3TextAlign",
          "child4TextAlign",
        ])}
      >
        {shouldShowField("fontSize") && (
          <InputField
            label="Font Size"
            type="number"
            value={(formatting.fontSize || 1.5) * 10}
            onChange={(value) =>
              updateFormatting({ fontSize: Number(value) / 10 })
            }
            placeholder="15"
            formatting={formatting}
          />
        )}
        {shouldShowField("fontWeight") && (
          <InputField
            label="Font Weight"
            type="number"
            value={formatting.fontWeight || ""}
            onChange={(value) =>
              updateFormatting({ fontWeight: Number(value) })
            }
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (!isNaN(value)) {
                // Round to nearest multiple of 100 between 100 and 900
                const rounded = Math.round(value / 100) * 100;
                const clamped = Math.max(100, Math.min(900, rounded));
                if (clamped !== value) {
                  updateFormatting({ fontWeight: clamped });
                }
              }
            }}
            placeholder="400"
            min={100}
            max={900}
            step={100}
            formatting={formatting}
          />
        )}
        {shouldShowField("textAlign") && (
          <SelectField
            label="Text Align"
            value={formatting.textAlign || "left"}
            onChange={(value) =>
              updateFormatting({
                textAlign: value as "left" | "right" | "center",
              })
            }
            options={[
              { label: "Left", value: "left" },
              { label: "Center", value: "center" },
              { label: "Right", value: "right" },
            ]}
            formatting={formatting}
          />
        )}
        {shouldShowField("fontStyle") && (
          <SelectField
            label="Font Style"
            value={formatting.fontStyle || "normal"}
            onChange={(value) =>
              updateFormatting({ fontStyle: value as "normal" | "italic" })
            }
            options={[
              { label: "Normal", value: "normal" },
              { label: "Italic", value: "italic" },
            ]}
            formatting={formatting}
          />
        )}
        {shouldShowField("fontColor") && (
          <ColorField
            label="Font Color"
            value={formatting.fontColor || "#ffffff"}
            onChange={(value) =>
              updateFormatting({ fontColor: value as string })
            }
            defaultColor="#ffffff"
            formatting={formatting}
          />
        )}
        {childFontFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                type="number"
                value={
                  ((formatting[
                    field.key as keyof OverlayFormatting
                  ] as number) || 1.5) * 10
                }
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) / 10 })
                }
                placeholder={field.placeholder}
                formatting={formatting}
              />
            ) : null
          )}
        {childFontFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                type="number"
                value={
                  ((formatting[
                    field.key as keyof OverlayFormatting
                  ] as number) || 1.5) * 10
                }
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) / 10 })
                }
                placeholder={field.placeholder}
                formatting={formatting}
              />
            ) : null
          )}

        {/* Child Font Colors */}
        {childFontColorFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <ColorField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                value={String(
                  formatting[field.key as keyof OverlayFormatting] || "#ffffff"
                )}
                onChange={(value) => updateFormatting({ [field.key]: value })}
                defaultColor="#ffffff"
                formatting={formatting}
              />
            ) : null
          )}
        {childFontColorFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <ColorField
                key={field.key}
                label={field.label}
                labelKey={field.labelKey}
                value={String(
                  formatting[field.key as keyof OverlayFormatting] || "#ffffff"
                )}
                onChange={(value) => updateFormatting({ [field.key]: value })}
                defaultColor="#ffffff"
                formatting={formatting}
              />
            ) : null
          )}

        {/* Child Font Weights */}
        {childFontWeightFields.slice(0, 2).map((field) =>
          shouldShowField(field.key) ? (
            <InputField
              key={field.key}
              label={field.label}
              labelKey={field.labelKey}
              type="number"
              value={formatting[field.key as keyof OverlayFormatting] || ""}
              onChange={(value) =>
                updateFormatting({ [field.key]: Number(value) })
              }
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (!isNaN(value)) {
                  const rounded = Math.round(value / 100) * 100;
                  const clamped = Math.max(100, Math.min(900, rounded));
                  if (clamped !== value) {
                    updateFormatting({ [field.key]: clamped });
                  }
                }
              }}
              placeholder={field.placeholder}
              min={100}
              max={900}
              step={100}
              formatting={formatting}
            />
          ) : null
        )}
        {childFontWeightFields.slice(2, 4).map((field) =>
          shouldShowField(field.key) ? (
            <InputField
              key={field.key}
              label={field.label}
              labelKey={field.labelKey}
              type="number"
              value={formatting[field.key as keyof OverlayFormatting] || ""}
              onChange={(value) =>
                updateFormatting({ [field.key]: Number(value) })
              }
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (!isNaN(value)) {
                  const rounded = Math.round(value / 100) * 100;
                  const clamped = Math.max(100, Math.min(900, rounded));
                  if (clamped !== value) {
                    updateFormatting({ [field.key]: clamped });
                  }
                }
              }}
              placeholder={field.placeholder}
              min={100}
              max={900}
              step={100}
              formatting={formatting}
            />
          ) : null
        )}

        {/* Child Font Styles */}
        {childFontStyleFields.slice(0, 2).map((field) =>
          shouldShowField(field.key) ? (
            <SelectField
              key={field.key}
              label={field.label}
              labelKey={field.labelKey}
              value={
                (formatting[field.key as keyof OverlayFormatting] as string) ||
                "normal"
              }
              onChange={(value) =>
                updateFormatting({ [field.key]: value as "normal" | "italic" })
              }
              options={[
                { label: "Normal", value: "normal" },
                { label: "Italic", value: "italic" },
              ]}
              formatting={formatting}
            />
          ) : null
        )}
        {childFontStyleFields.slice(2, 4).map((field) =>
          shouldShowField(field.key) ? (
            <SelectField
              key={field.key}
              label={field.label}
              labelKey={field.labelKey}
              value={
                (formatting[field.key as keyof OverlayFormatting] as string) ||
                "normal"
              }
              onChange={(value) =>
                updateFormatting({ [field.key]: value as "normal" | "italic" })
              }
              options={[
                { label: "Normal", value: "normal" },
                { label: "Italic", value: "italic" },
              ]}
              formatting={formatting}
            />
          ) : null
        )}

        {/* Child Text Aligns */}
        {childTextAlignFields.slice(0, 2).map((field) =>
          shouldShowField(field.key) ? (
            <SelectField
              key={field.key}
              label={field.label}
              labelKey={field.labelKey}
              value={
                (formatting[field.key as keyof OverlayFormatting] as string) ||
                "left"
              }
              onChange={(value) =>
                updateFormatting({
                  [field.key]: value as "left" | "right" | "center",
                })
              }
              options={[
                { label: "Left", value: "left" },
                { label: "Center", value: "center" },
                { label: "Right", value: "right" },
              ]}
              formatting={formatting}
            />
          ) : null
        )}
        {childTextAlignFields.slice(2, 4).map((field) =>
          shouldShowField(field.key) ? (
            <SelectField
              key={field.key}
              label={field.label}
              labelKey={field.labelKey}
              value={
                (formatting[field.key as keyof OverlayFormatting] as string) ||
                "left"
              }
              onChange={(value) =>
                updateFormatting({
                  [field.key]: value as "left" | "right" | "center",
                })
              }
              options={[
                { label: "Left", value: "left" },
                { label: "Center", value: "center" },
                { label: "Right", value: "right" },
              ]}
              formatting={formatting}
            />
          ) : null
        )}
      </Section>

      {/* Spacing Section */}
      <Section
        title="Spacing"
        shouldShow={shouldShowSection([
          "paddingTop",
          "paddingBottom",
          "paddingLeft",
          "paddingRight",
          "gap",
        ])}
      >
        {spacingFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                type="number"
                value={formatting[field.key as keyof OverlayFormatting] || ""}
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) })
                }
                placeholder={field.placeholder}
                formatting={formatting}
                step={0.5}
                endAdornment={<div className="text-gray-500 text-sm">%</div>}
              />
            ) : null
          )}
        {spacingFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                type="number"
                value={formatting[field.key as keyof OverlayFormatting] || ""}
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) })
                }
                placeholder={field.placeholder}
                formatting={formatting}
                step={0.5}
                endAdornment={<div className="text-gray-500 text-sm">%</div>}
              />
            ) : null
          )}
        {shouldShowField("gap") && (
          <InputField
            label="Gap"
            value={formatting.gap || 0}
            type="number"
            onChange={(value) => updateFormatting({ gap: Number(value) })}
            placeholder="0"
            formatting={formatting}
            step={0.5}
            endAdornment={<div className="text-gray-500 text-sm">%</div>}
          />
        )}
      </Section>

      {/* Colors Section */}
      <Section
        title="Colors"
        shouldShow={shouldShowSection([
          "backgroundColor",
          "borderColor",
          "borderLeftColor",
          "borderRightColor",
          "borderTopColor",
          "borderBottomColor",
        ])}
      >
        {shouldShowField("backgroundColor") && (
          <ColorField
            label="Background Color"
            value={formatting.backgroundColor || "#000000"}
            onChange={(value) =>
              updateFormatting({ backgroundColor: value as string })
            }
            defaultColor="#000000"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderColor") && (
          <ColorField
            label="Border Color"
            value={formatting.borderColor || "#ffffff"}
            onChange={(value) =>
              updateFormatting({ borderColor: value as string })
            }
            defaultColor="#ffffff"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderLeftColor") && (
          <ColorField
            label="Border Left Color"
            value={formatting.borderLeftColor || "#ffffff"}
            onChange={(value) =>
              updateFormatting({ borderLeftColor: value as string })
            }
            defaultColor="#ffffff"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderRightColor") && (
          <ColorField
            label="Border Right Color"
            value={formatting.borderRightColor || "#ffffff"}
            onChange={(value) =>
              updateFormatting({ borderRightColor: value as string })
            }
            defaultColor="#ffffff"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderTopColor") && (
          <ColorField
            label="Border Top Color"
            value={formatting.borderTopColor || "#ffffff"}
            onChange={(value) =>
              updateFormatting({ borderTopColor: value as string })
            }
            defaultColor="#ffffff"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderBottomColor") && (
          <ColorField
            label="Border Bottom Color"
            value={formatting.borderBottomColor || "#ffffff"}
            onChange={(value) =>
              updateFormatting({ borderBottomColor: value as string })
            }
            defaultColor="#ffffff"
            formatting={formatting}
          />
        )}
      </Section>

      {/* Border Section */}
      <Section
        title="Border"
        shouldShow={shouldShowSection([
          "borderType",
          "borderRadius",
          "borderRadiusTopLeft",
          "borderRadiusTopRight",
          "borderRadiusBottomLeft",
          "borderRadiusBottomRight",
          "borderTopWidth",
          "borderBottomWidth",
          "borderLeftWidth",
          "borderRightWidth",
        ])}
      >
        {shouldShowField("borderType") && (
          <SelectField
            label="Type"
            value={formatting.borderType || "solid"}
            onChange={(value) =>
              updateFormatting({
                borderType: value as "solid" | "dashed" | "dotted",
              })
            }
            options={[
              { label: "Solid", value: "solid" },
              { label: "Dashed", value: "dashed" },
              { label: "Dotted", value: "dotted" },
            ]}
            formatting={formatting}
          />
        )}
        {shouldShowField("borderRadius") && (
          <InputField
            label="Radius"
            value={formatting.borderRadius || ""}
            onChange={(value) =>
              updateFormatting({ borderRadius: value as string })
            }
            placeholder="0"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderRadiusTopLeft") && (
          <InputField
            label="Top Left Radius"
            value={formatting.borderRadiusTopLeft || ""}
            onChange={(value) =>
              updateFormatting({ borderRadiusTopLeft: value as string })
            }
            placeholder="0% 0%"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderRadiusTopRight") && (
          <InputField
            label="Top Right Radius"
            value={formatting.borderRadiusTopRight || ""}
            onChange={(value) =>
              updateFormatting({ borderRadiusTopRight: value as string })
            }
            placeholder="3% 10%"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderRadiusBottomLeft") && (
          <InputField
            label="Bot Left Radius"
            value={formatting.borderRadiusBottomLeft || ""}
            onChange={(value) =>
              updateFormatting({ borderRadiusBottomLeft: value as string })
            }
            placeholder="0% 0%"
            formatting={formatting}
          />
        )}
        {shouldShowField("borderRadiusBottomRight") && (
          <InputField
            label="Bot Right Radius"
            value={formatting.borderRadiusBottomRight || ""}
            onChange={(value) =>
              updateFormatting({ borderRadiusBottomRight: value as string })
            }
            placeholder="3% 10%"
            formatting={formatting}
          />
        )}
        {borderWidthFields
          .slice(0, 2)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                type="number"
                value={formatting[field.key as keyof OverlayFormatting] || ""}
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) })
                }
                placeholder="0"
                min={0}
                formatting={formatting}
              />
            ) : null
          )}
        {borderWidthFields
          .slice(2, 4)
          .map((field) =>
            shouldShowField(field.key) ? (
              <InputField
                key={field.key}
                label={field.label}
                type="number"
                value={formatting[field.key as keyof OverlayFormatting] || ""}
                onChange={(value) =>
                  updateFormatting({ [field.key]: Number(value) })
                }
                placeholder="0"
                min={0}
                formatting={formatting}
              />
            ) : null
          )}
      </Section>

      {/* Flexbox Section */}
      <Section
        title="Flexbox"
        shouldShow={shouldShowSection([
          "display",
          "flexDirection",
          "justifyContent",
          "alignItems",
        ])}
      >
        {shouldShowField("display") && (
          <SelectField
            label="Display"
            value={formatting.display || "block"}
            onChange={(value) =>
              updateFormatting({ display: value as "flex" | "block" })
            }
            options={[
              { label: "Block", value: "block" },
              { label: "Flex", value: "flex" },
            ]}
            formatting={formatting}
          />
        )}
        {shouldShowField("flexDirection") && (
          <SelectField
            label="Flex Direction"
            value={formatting.flexDirection || "row"}
            onChange={(value) =>
              updateFormatting({ flexDirection: value as "row" | "column" })
            }
            options={[
              { label: "Row", value: "row" },
              { label: "Column", value: "column" },
            ]}
            formatting={formatting}
          />
        )}
        {shouldShowField("justifyContent") && (
          <SelectField
            label="Justify Content"
            value={formatting.justifyContent || "flex-start"}
            onChange={(value) =>
              updateFormatting({
                justifyContent: value as
                  | "flex-start"
                  | "flex-end"
                  | "center"
                  | "space-between"
                  | "space-around",
              })
            }
            options={[
              { label: "Start", value: "flex-start" },
              { label: "End", value: "flex-end" },
              { label: "Center", value: "center" },
              { label: "Space Between", value: "space-between" },
              { label: "Space Around", value: "space-around" },
            ]}
            formatting={formatting}
          />
        )}
        {shouldShowField("alignItems") && (
          <SelectField
            label="Align Items"
            value={formatting.alignItems || "stretch"}
            onChange={(value) =>
              updateFormatting({
                alignItems: value as
                  | "flex-start"
                  | "flex-end"
                  | "center"
                  | "baseline"
                  | "stretch",
              })
            }
            options={[
              { label: "Start", value: "flex-start" },
              { label: "End", value: "flex-end" },
              { label: "Center", value: "center" },
              { label: "Baseline", value: "baseline" },
              { label: "Stretch", value: "stretch" },
            ]}
            formatting={formatting}
          />
        )}
      </Section>
    </div>
  );
};

export default StyleEditor;
