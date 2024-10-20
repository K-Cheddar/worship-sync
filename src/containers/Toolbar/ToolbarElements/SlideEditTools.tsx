import Button from "../../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../../assets/icons/remove.svg";

const SlideEditTools = () => {
  return (
    <div>
      <div className="flex gap-1">
        <Button svg={MinusSVG} variant="tertiary" />
        <input className="w-14 px-2 py-1 rounded text-black" type="number" value={24}/>
        <Button svg={AddSVG} variant="tertiary" />
      </div>
    </div>
  )
}

export default SlideEditTools;