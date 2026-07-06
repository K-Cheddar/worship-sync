import Toggle from "../Toggle/Toggle";
import { cn } from "@/utils/cnHelper";

type RemoveParentheticalsToggleProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  className?: string;
};

const DEFAULT_DESCRIPTION =
  "Removes spoken cues in parentheses when you create. Chart labels like (Chorus) are kept.";

const RemoveParentheticalsToggle = ({
  value,
  onChange,
  description = DEFAULT_DESCRIPTION,
  className,
}: RemoveParentheticalsToggleProps) => (
  <div className={cn("flex flex-col gap-1", className)}>
    <Toggle
      label="Remove ad-libs in parentheses"
      value={value}
      onChange={onChange}
    />
    <p className="text-xs text-gray-400">{description}</p>
  </div>
);

export default RemoveParentheticalsToggle;
