import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Button from "./Button/Button";
import ServicePlanRolePickerContent, {
  type ServicePlanRolePickerOption,
} from "./ServicePlanRolePickerContent";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/Popover";
import { cn } from "../utils/cnHelper";

export type ServicePlanRoleOption = ServicePlanRolePickerOption;

type ServicePlanRolePickerProps = {
  value: string;
  onValueChange: (positionId: string) => void;
  options: ServicePlanRoleOption[];
  teamFilterStorageKey: string;
  /** A parent team-notes filter already scopes the supplied options. */
  lockedTeamName?: string;
  ariaLabel: string;
  label?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Popover trigger for role selection outside a dropdown menu. */
const ServicePlanRolePicker = ({
  value,
  onValueChange,
  options,
  teamFilterStorageKey,
  lockedTeamName,
  ariaLabel,
  label,
  placeholder = "All roles",
  allowEmpty = true,
  disabled = false,
  className,
}: ServicePlanRolePickerProps) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((role) => role.positionId === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          svg={ChevronDown}
          iconPosition="right"
          iconSize="xs"
          className={cn("max-md:min-h-0 min-w-0 max-w-full text-xs", className)}
          aria-label={ariaLabel}
          disabled={disabled}
        >
          {label ? <span className="shrink-0 text-gray-300">{label}:</span> : null}
          <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] border-gray-700 bg-gray-900 p-2 text-gray-100">
        <ServicePlanRolePickerContent
          value={value}
          onValueChange={onValueChange}
          onSelectionComplete={() => setOpen(false)}
          options={options}
          teamFilterStorageKey={teamFilterStorageKey}
          lockedTeamName={lockedTeamName}
          allowEmpty={allowEmpty}
        />
      </PopoverContent>
    </Popover>
  );
};

export default ServicePlanRolePicker;
