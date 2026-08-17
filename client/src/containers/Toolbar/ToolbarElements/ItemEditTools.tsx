import { useSelector } from "../../../hooks";
import SendTargets from "../../../components/SendTargets/SendTargets";
import cn from "classnames";

const ItemEditTools = ({ className }: { className?: string }) => {
  const { shouldSendTo } = useSelector((state) => state.undoable.present.item);

  return (
    <div className={cn("flex gap-1 items-center h-full", className)}>
      <p className="font-semibold mr-1 text-nowrap">Sends to:</p>
      <SendTargets shouldSendTo={shouldSendTo} />
    </div>
  );
};

export default ItemEditTools;
