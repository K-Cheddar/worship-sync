import { ReactComponent as CircleSVG } from "../../assets/icons/radio-button-checked.svg";
import "./Toggle.scss";
import Icon from "../Icon/Icon";

type ToggleProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
};

const Toggle = ({ label, value, onChange, className }: ToggleProps) => {
  return (
    <div
      className={`flex gap-1 relative items-center h-4 ${
        className ? className : ""
      }`}
    >
      <label className="text-sm font-semibold">{label}:</label>
      <div className={`${value ? "on" : "off"} toggle-input-container`}>
        <input
          className="w-full h-full absolute opacity-0 cursor-pointer left-0 top-0"
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Icon svg={CircleSVG} className={`toggle-circle`} />
      </div>
    </div>
  );
};

export default Toggle;