import { useState, type ReactNode } from "react";
import CollapsibleSectionTrigger from "../../../components/CollapsibleSectionTrigger/CollapsibleSectionTrigger";
import { cn } from "@/utils/cnHelper";
import Checkbox from "../../../components/Checkbox/Checkbox";

export type MultiCheckboxOption = {
  id: string;
  label: string;
  archived?: boolean;
};

export type MultiCheckboxOptionSection = {
  heading?: string;
  options: MultiCheckboxOption[];
};

export type MultiCheckboxOptionGroup = {
  heading: string;
  options?: MultiCheckboxOption[];
  sections?: MultiCheckboxOptionSection[];
};

type MultiCheckboxGroupProps = {
  label: string;
  description?: string;
  options?: MultiCheckboxOption[];
  groups?: MultiCheckboxOptionGroup[];
  value: string[];
  onChange: (value: string[]) => void;
  defaultExpanded?: boolean;
};

const renderCheckboxOptions = (
  options: MultiCheckboxOption[],
  value: string[],
  onChange: (value: string[]) => void,
) =>
  options.map((option) => {
    const checked = value.includes(option.id);
    return (
      <Checkbox
        key={option.id}
        className={cn("rounded px-2 py-1", option.archived && "text-gray-400")}
        label={
          <span className="truncate">
            {option.label}
            {option.archived ? " (archived)" : ""}
          </span>
        }
        labelClassName="truncate"
        checked={checked}
        disabled={option.archived && !checked}
        onCheckedChange={() => {
          onChange(
            checked
              ? value.filter((id) => id !== option.id)
              : [...value, option.id],
          );
        }}
      />
    );
  });

const renderOptionGroups = (
  groups: MultiCheckboxOptionGroup[],
  value: string[],
  onChange: (value: string[]) => void,
) =>
  groups.map((group) => (
    <div key={group.heading} className="space-y-2">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {group.heading}
      </p>
      {group.sections?.map((section, index) => (
        <div key={`${group.heading}-${section.heading || index}`} className="space-y-1.5">
          {section.heading ? (
            <p className="px-1 text-xs font-medium text-gray-300">{section.heading}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {renderCheckboxOptions(section.options, value, onChange)}
          </div>
        </div>
      ))}
      {group.options && group.options.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {renderCheckboxOptions(group.options, value, onChange)}
        </div>
      ) : null}
    </div>
  ));

export const CheckboxOptionGrid = ({
  options,
  value,
  onChange,
  className,
}: {
  options: MultiCheckboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) => (
  <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
    {renderCheckboxOptions(options, value, onChange)}
  </div>
);

export const TeamGroupedCheckboxLists = ({
  groups,
  value,
  onChange,
}: {
  groups: MultiCheckboxOptionGroup[];
  value: string[];
  onChange: (value: string[]) => void;
}) => <>{renderOptionGroups(groups, value, onChange)}</>;

const MultiCheckboxGroup = ({
  label,
  description,
  options = [],
  groups,
  value,
  onChange,
  defaultExpanded = true,
}: MultiCheckboxGroupProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const groupedOptions = groups ?? [];
  const hasGroupedOptions = groupedOptions.length > 0;
  const hasFlatOptions = options.length > 0;
  const isEmpty = !hasGroupedOptions && !hasFlatOptions;

  let body: ReactNode;
  if (isEmpty) {
    body = <p className="text-sm text-gray-400">Nothing to choose yet.</p>;
  } else if (hasGroupedOptions) {
    body = renderOptionGroups(groupedOptions, value, onChange);
  } else {
    body = (
      <div className="grid gap-2 sm:grid-cols-2">
        {renderCheckboxOptions(options, value, onChange)}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <CollapsibleSectionTrigger
        label={label}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      {expanded ? (
        <>
          {description ? (
            <p className="px-1 text-xs text-gray-400">{description}</p>
          ) : null}
          <fieldset className="min-w-0 space-y-3 rounded-md border border-gray-700 bg-gray-950/60 p-2">
            <legend className="sr-only">{label}</legend>
            <div className="max-h-44 space-y-3 overflow-y-auto">{body}</div>
          </fieldset>
        </>
      ) : null}
    </div>
  );
};

export default MultiCheckboxGroup;
