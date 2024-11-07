import Button from "../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as OverlaysSVG } from "../../assets/icons/overlays.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { useDispatch, useSelector } from "../../hooks";
import {
  addParticipant,
  deleteParticipant,
  selectParticipant,
  updateParticipant,
} from "../../store/participantsSlice";
import Input from "../../components/Input/Input";
import "./Participants.scss";
import { useEffect, useState } from "react";
import Toggle from "../../components/Toggle/Toggle";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { updateParticipantInfo } from "../../store/presentationSlice";

const Participants = () => {
  const { list, id, name, title, event, showDelete } = useSelector(
    (state) => state.participants
  );
  const { isStreamTransmitting } = useSelector((state) => state.presentation);
  const [localName, setLocalName] = useState(name);
  const [localTitle, setLocalTitle] = useState(title);
  const [localEvent, setLocalEvent] = useState(event);
  const [localShowDelete, setLocalShowDelete] = useState(showDelete);
  const dispatch = useDispatch();

  useEffect(() => {
    setLocalName(name);
    setLocalTitle(title);
    setLocalEvent(event);
    setLocalShowDelete(showDelete);
  }, [name, title, event, id, showDelete]);

  return (
    <div className="flex flex-col w-full h-full p-2 gap-2">
      <h2 className="text-xl font-semibold text-center h-fit">Participants</h2>
      <div className="flex gap-2 h-full">
        <section className="w-1/2 flex flex-col gap-2 h-full">
          <ul className="participants-list">
            {list.map((participant) => {
              const isSelected = id === participant.id;
              const hasData =
                participant.name || participant.title || participant.event;
              return (
                <li
                  key={participant.id}
                  className={`flex items-center rounded-lg w-full leading-3 ${
                    isSelected ? "bg-slate-950" : "bg-slate-800"
                  }`}
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
                      onClick={() =>
                        dispatch(deleteParticipant(participant.id))
                      }
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
            })}
          </ul>
          <Button
            className="text-sm h-7 w-fit mr-auto"
            svg={AddSVG}
            onClick={() => dispatch(addParticipant())}
          >
            Add Participant
          </Button>
        </section>
        <div className="flex flex-col items-center gap-4 flex-1">
          {id && (
            <>
              <div>
                <h2 className="bg-slate-900 text-center font-semibold text-base">
                  Preview
                </h2>
                <DisplayWindow
                  showBorder
                  width={25}
                  participantInfo={{
                    name: localName,
                    title: localTitle,
                    event: localEvent,
                  }}
                  displayType="stream"
                />
              </div>
              <section className="flex flex-col gap-2 bg-slate-800 p-2 rounded-md min-w-1/2">
                <Input
                  className="text-sm flex gap-2 items-center"
                  lableClassName="w-10"
                  label="Name"
                  value={localName}
                  onChange={(val) => setLocalName(val as string)}
                />
                <Input
                  className="text-sm flex gap-2 items-center"
                  lableClassName="w-10"
                  label="Title"
                  value={localTitle}
                  onChange={(val) => setLocalTitle(val as string)}
                />
                <Input
                  className="text-sm flex gap-2 items-center"
                  lableClassName="w-10"
                  label="Event"
                  value={localEvent}
                  onChange={(val) => setLocalEvent(val as string)}
                />
                <span className="flex gap-1 items-center">
                  <Toggle
                    label="Show Delete"
                    value={localShowDelete}
                    onChange={(val) => setLocalShowDelete(val)}
                  />
                  <Button
                    className="text-sm h-7 w-fit ml-auto"
                    onClick={() =>
                      dispatch(
                        updateParticipant({
                          id,
                          name: localName,
                          title: localTitle,
                          event: localEvent,
                          showDelete: localShowDelete,
                        })
                      )
                    }
                  >
                    Update Participant
                  </Button>
                </span>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Participants;
