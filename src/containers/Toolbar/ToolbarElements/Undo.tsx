import Button from "../../../components/Button/Button";
import { ReactComponent as UndoSVG } from "../../../assets/icons/undo.svg";
import { ReactComponent as RedoSVG} from "../../../assets/icons/redo.svg";

const Undo = () => {
  return (
    <div className="flex gap-1">
      <Button svg={UndoSVG} variant="tertiary" />
      <Button svg={RedoSVG} variant="tertiary" />
  </div>
  )
}

export default Undo;