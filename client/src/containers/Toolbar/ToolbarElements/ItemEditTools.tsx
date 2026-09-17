import SendTargets from "../../../components/SendTargets/SendTargets";
import { useSelector } from "../../../hooks";
import cn from "classnames";

const ItemEditTools = ({ className }: { className?: string }) => {
  const { shouldSendTo } = useSelector((state) => state.undoable.present.item);

  return (
    <div className={cn("flex self-stretch items-center gap-1", className)}>
      <SendTargets shouldSendTo={shouldSendTo} />
    </div>
  );
};

export default ItemEditTools;
