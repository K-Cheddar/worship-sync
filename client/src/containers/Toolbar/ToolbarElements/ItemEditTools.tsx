import { createPortal } from "react-dom";
import SendTargets from "../../../components/SendTargets/SendTargets";
import { useSelector } from "../../../hooks";

const ItemEditTools = ({ drawerTarget }: { drawerTarget: HTMLElement | null }) => {
  const { shouldSendTo } = useSelector((state) => state.undoable.present.item);

  if (!drawerTarget) return null;
  return createPortal(
    <SendTargets shouldSendTo={shouldSendTo} layout="wrap" />,
    drawerTarget,
  );
};

export default ItemEditTools;
