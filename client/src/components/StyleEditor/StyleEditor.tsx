import React, { useState } from "react";
import { OverlayFormatting, OverlayChild, OverlayType } from "../../types";
import Section from "./Section";
import InputField from "./InputField";
import SelectField from "./SelectField";
import MeasurementField, { MeasurementType } from "./MeasurementField";
import ColorField from "../ColorField/ColorField";
import Toggle from "../Toggle/Toggle";
import cn from "classnames";

type ParticipantOverlayPosition = "left" | "center" | "right";

const POSITION_OPTIONS: {
  value: ParticipantOverlayPosition;
  label: string;
  Illustration: React.FC<{ className?: string }>;
}[] = [
    {
      value: "left",
      label: "Left",
      Illustration: ({ className }) => (
        <div
          className={cn("relative w-14 aspect-video rounded bg-gray-700 border border-gray-600", className)}
          aria-hidden
        >
          <div className="absolute left-0.5 bottom-0.5 w-4 h-3 rounded-sm bg-cyan-600/80 border border-cyan-500" />
        </div>
      ),
    },
    {
      value: "center",
      label: "Center",
      Illustration: ({ className }) => (
        <div
          className={cn("relative w-14 aspect-video rounded bg-gray-700 border border-gray-600", className)}
          aria-hidden
        >
          <div className="absolute left-1/2 bottom-0.5 -translate-x-1/2 w-4 h-3 rounded-sm bg-cyan-600/80 border border-cyan-500" />
        </div>
      ),
    },
    {
      value: "right",
      label: "Right",
      Illustration: ({ className }) => (
        <div
          className={cn("relative w-14 aspect-video rounded bg-gray-700 border border-gray-600", className)}
          aria-hidden
        >
          <div className="absolute right-0.5 bottom-0.5 w-4 h-3 rounded-sm bg-cyan-600/80 border border-cyan-500" />
        </div>
      ),
    },
  ];

interface StyleEditorProps {
  formatting: OverlayFormatting;
  onChange: (formatting: OverlayFormatting) => void;
  overlayType?: OverlayType;
  className?: string;
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

const StyleEditor: React.FC<StyleEditorProps> = ({
  formatting,
  onChange,
  overlayType,
  className,
}) => {
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
    return value !== undefined && value !== null;
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
    return value !== undefined && value !== null;
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
            property={
              config.label.toLowerCase().includes("margin")
                ? "spacing"
                : "dimension"
            }
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

  // Common field configurations that can be reused
  const commonFields = {
    // Layout fields
    width: createMeasurementField<OverlayFormatting>("width", "Width"),
    height: createMeasurementField<OverlayFormatting>("height", "Height"),
    maxWidth: createInputField<OverlayFormatting>(
      "maxWidth",
      "Max Width",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    maxHeight: createInputField<OverlayFormatting>(
      "maxHeight",
      "Max Height",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    minWidth: createInputField<OverlayFormatting>(
      "minWidth",
      "Min Width",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    minHeight: createInputField<OverlayFormatting>(
      "minHeight",
      "Min Height",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    top: createInputField<OverlayFormatting>("top", "Top", "0", {
      step: 0.5,
      endAdornment: <div className="text-gray-500 text-sm">%</div>,
    }),
    bottom: createInputField<OverlayFormatting>("bottom", "Bottom", "0", {
      step: 0.5,
      endAdornment: <div className="text-gray-500 text-sm">%</div>,
    }),
    left: createInputField<OverlayFormatting>("left", "Left", "0", {
      step: 0.5,
      endAdornment: <div className="text-gray-500 text-sm">%</div>,
    }),
    right: createInputField<OverlayFormatting>("right", "Right", "0", {
      step: 0.5,
      endAdornment: <div className="text-gray-500 text-sm">%</div>,
    }),

    // Typography fields
    fontSize: createInputField<OverlayFormatting>(
      "fontSize",
      "Font Size",
      "15"
    ),
    fontColor: createColorField<OverlayFormatting>(
      "fontColor",
      "Font Color",
      "#ffffff"
    ),
    textAlign: createSelectField<OverlayFormatting>("textAlign", "Text Align", [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ]),
    fontStyle: createSelectField<OverlayFormatting>("fontStyle", "Font Style", [
      { label: "Normal", value: "normal" },
      { label: "Italic", value: "italic" },
    ]),

    // Spacing fields
    paddingTop: createInputField<OverlayFormatting>(
      "paddingTop",
      "Padding Top",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    paddingBottom: createInputField<OverlayFormatting>(
      "paddingBottom",
      "Padding Bottom",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    paddingLeft: createInputField<OverlayFormatting>(
      "paddingLeft",
      "Padding Left",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    paddingRight: createInputField<OverlayFormatting>(
      "paddingRight",
      "Padding Right",
      "0",
      {
        step: 0.5,
        endAdornment: <div className="text-gray-500 text-sm">%</div>,
      }
    ),
    marginTop: createMeasurementField<OverlayFormatting>(
      "marginTop",
      "Margin Top"
    ),
    marginBottom: createMeasurementField<OverlayFormatting>(
      "marginBottom",
      "Margin Bottom"
    ),
    marginLeft: createMeasurementField<OverlayFormatting>(
      "marginLeft",
      "Margin Left"
    ),
    marginRight: createMeasurementField<OverlayFormatting>(
      "marginRight",
      "Margin Right"
    ),
    gap: createInputField<OverlayFormatting>("gap", "Gap", "0", {
      step: 0.5,
      endAdornment: <div className="text-gray-500 text-sm">%</div>,
    }),

    // Color fields
    backgroundColor: createColorField<OverlayFormatting>(
      "backgroundColor",
      "Background Color",
      "#000000"
    ),
    borderColor: createColorField<OverlayFormatting>(
      "borderColor",
      "Border Color",
      "#ffffff"
    ),
    borderLeftColor: createColorField<OverlayFormatting>(
      "borderLeftColor",
      "Border Left Color",
      "#ffffff"
    ),
    borderRightColor: createColorField<OverlayFormatting>(
      "borderRightColor",
      "Border Right Color",
      "#ffffff"
    ),
    borderTopColor: createColorField<OverlayFormatting>(
      "borderTopColor",
      "Border Top Color",
      "#ffffff"
    ),
    borderBottomColor: createColorField<OverlayFormatting>(
      "borderBottomColor",
      "Border Bottom Color",
      "#ffffff"
    ),

    // Border fields
    borderType: createSelectField<OverlayFormatting>("borderType", "Type", [
      { label: "Solid", value: "solid" },
      { label: "Dashed", value: "dashed" },
      { label: "Dotted", value: "dotted" },
    ]),
    borderRadius: {
      label: "Radius",
      key: "borderRadius" as keyof OverlayFormatting,
      type: "input" as const,
      inputType: "text" as const,
      placeholder: "0",
    },
    borderRadiusTopLeft: {
      label: "Top Left Radius",
      key: "borderRadiusTopLeft" as keyof OverlayFormatting,
      type: "input" as const,
      inputType: "text" as const,
      placeholder: "0% 0%",
    },
    borderRadiusTopRight: {
      label: "Top Right Radius",
      key: "borderRadiusTopRight" as keyof OverlayFormatting,
      type: "input" as const,
      inputType: "text" as const,
      placeholder: "3% 10%",
    },
    borderRadiusBottomLeft: {
      label: "Bot Left Radius",
      key: "borderRadiusBottomLeft" as keyof OverlayFormatting,
      type: "input" as const,
      inputType: "text" as const,
      placeholder: "0% 0%",
    },
    borderRadiusBottomRight: {
      label: "Bot Right Radius",
      key: "borderRadiusBottomRight" as keyof OverlayFormatting,
      type: "input" as const,
      inputType: "text" as const,
      placeholder: "3% 10%",
    },
    borderTopWidth: createInputField<OverlayFormatting>(
      "borderTopWidth",
      "Top Width",
      "0",
      { min: 0 }
    ),
    borderBottomWidth: createInputField<OverlayFormatting>(
      "borderBottomWidth",
      "Bottom Width",
      "0",
      { min: 0 }
    ),
    borderLeftWidth: createInputField<OverlayFormatting>(
      "borderLeftWidth",
      "Left Width",
      "0",
      { min: 0 }
    ),
    borderRightWidth: createInputField<OverlayFormatting>(
      "borderRightWidth",
      "Right Width",
      "0",
      { min: 0 }
    ),

    // Flexbox fields
    display: createSelectField<OverlayFormatting>("display", "Display", [
      { label: "Block", value: "block" },
      { label: "Flex", value: "flex" },
    ]),
    flexDirection: createSelectField<OverlayFormatting>(
      "flexDirection",
      "Flex Direction",
      [
        { label: "Row", value: "row" },
        { label: "Column", value: "column" },
      ]
    ),
    justifyContent: createSelectField<OverlayFormatting>(
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
    alignItems: createSelectField<OverlayFormatting>(
      "alignItems",
      "Align Items",
      [
        { label: "Start", value: "flex-start" },
        { label: "End", value: "flex-end" },
        { label: "Center", value: "center" },
        { label: "Baseline", value: "baseline" },
        { label: "Stretch", value: "stretch" },
      ]
    ),
    flexWrap: createSelectField<OverlayFormatting>("flexWrap", "Flex Wrap", [
      { label: "No Wrap", value: "nowrap" },
      { label: "Wrap", value: "wrap" },
      { label: "Wrap Reverse", value: "wrap-reverse" },
    ]),
  };

  // Font weight field with custom onBlur handler
  const createFontWeightField = <T extends OverlayFormatting | OverlayChild>(
    onBlurHandler?: (e: React.FocusEvent<HTMLInputElement>) => void
  ): FieldConfig<T> => ({
    label: "Font Weight",
    key: "fontWeight" as keyof T,
    type: "input" as const,
    placeholder: "400",
    min: 100,
    max: 900,
    step: 100,
    onBlur: onBlurHandler,
  });

  // Unified field configurations that work for both OverlayFormatting and OverlayChild
  // Since OverlayChild is just OverlayFormatting without 'children' + optional 'label',
  // we can use the same field configurations for both
  const unifiedFieldConfigs: Record<string, FieldConfig<OverlayFormatting>[]> =
  {
    basic: [
      commonFields.fontSize,
      commonFields.fontColor,
      createFontWeightField<OverlayFormatting>(),
      commonFields.fontStyle,
      commonFields.textAlign,
      commonFields.width,
      commonFields.height,
    ],
    dimensions: [
      commonFields.maxWidth,
      commonFields.maxHeight,
      commonFields.minWidth,
      commonFields.minHeight,
    ],
    colors: [
      commonFields.backgroundColor,
      commonFields.borderColor,
      commonFields.borderLeftColor,
      commonFields.borderRightColor,
      commonFields.borderTopColor,
      commonFields.borderBottomColor,
    ],
    borders: [
      commonFields.borderType,
      commonFields.borderRadius,
      commonFields.borderRadiusTopLeft,
      commonFields.borderRadiusTopRight,
      commonFields.borderRadiusBottomLeft,
      commonFields.borderRadiusBottomRight,
      commonFields.borderTopWidth,
      commonFields.borderBottomWidth,
      commonFields.borderLeftWidth,
      commonFields.borderRightWidth,
    ],
    spacing: [
      commonFields.paddingTop,
      commonFields.paddingBottom,
      commonFields.paddingLeft,
      commonFields.paddingRight,
      commonFields.marginTop,
      commonFields.marginBottom,
      commonFields.marginLeft,
      commonFields.marginRight,
    ],
    position: [
      commonFields.top,
      commonFields.bottom,
      commonFields.left,
      commonFields.right,
    ],
    layout: [
      commonFields.display,
      commonFields.flexDirection,
      commonFields.justifyContent,
      commonFields.alignItems,
      commonFields.flexWrap,
      commonFields.gap,
    ],
  };

  // Field configurations using unified configurations
  const fieldConfigs: Record<string, FieldConfig<OverlayFormatting>[]> = {
    layout: [
      ...unifiedFieldConfigs.basic.filter(
        (field) => field.key === "width" || field.key === "height"
      ),
      ...unifiedFieldConfigs.dimensions,
      ...unifiedFieldConfigs.position,
    ],
    typography: [
      ...unifiedFieldConfigs.basic.filter(
        (field) =>
          field.key === "fontSize" ||
          field.key === "fontColor" ||
          field.key === "fontStyle" ||
          field.key === "textAlign"
      ),
      createFontWeightField<OverlayFormatting>((e) => {
        const value = Number(e.target.value);
        if (!isNaN(value)) {
          const rounded = Math.round(value / 100) * 100;
          const clamped = Math.max(100, Math.min(900, rounded));
          if (clamped !== value) {
            updateFormatting({ fontWeight: clamped });
          }
        }
      }),
    ],
    spacing: [...unifiedFieldConfigs.spacing, commonFields.gap],
    colors: unifiedFieldConfigs.colors,
    border: unifiedFieldConfigs.borders,
    flexbox: [
      ...unifiedFieldConfigs.layout.filter(
        (field) =>
          field.key === "display" ||
          field.key === "flexDirection" ||
          field.key === "justifyContent" ||
          field.key === "alignItems"
      ),
    ],
  };

  // Render a section with fields
  const renderSection = (
    title: string,
    fields: FieldConfig<OverlayFormatting>[],
    shouldShow: boolean
  ) => (
    <Section title={title} shouldShow={shouldShow}>
      {fields.map((field) => (
        <React.Fragment key={field.key as string}>
          {renderField(field, formatting, updateFormatting)}
        </React.Fragment>
      ))}
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
        <h5 className="text-sm font-medium mb-2">{title}</h5>
        <div className="flex flex-wrap gap-4">
          {fields.map((field) => (
            <React.Fragment key={field.key as string}>
              {renderField(field, child, (updates) =>
                updateChild(index, updates)
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const children = formatting.children || [];

  const participantPosition =
    (formatting.participantOverlayPosition ?? "left") as ParticipantOverlayPosition;

  const setParticipantPosition = (position: ParticipantOverlayPosition) => {
    const updates: Partial<OverlayFormatting> = {
      participantOverlayPosition: position,
    };
    const children = formatting.children || [];
    if (position === "left") {
      updates.left = 2;
      updates.right = 0;
      updates.borderLeftWidth = 5;
      updates.borderRightWidth = 0;
      updates.borderBottomWidth = 0;
      updates.textAlign = "left";
      updates.children = children.map((c) => ({ ...c, textAlign: "left" as const }));
    } else if (position === "center") {
      updates.left = undefined;
      updates.right = undefined;
      updates.borderLeftWidth = 0;
      updates.borderBottomWidth = 2;
      updates.borderBottomColor = formatting.borderColor ?? formatting.borderLeftColor ?? "#15803d";
      updates.borderRightWidth = 0;
      updates.textAlign = "center";
      updates.children = children.map((c) => ({ ...c, textAlign: "center" as const }));
    } else {
      updates.left = undefined;
      updates.right = 2;
      updates.borderRightWidth = 5;
      updates.borderBottomWidth = 0;
      updates.borderRightColor = formatting.borderColor ?? formatting.borderRightColor ?? "#15803d";
      updates.borderLeftWidth = 0;
      updates.textAlign = "right";
      updates.children = children.map((c) => ({ ...c, textAlign: "right" as const }));
    }
    onChange({ ...formatting, ...updates });
  };

  return (
    <div className={cn("space-y-6 h-full scrollbar-variable", className)}>
      <Toggle
        label="Show All Styles"
        value={showHiddenSections}
        onChange={setShowHiddenSections}
      />

      {overlayType === "participant" && (
        <Section title="Position" shouldShow={true}>
          <div className="flex flex-wrap gap-3">
            {POSITION_OPTIONS.map(({ value, label, Illustration }) => (
              <label
                key={value}
                className={cn(
                  "flex flex-col items-center gap-1.5 cursor-pointer rounded-lg border-2 p-2 transition-colors",
                  participantPosition === value
                    ? "border-cyan-500 bg-cyan-500/10"
                    : "border-gray-600 hover:border-gray-500"
                )}
              >
                <input
                  type="radio"
                  name="participant-overlay-position"
                  value={value}
                  checked={participantPosition === value}
                  onChange={() => setParticipantPosition(value)}
                  className="sr-only"
                />
                <Illustration />
                <span className="text-xs text-white font-medium">{label}</span>
              </label>
            ))}
          </div>
        </Section>
      )}

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

                {unifiedFieldConfigs.basic.map((field) => (
                  <React.Fragment key={field.key as string}>
                    {renderField(field, child, (updates) =>
                      updateChild(index, updates)
                    )}
                  </React.Fragment>
                ))}

                {renderChildSection(
                  "Dimensions",
                  unifiedFieldConfigs.dimensions,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "maxWidth",
                    "maxHeight",
                    "minWidth",
                    "minHeight",
                  ])
                )}

                {renderChildSection(
                  "Colors & Background",
                  unifiedFieldConfigs.colors,
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

                {renderChildSection(
                  "Borders",
                  unifiedFieldConfigs.borders,
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

                {renderChildSection(
                  "Spacing",
                  unifiedFieldConfigs.spacing,
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

                {renderChildSection(
                  "Position",
                  unifiedFieldConfigs.position,
                  child,
                  index,
                  shouldShowChildSection(child, [
                    "top",
                    "bottom",
                    "left",
                    "right",
                  ])
                )}

                {renderChildSection(
                  "Layout",
                  unifiedFieldConfigs.layout,
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
