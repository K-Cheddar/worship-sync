import Button from "../../../components/Button/Button";
import { Undo2, Redo2 } from "lucide-react";
import { ActionCreators } from "redux-undo";
import { useDispatch, useSelector } from "../../../hooks";
import { useEffect } from "react";
import cn from "classnames";
import { toolbarTabClassName } from "./ToolbarButton";

export const UndoButton = ({
  color,
  className,
  variant,
}: {
  color?: string;
  className?: string;
  variant?: "primary" | "secondary" | "tertiary" | "none";
}) => {
  const dispatch = useDispatch();
  const past = useSelector((state) => state.undoable.past);
  return (
    <Button
      svg={Undo2}
      color={color}
      disabled={!past.length}
      variant={variant || "tertiary"}
      onClick={() => dispatch(ActionCreators.undo())}
      className={cn(toolbarTabClassName(false, false), "p-1", className)}
      aria-label="Undo"
    />
  );
};

export const RedoButton = ({
  color,
  className,
  variant,
}: {
  color?: string;
  className?: string;
  variant?: "primary" | "secondary" | "tertiary" | "none";
}) => {
  const dispatch = useDispatch();
  const future = useSelector((state) => state.undoable.future);
  return (
    <Button
      svg={Redo2}
      color={color}
      disabled={!future.length}
      variant={variant || "tertiary"}
      onClick={() => dispatch(ActionCreators.redo())}
      className={cn(toolbarTabClassName(false, false), "p-1", className)}
      aria-label="Redo"
    />
  );
};

const Undo = () => {
  const dispatch = useDispatch();
  const isLyricsEditorOpen = useSelector((state) => state.undoable.present.item.isLyricsEditorOpen);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.getAttribute("data-ignore-undo") ===
          "true" ||
        isLyricsEditorOpen
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
  }, [dispatch, isLyricsEditorOpen]);

  return (
    <div className="flex gap-0">
      <UndoButton />
      <RedoButton />
    </div>
  );
};

export default Undo;
