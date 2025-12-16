import { CircleCheck } from "lucide-react";
import Icon from "../Icon/Icon";
import { useContext, useId } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";

type ToggleProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
  id?: string;
};

const Toggle = ({
  label,
  value,
  onChange,
  className,
  id: idProp,
}: ToggleProps) => {
  const { isMobile } = useContext(ControllerInfoContext) || {};
  const generatedId = useId();
  const id = idProp || generatedId;
  return (
    <div
      className={`flex gap-1 relative items-center h-4 ${
        className ? className : ""
      }`}
    >
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}:
      </label>
      <div
        className={`${
          value ? "bg-green-500" : "bg-gray-500"
        } w-8 h-4 md:w-10 md:h-5 border rounded-2xl border-gray-300 flex items-center relative focus-visible:outline focus-visible:outline-gray-200 hover:border-gray-100`}
      >
        <Icon
          svg={CircleCheck}
          className={
            "transition-all absolute pointer-events-none right-[15px] md:right-[19px] rtl:left-[15px] rtl:md:left-[19px] rtl:right-auto rtl:md:right-auto"
          }
          size={isMobile ? "lg" : "md"}
        />
      </div>
      <input
        className="w-full h-full absolute opacity-0 cursor-pointer left-0 top-0"
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        id={id}
      />
    </div>
  );
};

export default Toggle;
