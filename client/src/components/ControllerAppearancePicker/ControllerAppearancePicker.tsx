import { cn } from "../../utils/cnHelper";
import {
  CONTROLLER_COLOR_OPTIONS,
  CONTROLLER_ICON_OPTIONS,
  type ControllerIconColor,
  type ControllerIconId,
} from "../../utils/controllerAppearance";

type ControllerAppearancePickerProps = {
  controllerName: string;
  icon: ControllerIconId;
  color: ControllerIconColor;
  onChange: (appearance: { icon: ControllerIconId; color: ControllerIconColor }) => void;
};

const ControllerAppearancePicker = ({
  controllerName,
  icon,
  color,
  onChange,
}: ControllerAppearancePickerProps) => (
  <fieldset className="flex flex-col gap-2 border-0 p-0" aria-label={`${controllerName} home appearance`}>
    <legend className="text-sm font-semibold">Home icon and color</legend>
    <div className="flex flex-wrap gap-1.5" aria-label={`${controllerName} icon options`}>
      {CONTROLLER_ICON_OPTIONS.map((option) => {
        const OptionIcon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            aria-label={`${controllerName} icon: ${option.label}`}
            aria-pressed={icon === option.id}
            onClick={() => onChange({ icon: option.id, color })}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md border text-gray-100 transition-colors",
              "hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
              icon === option.id
                ? "border-cyan-400 bg-gray-700"
                : "border-gray-600 bg-gray-900",
            )}
          >
            <OptionIcon aria-hidden className="h-5 w-5" />
          </button>
        );
      })}
    </div>
    <div className="flex flex-wrap items-center gap-2" aria-label={`${controllerName} icon colors`}>
      <span className="mr-1 text-xs text-gray-300">Color</span>
      {CONTROLLER_COLOR_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-label={`${controllerName} icon color: ${option.label}`}
          aria-pressed={color === option.id}
          onClick={() => onChange({ icon, color: option.id })}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
            color === option.id ? "border-white" : "border-gray-600",
          )}
        >
          <span aria-hidden className={cn("h-4 w-4 rounded-full", option.swatchClass)} />
        </button>
      ))}
    </div>
  </fieldset>
);

export default ControllerAppearancePicker;
