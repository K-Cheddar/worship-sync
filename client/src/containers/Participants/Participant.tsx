import Button from "../../components/Button/Button";
import { ReactComponent as OverlaysSVG } from "../../assets/icons/overlays.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { useDispatch } from "../../hooks";
import {
  deleteParticipant,
  selectParticipant,
} from "../../store/participantsSlice";
import "./Participants.scss";
import { updateParticipantInfo } from "../../store/presentationSlice";
import { ParticipantType } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";

type ParticipantProps = {
  participant: ParticipantType;
  selectedId: string;
  isStreamTransmitting: boolean;
};

const Participant = ({
  participant,
  selectedId,
  isStreamTransmitting,
}: ParticipantProps) => {
  const dispatch = useDispatch();

  const isSelected = selectedId === participant.id;
  const hasData = participant.name || participant.title || participant.event;

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: participant.id,
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
        padding="px-2 py-0.5"
        gap="gap-0"
        onClick={() => dispatch(selectParticipant(participant))}
      >
        {participant.name && (
          <span className="text-base flex items-center h-full">
            {participant.name}
          </span>
        )}
        {participant.title && (
          <span className="flex text-sm items-center h-full italic">
            {participant.title}
          </span>
        )}
        {participant.event && (
          <span className="flex text-sm items-center h-full">
            {participant.event}
          </span>
        )}
        {!hasData && (
          <span className="text-sm leading-7">
            Click to add participant details
          </span>
        )}
      </Button>
      {participant.showDelete && (
        <Button
          variant="tertiary"
          className="text-sm ml-auto h-full"
          padding="px-2 py-1"
          svg={DeleteSVG}
          onClick={() => dispatch(deleteParticipant(participant.id))}
        />
      )}
      {hasData && (
        <Button
          color={isStreamTransmitting ? "#22c55e" : "gray"}
          variant="tertiary"
          className="text-sm ml-auto h-full"
          padding="px-2 py-1"
          disabled={!isStreamTransmitting}
          svg={OverlaysSVG}
          onClick={() =>
            dispatch(
              updateParticipantInfo({
                name: participant.name,
                title: participant.title,
                event: participant.event,
              })
            )
          }
        >
          Send
        </Button>
      )}
    </li>
  );
};

export default Participant;
