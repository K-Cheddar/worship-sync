import Button from "../../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../../assets/icons/add.svg";
import { ReactComponent as MinusSVG } from "../../../assets/icons/remove.svg";
import Input from "../../../components/Input/Input";
import { useState } from "react";

const SlideEditTools = () => {

  const [fontSize, setFontSize] = useState(24);

  return (
    <div>
      <div className="flex gap-1 items-center">
        <Button svg={MinusSVG} variant="tertiary" onClick={ () => setFontSize((prev) => Math.max(prev - 1, 1))}/>
        <Input 
          label="Font Size"
          type="number"
          value={fontSize}
          onChange={(val) => setFontSize(val as number)}
          className="w-10"
          hideLabel
          />
        <Button svg={AddSVG} variant="tertiary" onClick={ () => setFontSize((prev) => Math.min(prev + 1, 48)) } />
      </div>
    </div>
  )
}

export default SlideEditTools;