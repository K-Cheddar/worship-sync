import { MonitorOff } from "lucide-react";
import Button from "../../../components/Button/Button";
import { useSelector } from "../../../hooks";
import { useActiveControllerProfile } from "../../../context/activeController";
import { selectDisplayOutputs } from "../../../store/displayOutputsSlice";
import { getSendTargetRestriction } from "../../../utils/sendTargets";

const SendRoutingIndicator = ({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) => {
  const type = useSelector((state) => state.undoable.present.item.type);
  const shouldSendTo = useSelector(
    (state) => state.undoable.present.item.shouldSendTo,
  );
  const outputs = useSelector(selectDisplayOutputs);
  const profile = useActiveControllerProfile();

  if (!type || !shouldSendTo) return null;

  const restriction = getSendTargetRestriction(shouldSendTo, outputs, profile);
  if (!restriction) return null;

  return (
    <Button
      type="button"
      variant="tertiary"
      svg={MonitorOff}
      iconSize="sm"
      color="#fbbf24"
      padding="py-1 px-2"
      gap="gap-1"
      className="min-w-0 max-w-36 shrink-0 border border-amber-400/40 text-amber-100 hover:border-amber-300/60 hover:bg-amber-400/10 max-sm:max-w-28"
      aria-label={restriction.tooltip}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title={restriction.tooltip}
      onClick={onClick}
    >
      <span className="truncate text-xs">{restriction.label}</span>
    </Button>
  );
};

export default SendRoutingIndicator;
