import { useState } from "react";
import { ReactComponent as SkipSVG } from "../../../assets/icons/skip.svg";
import { ReactComponent as CheckSVG } from "../../../assets/icons/check.svg";
import { ReactComponent as CloseSVG } from "../../../assets/icons/close.svg";

import Button from "../../../components/Button/Button";
import Icon from "../../../components/Icon/Icon";

const ItemEditTools = () => {
  const [skipTitle, setSkipTitlte] = useState(false);
  return (
    <div>
      <div className="flex gap-1 items-center">
        <Button onClick={() => setSkipTitlte(!skipTitle) } svg={SkipSVG} variant="none" className="bg-transparent hover:bg-gray-500 active:bg-gray-400 text-xs">Skip Title</Button>
        <Icon color={skipTitle ? "green" : "red"} svg={skipTitle ? CheckSVG : CloseSVG}/>
      </div>
    </div>
  )
}

export default ItemEditTools;