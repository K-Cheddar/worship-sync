import Toggle from "../../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../../hooks";
import { setShouldSendTo } from "../../../store/itemSlice";
import cn from "classnames";

const ItemEditTools = ({ className }: { className?: string }) => {
  const dispatch = useDispatch();
  const { shouldSendTo } = useSelector((state) => state.undoable.present.item);

  return (
    <div className={cn("flex gap-1 items-center", className)}>
      <p className="font-semibold mr-1">Sends to:</p>
      <Toggle
        label="Projector"
        value={shouldSendTo.projector}
        onChange={(val) => dispatch(setShouldSendTo({ projector: val }))}
      />
      <Toggle
        label="Monitor"
        value={shouldSendTo.monitor}
        onChange={(val) => dispatch(setShouldSendTo({ monitor: val }))}
      />
      <Toggle
        label="Stream"
        value={shouldSendTo.stream}
        onChange={(val) => dispatch(setShouldSendTo({ stream: val }))}
      />
    </div>
  );
};

export default ItemEditTools;
