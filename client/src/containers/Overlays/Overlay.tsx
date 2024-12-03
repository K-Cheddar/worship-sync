import Button from "../../components/Button/Button";
import { ReactComponent as OverlaysSVG } from "../../assets/icons/overlays.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { useDispatch } from "../../hooks";
import { deleteOverlay, selectOverlay } from "../../store/overlaysSlice";
import "./Overlays.scss";
import {
  updateParticipantOverlayInfo,
  updateStbOverlayInfo,
} from "../../store/presentationSlice";
import { OverlayInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

type OverlayProps = {
  overlay: OverlayInfo;
  selectedId: string;
  isStreamTransmitting: boolean;
};

const Overlay = ({
  overlay,
  selectedId,
  isStreamTransmitting,
}: OverlayProps) => {
  const dispatch = useDispatch();

  const isSelected = selectedId === overlay.id;
  const hasData = overlay.name || overlay.title || overlay.event;

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: overlay.id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      className={`flex items-center rounded-lg w-full leading-3 ${
        isSelected ? "bg-slate-950" : "bg-slate-800"
      }`}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Button
        variant="tertiary"
        wrap
        className="flex-col flex-1 h-full leading-4"
        padding="px-2 py-1.5"
        gap="gap-1"
        onClick={() => dispatch(selectOverlay(overlay))}
      >
        {overlay.name && (
          <span className="text-base flex items-center h-full">
            {overlay.name}
          </span>
        )}
        {overlay.title && (
          <span className="flex text-sm items-center h-full italic">
            {overlay.title}
          </span>
        )}
        {overlay.event && (
          <span className="flex text-sm items-center h-full">
            {overlay.event}
          </span>
        )}
        {!hasData && (
          <span className="text-sm leading-7">
            Click to add overlay details
          </span>
        )}
      </Button>
      {overlay.showDelete && (
        <Button
          variant="tertiary"
          className="text-sm ml-auto h-full"
          padding="px-2 py-1"
          svg={DeleteSVG}
          onClick={() => dispatch(deleteOverlay(overlay.id))}
        />
      )}
      {hasData && (
        <Button
          color={isStreamTransmitting ? "#22c55e" : "gray"}
          variant="tertiary"
          className="text-sm ml-auto h-full"
          padding="px-4 py-1"
          disabled={!isStreamTransmitting}
          svg={OverlaysSVG}
          onClick={() => {
            if (overlay.type === "stick-to-bottom") {
              dispatch(
                updateStbOverlayInfo({
                  name: overlay.name,
                  event: overlay.event,
                  duration: overlay.duration,
                  id: overlay.id,
                })
              );
            } else if (overlay.type === "participant") {
              dispatch(
                updateParticipantOverlayInfo({
                  name: overlay.name,
                  title: overlay.title,
                  event: overlay.event,
                  duration: overlay.duration,
                  type: overlay.type,
                  id: overlay.id,
                })
              );
            }
          }}
        >
          Send
        </Button>
      )}
    </li>
  );
};

export default Overlay;
