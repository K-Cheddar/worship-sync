import { ReactComponent as CircleSVG } from "../../assets/icons/radio-button-checked.svg";
import './Toggle.scss';
import Icon from "../Icon/Icon";

type ToggleProps = {
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
  className?: string
}

const Toggle = ( { label, value, onChange, className } : ToggleProps) => {

  return (
    <div className={`flex gap-1 ${className}`}>
      <label className="text-sm font-semibold">{label}:</label>
      <div className={`${value ? 'on' : 'off'} toggle-container`}>
        <input
          className="w-full h-full absolute opacity-0 cursor-pointer"
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Icon svg={CircleSVG} className={`toggle-circle`} />
      </div>
    </div>
  )
}

export default Toggle;