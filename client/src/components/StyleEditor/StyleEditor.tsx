import React, { useState } from "react";
import { OverlayFormatting, OverlayChild } from "../../types";
import Section from "./Section";
import InputField from "./InputField";
import SelectField from "./SelectField";
import MeasurementField, { MeasurementType } from "./MeasurementField";
import ColorField from "../ColorField/ColorField";
import Toggle from "../Toggle/Toggle";

interface StyleEditorProps {
  formatting: OverlayFormatting;
  onChange: (formatting: OverlayFormatting) => void;
}

type FieldConfig<T extends OverlayFormatting | OverlayChild> = {
  label: string;
  key: keyof T;
  type: "input" | "select" | "measurement" | "color";
  inputType?: "number" | "text";
  placeholder?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  endAdornment?: React.ReactNode;
  defaultColor?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
};

const StyleEditor: React.FC<StyleEditorProps> = ({ formatting, onChange }) => {
  const [showHiddenSections, setShowHiddenSections] = useState(false);

  const updateFormatting = (updates: Partial<OverlayFormatting>) => {
    onChange({ ...formatting, ...updates });
  };

  const updateChild = (index: number, updates: Partial<OverlayChild>) => {
    const children = [...(formatting.children || [])];
    children[index] = { ...children[index], ...updates };
    onChange({ ...formatting, children });
  };

  // Helper function to check if a section should be shown
  const shouldShowSection = (fields: (keyof OverlayFormatting)[]) => {
    if (showHiddenSections) return true;
    return fields.some((field) => formatting[field] !== undefined);
  };

  // Helper function to check if a field should be shown
  const shouldShowField = (
    data: OverlayFormatting,
    field: keyof OverlayFormatting
  ) => {
    if (showHiddenSections) return true;
    const value = data[field];
    return value !== undefined && value !== null && value !== "";
  };

  // Helper function to check if a child section should be shown
  const shouldShowChildSection = (
    child: OverlayChild,
    fields: (keyof OverlayChild)[]
  ) => {
    if (showHiddenSections) return true;
    return fields.some((field) => child[field] !== undefined);
  };

  // Helper function to check if a child field should be shown
  const shouldShowChildField = (
    child: OverlayChild,
    field: keyof OverlayChild
  ) => {
    if (showHiddenSections) return true;
    const value = child[field];
    return value !== undefined && value !== null && value !== "";
  };

  // Generic field renderer that works for both main formatting and child elements
  const renderField = <T extends OverlayFormatting | OverlayChild>(
    config: FieldConfig<T>,
    data: T,
    onUpdate: (updates: Partial<T>) => void,
    index?: number
  ) => {
    const shouldShow =
      index !== undefined
        ? shouldShowChildField(
            data as OverlayChild,
            config.key as keyof OverlayChild
          )
        : shouldShowField(
            data as OverlayFormatting,
            config.key as keyof OverlayFormatting
          );

    if (!shouldShow) return null;

    const commonProps = {
      label: config.label,
      formatting,
      placeholder: config.placeholder,
    };

    const key = config.key;
    const value = data[key];

    switch (config.type) {
      case "input":
        const inputType = config.inputType || "number";
        return (
          <InputField
            {...commonProps}
            type={inputType}
            value={
              inputType === "number"
                ? typeof value === "number"
                  ? value
                  : ""
                : String(value || "")
            }
            onChange={(value) => {
              const updates = {
                [key]: inputType === "number" ? Number(value) : value,
              } as Partial<T>;
              onUpdate(updates);
            }}
            min={config.min}
            max={config.max}
            step={config.step}
            endAdornment={config.endAdornment}
            onBlur={config.onBlur}
          />
        );
      case "select":
        return (
          <SelectField
            {...commonProps}
            value={String(value || config.options?.[0]?.value || "")}
            onChange={(value) => onUpdate({ [key]: value } as Partial<T>)}
            options={config.options || []}
          />
        );
      case "measurement":
        return (
          <MeasurementField
            {...commonProps}
            value={(value as MeasurementType) || "fit-content"}
            onChange={(value) => onUpdate({ [key]: value } as Partial<T>)}
          />
        );
      case "color":
        return (
          <ColorField
            {...commonProps}
            value={String(value || config.defaultColor || "#ffffff")}
            onChange={(value) => onUpdate({ [key]: value } as Partial<T>)}
            defaultColor={config.defaultColor || "#ffffff"}
          />
        );
      default:
        return null;
    }
  };

  // Generic utility functions that work for both main and child fields
  const createInputField = <T extends OverlayFormatting | OverlayChild>(
    key: string,
    label: string,
    placeholder: string,
    options?: {
      step?: number;
      endAdornment?: React.ReactNode;
      min?: number;
      max?: number;
    }
  ): FieldConfig<T> => ({
    label,
    key: key as keyof T,
    type: "input" as const,
    placeholder,
    ...options,
  });

  const createSelectField = <T extends OverlayFormatting | OverlayChild>(
    key: string,
    label: string,
    options: { label: string; value: string }[]
  ): FieldConfig<T> => ({
    label,
    key: key as keyof T,
    type: "select" as const,
    options,
  });

  const createColorField = <T extends OverlayFormatting | OverlayChild>(
    key: string,
    label: string,
    defaultColor: string
  ): FieldConfig<T> => ({
    label,
    key: key as keyof T,
    type: "color" as const,
    defaultColor,
  });

  const createMeasurementField = <T extends OverlayFormatting | OverlayChild>(
    key: string,
    label: string
  ): FieldConfig<T> => ({
    label,
    key: key as keyof T,
    type: "measurement" as const,
  });

  // Field configurations using generic utility functions
  const fieldConfigs: Record<string, FieldConfig<OverlayFormatting>[]> = {
    layout: [
      createMeasurementField<OverlayFormatting>("width", "Width"),
      createMeasurementField<OverlayFormatting>("height", "Height"),
      createInputField<OverlayFormatting>("maxWidth", "Max Width", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("maxHeight", "Max Height", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("minWidth", "Min Width", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("minHeight", "Min Height", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("top", "Top", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("bottom", "Bottom", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("left", "Left", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>("right", "Right", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
    ],
    typography: [
      createInputField<OverlayFormatting>("fontSize", "Font Size", "15"),
      {
        label: "Font Weight",
        key: "fontWeight",
        type: "input",
        placeholder: "400",
        min: 100,
        max: 900,
        step: 100,
        onBlur: (e) => {
          const value = Number(e.target.value);
          if (!isNaN(value)) {
            const rounded = Math.round(value / 100) * 100;
            const clamped = Math.max(100, Math.min(900, rounded));
            if (clamped !== value) {
              updateFormatting({ fontWeight: clamped });
            }
          }
        },
      },
      createSelectField<OverlayFormatting>("textAlign", "Text Align", [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ]),
      createSelectField<OverlayFormatting>("fontStyle", "Font Style", [
        { label: "Normal", value: "normal" },
        { label: "Italic", value: "italic" },
      ]),
      createColorField<OverlayFormatting>("fontColor", "Font Color", "#ffffff"),
    ],
    spacing: [
      createInputField<OverlayFormatting>("paddingTop", "Padding Top", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>(
        "paddingBottom",
        "Padding Bottom",
        "0",
        {
          step: 0.5,
          endAdornment: <div className="text-gray-500 text-sm">%</div>,
        }
      ),
      createInputField<OverlayFormatting>("paddingLeft", "Padding Left", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayFormatting>(
        "paddingRight",
        "Padding Right",
        "0",
        {
          step: 0.5,
          endAdornment: <div className="text-gray-500 text-sm">%</div>,
        }
      ),
      createMeasurementField<OverlayFormatting>("marginTop", "Margin Top"),
      createMeasurementField<OverlayFormatting>(
        "marginBottom",
        "Margin Bottom"
      ),
      createMeasurementField<OverlayFormatting>("marginLeft", "Margin Left"),
      createMeasurementField<OverlayFormatting>("marginRight", "Margin Right"),
      createInputField<OverlayFormatting>("gap", "Gap", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
    ],
    colors: [
      createColorField<OverlayFormatting>(
        "backgroundColor",
        "Background Color",
        "#000000"
      ),
      createColorField<OverlayFormatting>(
        "borderColor",
        "Border Color",
        "#ffffff"
      ),
      createColorField<OverlayFormatting>(
        "borderLeftColor",
        "Border Left Color",
        "#ffffff"
      ),
      createColorField<OverlayFormatting>(
        "borderRightColor",
        "Border Right Color",
        "#ffffff"
      ),
      createColorField<OverlayFormatting>(
        "borderTopColor",
        "Border Top Color",
        "#ffffff"
      ),
      createColorField<OverlayFormatting>(
        "borderBottomColor",
        "Border Bottom Color",
        "#ffffff"
      ),
    ],
    border: [
      createSelectField<OverlayFormatting>("borderType", "Type", [
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
        { label: "Dotted", value: "dotted" },
      ]),
      {
        label: "Radius",
        key: "borderRadius",
        type: "input",
        inputType: "text",
        placeholder: "0",
      },
      {
        label: "Top Left Radius",
        key: "borderRadiusTopLeft",
        type: "input",
        inputType: "text",
        placeholder: "0% 0%",
      },
      {
        label: "Top Right Radius",
        key: "borderRadiusTopRight",
        type: "input",
        inputType: "text",
        placeholder: "3% 10%",
      },
      {
        label: "Bot Left Radius",
        key: "borderRadiusBottomLeft",
        type: "input",
        inputType: "text",
        placeholder: "0% 0%",
      },
      {
        label: "Bot Right Radius",
        key: "borderRadiusBottomRight",
        type: "input",
        inputType: "text",
        placeholder: "3% 10%",
      },
      createInputField<OverlayFormatting>("borderTopWidth", "Top Width", "0", {
        min: 0,
      }),
      createInputField<OverlayFormatting>(
        "borderBottomWidth",
        "Bottom Width",
        "0",
        { min: 0 }
      ),
      createInputField<OverlayFormatting>(
        "borderLeftWidth",
        "Left Width",
        "0",
        { min: 0 }
      ),
      createInputField<OverlayFormatting>(
        "borderRightWidth",
        "Right Width",
        "0",
        { min: 0 }
      ),
    ],
    flexbox: [
      createSelectField<OverlayFormatting>("display", "Display", [
        { label: "Block", value: "block" },
        { label: "Flex", value: "flex" },
      ]),
      createSelectField<OverlayFormatting>("flexDirection", "Flex Direction", [
        { label: "Row", value: "row" },
        { label: "Column", value: "column" },
      ]),
      createSelectField<OverlayFormatting>(
        "justifyContent",
        "Justify Content",
        [
          { label: "Start", value: "flex-start" },
          { label: "End", value: "flex-end" },
          { label: "Center", value: "center" },
          { label: "Space Between", value: "space-between" },
          { label: "Space Around", value: "space-around" },
        ]
      ),
      createSelectField<OverlayFormatting>("alignItems", "Align Items", [
        { label: "Start", value: "flex-start" },
        { label: "End", value: "flex-end" },
        { label: "Center", value: "center" },
        { label: "Baseline", value: "baseline" },
        { label: "Stretch", value: "stretch" },
      ]),
    ],
  };

  // Child field configurations using the same generic utility functions
  const childFieldConfigs: Record<string, FieldConfig<OverlayChild>[]> = {
    basic: [
      createInputField<OverlayChild>("fontSize", "Font Size", "15"),
      createColorField<OverlayChild>("fontColor", "Font Color", "#ffffff"),
      {
        label: "Font Weight",
        key: "fontWeight",
        type: "input",
        placeholder: "400",
        min: 100,
        max: 900,
        step: 100,
        onBlur: (e) => {
          const value = Number(e.target.value);
          if (!isNaN(value)) {
            const rounded = Math.round(value / 100) * 100;
            const clamped = Math.max(100, Math.min(900, rounded));
            if (clamped !== value) {
              // This will be handled by the parent component
            }
          }
        },
      },
      createSelectField<OverlayChild>("fontStyle", "Font Style", [
        { label: "Normal", value: "normal" },
        { label: "Italic", value: "italic" },
      ]),
      createSelectField<OverlayChild>("textAlign", "Text Align", [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ]),
      createMeasurementField<OverlayChild>("width", "Width"),
      createMeasurementField<OverlayChild>("height", "Height"),
    ],
    dimensions: [
      createInputField<OverlayChild>("maxWidth", "Max Width", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("maxHeight", "Max Height", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("minWidth", "Min Width", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("minHeight", "Min Height", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
    ],
    colors: [
      createColorField<OverlayChild>(
        "backgroundColor",
        "Background Color",
        "#000000"
      ),
      createColorField<OverlayChild>("borderColor", "Border Color", "#ffffff"),
      createColorField<OverlayChild>(
        "borderLeftColor",
        "Border Left Color",
        "#ffffff"
      ),
      createColorField<OverlayChild>(
        "borderRightColor",
        "Border Right Color",
        "#ffffff"
      ),
      createColorField<OverlayChild>(
        "borderTopColor",
        "Border Top Color",
        "#ffffff"
      ),
      createColorField<OverlayChild>(
        "borderBottomColor",
        "Border Bottom Color",
        "#ffffff"
      ),
    ],
    borders: [
      createSelectField<OverlayChild>("borderType", "Border Type", [
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
        { label: "Dotted", value: "dotted" },
      ]),
      {
        label: "Border Radius",
        key: "borderRadius",
        type: "input",
        inputType: "text",
        placeholder: "0",
      },
      {
        label: "Top Left Radius",
        key: "borderRadiusTopLeft",
        type: "input",
        inputType: "text",
        placeholder: "0% 0%",
      },
      {
        label: "Top Right Radius",
        key: "borderRadiusTopRight",
        type: "input",
        inputType: "text",
        placeholder: "3% 10%",
      },
      {
        label: "Bottom Left Radius",
        key: "borderRadiusBottomLeft",
        type: "input",
        inputType: "text",
        placeholder: "0% 0%",
      },
      {
        label: "Bottom Right Radius",
        key: "borderRadiusBottomRight",
        type: "input",
        inputType: "text",
        placeholder: "3% 10%",
      },
      createInputField<OverlayChild>("borderTopWidth", "Top Width", "0", {
        min: 0,
      }),
      createInputField<OverlayChild>("borderBottomWidth", "Bottom Width", "0", {
        min: 0,
      }),
      createInputField<OverlayChild>("borderLeftWidth", "Left Width", "0", {
        min: 0,
      }),
      createInputField<OverlayChild>("borderRightWidth", "Right Width", "0", {
        min: 0,
      }),
    ],
    spacing: [
      createInputField<OverlayChild>("paddingTop", "Padding Top", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("paddingBottom", "Padding Bottom", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("paddingLeft", "Padding Left", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("paddingRight", "Padding Right", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createMeasurementField<OverlayChild>("marginTop", "Margin Top"),
      createMeasurementField<OverlayChild>("marginBottom", "Margin Bottom"),
      createMeasurementField<OverlayChild>("marginLeft", "Margin Left"),
      createMeasurementField<OverlayChild>("marginRight", "Margin Right"),
    ],
    position: [
      createInputField<OverlayChild>("top", "Top", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("bottom", "Bottom", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("left", "Left", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
      createInputField<OverlayChild>("right", "Right", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
    ],
    layout: [
      createSelectField<OverlayChild>("display", "Display", [
        { label: "Block", value: "block" },
        { label: "Flex", value: "flex" },
      ]),
      createSelectField<OverlayChild>("flexDirection", "Flex Direction", [
        { label: "Row", value: "row" },
        { label: "Column", value: "column" },
      ]),
      createSelectField<OverlayChild>("justifyContent", "Justify Content", [
        { label: "Start", value: "flex-start" },
        { label: "End", value: "flex-end" },
        { label: "Center", value: "center" },
        { label: "Space Between", value: "space-between" },
        { label: "Space Around", value: "space-around" },
      ]),
      createSelectField<OverlayChild>("alignItems", "Align Items", [
        { label: "Start", value: "flex-start" },
        { label: "End", value: "flex-end" },
        { label: "Center", value: "center" },
        { label: "Baseline", value: "baseline" },
        { label: "Stretch", value: "stretch" },
      ]),
      createSelectField<OverlayChild>("flexWrap", "Flex Wrap", [
        { label: "No Wrap", value: "nowrap" },
        { label: "Wrap", value: "wrap" },
        { label: "Wrap Reverse", value: "wrap-reverse" },
      ]),
      createInputField<OverlayChild>("gap", "Gap", "0", {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }),
    ],
  };

  // Render a section with fields
  const renderSection = (
    title: string,
    fields: FieldConfig<OverlayFormatting>[],
    shouldShow: boolean
  ) => (
    <Section title={title} shouldShow={shouldShow}>
      {fields.map((field) => renderField(field, formatting, updateFormatting))}
    </Section>
  );

  // Render a child section with fields
  const renderChildSection = (
    title: string,
    fields: FieldConfig<OverlayChild>[],
    child: OverlayChild,
    index: number,
    shouldShow: boolean
  ) => {
    if (!shouldShow) return null;

    return (
      <div className="w-full border-t pt-2">
        <h5 className="text-sm font-medium text-gray-600 mb-2">{title}</h5>
        <div className="flex flex-wrap gap-4">
          {fields.map((field) =>
            renderField(field, child, (updates) => updateChild(index, updates))
          )}
        </div>
      </div>
    );
  };

  const children = formatting.children || [];

  return (
    <div className="space-y-6 h-full overflow-y-auto">
      <Toggle
        label="Show All Styles"
        value={showHiddenSections}
        onChange={setShowHiddenSections}
      />

      {/* Layout & Position Section */}
      {renderSection(
        "Layout & Position",
        fieldConfigs.layout,
        shouldShowSection([
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
        ])
      )}

      {/* Typography Section */}
      {renderSection(
        "Typography",
        fieldConfigs.typography,
        shouldShowSection([
          "fontSize",
          "fontWeight",
          "fontStyle",
          "textAlign",
          "fontColor",
        ])
      )}

      {/* Spacing Section */}
      {renderSection(
        "Spacing",
        fieldConfigs.spacing,
        shouldShowSection([
          "paddingTop",
          "paddingBottom",
          "paddingLeft",
          "paddingRight",
          "gap",
          "marginTop",
          "marginBottom",
          "marginLeft",
          "marginRight",
        ])
      )}

      {/* Colors Section */}
      {renderSection(
        "Colors",
        fieldConfigs.colors,
        shouldShowSection([
          "backgroundColor",
          "borderColor",
          "borderLeftColor",
          "borderRightColor",
          "borderTopColor",
          "borderBottomColor",
        ])
      )}

      {/* Border Section */}
      {renderSection(
        "Border",
        fieldConfigs.border,
        shouldShowSection([
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
        ])
      )}

      {/* Flexbox Section */}
      {renderSection(
        "Flexbox",
        fieldConfigs.flexbox,
        shouldShowSection([
          "display",
          "flexDirection",
          "justifyContent",
          "alignItems",
        ])
      )}

      {/* Inner Elements Section */}
      {children.length > 0 && (
        <Section title="Inner Elements" shouldShow={true}>
          <div className="space-y-4">
            {children.map((child, index) => (
              <div
                key={index}
                className="border rounded-lg p-4 flex flex-wrap gap-4"
              >
                <h4 className="font-medium w-full">
                  {child.label || `Element ${index + 1}`}
                </h4>

                {/* Basic fields */}
                {childFieldConfigs.basic.map((field) =>
                  renderField(field, child, (updates) =>
                    updateChild(index, updates)
                  )
                )}

                {/* Dimensions */}
                {renderChildSection(
                  "Dimensions",
                  childFieldConfigs.dimensions,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "maxWidth",
                    "maxHeight",
                    "minWidth",
                    "minHeight",
                  ])
                )}

                {/* Colors & Background */}
                {renderChildSection(
                  "Colors & Background",
                  childFieldConfigs.colors,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "backgroundColor",
                    "borderColor",
                    "borderLeftColor",
                    "borderRightColor",
                    "borderTopColor",
                    "borderBottomColor",
                  ])
                )}

                {/* Borders */}
                {renderChildSection(
                  "Borders",
                  childFieldConfigs.borders,
                  child,
                  index,
                  shouldShowChildSection(child, [
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
                  ])
                )}

                {/* Spacing */}
                {renderChildSection(
                  "Spacing",
                  childFieldConfigs.spacing,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "paddingTop",
                    "paddingBottom",
                    "paddingLeft",
                    "paddingRight",
                    "marginTop",
                    "marginBottom",
                    "marginLeft",
                    "marginRight",
                  ])
                )}

                {/* Position */}
                {renderChildSection(
                  "Position",
                  childFieldConfigs.position,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "top",
                    "bottom",
                    "left",
                    "right",
                  ])
                )}

                {/* Layout */}
                {renderChildSection(
                  "Layout",
                  childFieldConfigs.layout,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "display",
                    "flexDirection",
                    "justifyContent",
                    "alignItems",
                    "flexWrap",
                    "gap",
                  ])
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

export default StyleEditor;
