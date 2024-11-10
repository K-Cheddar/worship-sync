import Button from "../../../components/Button/Button";
import { ReactComponent as UndoSVG } from "../../../assets/icons/undo.svg";
import { ReactComponent as RedoSVG } from "../../../assets/icons/redo.svg";
import { ActionCreators } from "redux-undo";
import { useDispatch } from "../../../hooks";

const Undo = () => {
  const dispatch = useDispatch();

  return (
    <div className="flex gap-1">
      <Button
        svg={UndoSVG}
        variant="tertiary"
        onClick={() => dispatch(ActionCreators.undo())}
      />
      <Button
        svg={RedoSVG}
        variant="tertiary"
        onClick={() => dispatch(ActionCreators.redo())}
      />
    </div>
  );
};

export default Undo;
