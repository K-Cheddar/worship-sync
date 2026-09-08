import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Button from "./Button/Button";
import ServicePlanRolePickerContent, {
  servicePlanRoleOptionDisplayLabel,
  type ServicePlanRolePickerOption,
} from "./ServicePlanRolePickerContent";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/Popover";
import { cn } from "../utils/cnHelper";

export type ServicePlanRoleOption = ServicePlanRolePickerOption;

type ServicePlanRolePickerBaseProps = {
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

export type ServicePlanRolePickerProps = ServicePlanRolePickerBaseProps & (
  | {
    multi?: false;
    value: string;
    onValueChange: (positionId: string) => void;
  }
  | {
    multi: true;
    value: string[];
    onValueChange: (positionIds: string[]) => void;
  }
);

/** Popover trigger for role selection outside a dropdown menu. */
const ServicePlanRolePicker = (props: ServicePlanRolePickerProps) => {
  const {
    options,
    teamFilterStorageKey,
    lockedTeamName,
    ariaLabel,
    label,
    placeholder = "All roles",
    allowEmpty = true,
    disabled = false,
    className,
  } = props;
  const [open, setOpen] = useState(false);
  const multi = props.multi === true;
  const selectedRoles = multi
    ? options.filter((role) => props.value.includes(role.positionId))
    : options.filter((role) => role.positionId === props.value);
  const selectedNames = selectedRoles
    .map((role) => servicePlanRoleOptionDisplayLabel(role, options))
    .join(", ");
  const triggerText = selectedRoles.length === 0
    ? placeholder
    : selectedRoles.length === 1
      ? selectedNames
      : `${selectedRoles.length} roles`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          svg={ChevronDown}
          iconPosition="right"
          iconSize="xs"
          className={cn("max-md:min-h-0 min-w-0 max-w-full text-xs", className)}
          aria-label={
            selectedRoles.length
              ? `${ariaLabel}: ${selectedNames}`
              : ariaLabel
          }
          title={selectedRoles.length > 1 ? selectedNames : undefined}
          disabled={disabled}
        >
          {label ? <span className="shrink-0 text-gray-300">{label}:</span> : null}
          <span className="min-w-0 truncate">
            {triggerText}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] border-gray-700 bg-gray-900 p-2 text-gray-100">
        {multi ? (
          <ServicePlanRolePickerContent
            multi
            value={props.value}
            onValueChange={props.onValueChange}
            onSelectionComplete={() => setOpen(false)}
            options={options}
            teamFilterStorageKey={teamFilterStorageKey}
            lockedTeamName={lockedTeamName}
            allowEmpty={allowEmpty}
          />
        ) : (
          <ServicePlanRolePickerContent
            value={props.value}
            onValueChange={props.onValueChange}
            onSelectionComplete={() => setOpen(false)}
            options={options}
            teamFilterStorageKey={teamFilterStorageKey}
            lockedTeamName={lockedTeamName}
            allowEmpty={allowEmpty}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};

export default ServicePlanRolePicker;
