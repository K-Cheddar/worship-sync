import Drawer from "../../components/Drawer";
import Input from "../../components/Input/Input";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import { setCreditsScene, setScheduleName, setTransitionScene } from "../../store/creditsSlice";

type CreditsSettingsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  position?: "left" | "right" | "top" | "bottom";
};

const CreditsSettingsDrawer = ({ isOpen, onClose, size = "md", position = "right" }: CreditsSettingsDrawerProps) => {
  const dispatch = useDispatch();
  const { transitionScene, creditsScene, scheduleName } = useSelector(
    (state: RootState) => state.undoable.present.credits
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Credits settings"
      position={position}
      size={size}
      contentClassName="overflow-auto flex-1 min-h-0 flex flex-col gap-4 p-4 text-white"
    >
      <Input
        label="Transition Scene"
        value={transitionScene}
        data-ignore-undo="true"
        onChange={(val) => dispatch(setTransitionScene(val as string))}
      />
      <Input
        label="Credits Scene"
        value={creditsScene}
        data-ignore-undo="true"
        onChange={(val) => dispatch(setCreditsScene(val as string))}
      />
      <Input
        label="Schedule Name"
        value={scheduleName}
        data-ignore-undo="true"
        onChange={(val) => dispatch(setScheduleName(val as string))}
      />
    </Drawer>
  );
};

export default CreditsSettingsDrawer;
