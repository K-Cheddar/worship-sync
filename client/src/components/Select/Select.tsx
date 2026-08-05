import { Option } from "../../types";
import cn from "classnames";
import { Fragment, useId, useMemo } from "react";
import {
  Select as RadixSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

type OptionSection = { group?: string; options: Option[] };

/**
 * Radix throws on an item whose value is an empty string — it reserves "" for
 * clearing the selection. "" is still the natural "no filter" value for our
 * callers (for example an "All teams" choice), so swap it for a private
 * sentinel on the way into Radix and swap it back on the way out. Callers keep
 * seeing "" and never have to invent a sentinel of their own.
 */
const EMPTY_OPTION_VALUE = "__worshipsync_empty_option__";

const toRadixValue = (value: string) =>
  value === "" ? EMPTY_OPTION_VALUE : value;

const fromRadixValue = (value: string) =>
  value === EMPTY_OPTION_VALUE ? "" : value;

// Split the flat option list into rendered sections: consecutive options sharing
// a `group` become one labelled section, ungrouped options stay flat. Callers
// that never set `group` get exactly the previous flat rendering.
const toOptionSections = (options: Option[]): OptionSection[] =>
  options.reduce<OptionSection[]>((sections, option) => {
    const current = sections[sections.length - 1];
    if (current && current.group === option.group) {
      current.options.push(option);
      return sections;
    }
    sections.push({ group: option.group, options: [option] });
    return sections;
  }, []);

const renderOption = (option: Option) => (
  <SelectItem key={option.value} value={toRadixValue(option.value)}>
    {option.className ? (
      <span className={option.className}>{option.label}</span>
    ) : (
      option.label
    )}
  </SelectItem>
);

export type SelectProps = {
  options: Option[];
  className?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  labelClassName?: string;
  labelFontSize?: string;
  hideLabel?: boolean;
  selectClassName?: string;
  textColor?: string;
  backgroundColor?: string;
  chevronColor?: string;
  contentBackgroundColor?: string;
  contentTextColor?: string;
  disabled?: boolean;
  id?: string;
  /** Skip Radix focus restore to the trigger when the menu closes. */
  suppressCloseAutoFocus?: boolean;
  /** Extra classes for the dropdown panel (for example max height). */
  contentClassName?: string;
  /** Render the menu inline instead of in a portal. Needed inside a
   * FloatingWindow, whose stacking context a portaled menu escapes. */
  disablePortal?: boolean;
  /** Controlled open state (forwarded to Radix Select root). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const Select = ({
  options,
  value,
  onChange,
  label,
  hideLabel = false,
  className,
  labelClassName,
  labelFontSize = "text-sm",
  selectClassName,
  textColor = "text-neutral-100",
  backgroundColor = "bg-neutral-900",
  chevronColor,
  contentBackgroundColor,
  contentTextColor,
  disabled = false,
  id: idProp,
  suppressCloseAutoFocus = false,
  contentClassName,
  disablePortal,
  open,
  onOpenChange,
  ...rest
}: SelectProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;

  // Check if value exists in options, if not use undefined to show placeholder
  const valueExists = options.some((option) => option.value === value);
  const selectValue = valueExists ? toRadixValue(value) : undefined;
  const sections = useMemo(() => toOptionSections(options), [options]);

  return (
    <div className={className}>
      {label && (
        <label
          className={cn(
            "p-1 font-semibold",
            hideLabel && "sr-only",
            labelClassName,
            labelFontSize
          )}
          htmlFor={id}
        >
          {label}:
        </label>
      )}
      <RadixSelect
        value={selectValue}
        onValueChange={(next) => onChange(fromRadixValue(next))}
        disabled={disabled}
        open={open}
        onOpenChange={onOpenChange}
        {...rest}
      >
        <SelectTrigger
          id={id}
          className={cn(backgroundColor, selectClassName, textColor)}
          chevronColor={chevronColor}
        >
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent
          className={contentClassName}
          portal={!disablePortal}
          contentBackgroundColor={contentBackgroundColor}
          contentTextColor={contentTextColor}
          onCloseAutoFocus={
            suppressCloseAutoFocus ? (e) => e.preventDefault() : undefined
          }
        >
          {sections.map((section, index) => (
            <Fragment key={`${section.group ?? "ungrouped"}-${index}`}>
              {index > 0 && section.group ? <SelectSeparator /> : null}
              {section.group ? (
                <SelectGroup>
                  <SelectLabel>{section.group}</SelectLabel>
                  {section.options.map(renderOption)}
                </SelectGroup>
              ) : (
                section.options.map(renderOption)
              )}
            </Fragment>
          ))}
        </SelectContent>
      </RadixSelect>
    </div>
  );
};

export default Select;
