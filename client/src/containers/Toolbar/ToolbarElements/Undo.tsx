import Button from "../../../components/Button/Button";
import { Undo2, Redo2 } from "lucide-react";
import { ActionCreators } from "redux-undo";
import { useDispatch, useSelector } from "../../../hooks";
import { useEffect } from "react";

export const UndoButton = ({
  color,
  className,
}: {
  color?: string;
  className?: string;
}) => {
  const dispatch = useDispatch();
  const { past } = useSelector((state) => state.undoable);
  return (
    <Button
      svg={Undo2}
      color={color}
      disabled={!past.length}
      variant="tertiary"
      onClick={() => dispatch(ActionCreators.undo())}
      className={className}
    />
  );
};

export const RedoButton = ({
  color,
  className,
}: {
  color?: string;
  className?: string;
}) => {
  const dispatch = useDispatch();
  const { future } = useSelector((state) => state.undoable);
  return (
    <Button
      svg={Redo2}
      color={color}
      disabled={!future.length}
      variant="tertiary"
      onClick={() => dispatch(ActionCreators.redo())}
      className={className}
    />
  );
};

const Undo = () => {
  const dispatch = useDispatch();
  const { isEditMode } = useSelector((state) => state.undoable.present.item);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.getAttribute("data-ignore-undo") ===
          "true" ||
        isEditMode
      )
        return;
      if (
        (event.key === "z" && event.metaKey) ||
        (event.key === "z" && event.ctrlKey)
      ) {
        dispatch(ActionCreators.undo());
      }

      if (
        (event.key === "y" && event.metaKey) ||
        (event.key === "y" && event.ctrlKey) ||
        (event.key === "z" && event.shiftKey && event.ctrlKey) ||
        (event.key === "z" && event.shiftKey && event.metaKey)
      ) {
        dispatch(ActionCreators.redo());
      }
    };

    document.addEventListener("keydown", handleKeyPress);

    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [dispatch, isEditMode]);

  return (
    <div className="flex gap-1">
      <UndoButton />
      <RedoButton />
    </div>
  );
};

export default Undo;
