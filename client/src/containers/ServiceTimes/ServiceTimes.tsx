import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import {
  ServiceTime,
  RecurrenceType,
  Weekday,
  MonthWeekOrdinal,
  DBServices,
  ServiceTimePosition,
} from "../../types";
import {
  addService,
  initiateServices,
  removeService,
  updateService,
  updateServicesFromRemote,
} from "../../store/serviceTimesSlice";
import generateRandomId from "../../utils/generateRandomId";
import Button from "../../components/Button/Button";
import ServiceTimesForm from "./ServiceTimesForm";
import StreamPreview from "../../components/StreamInfo/StreamPreview";
import ServiceTimesList from "./ServiceTimesList";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import Spinner from "../../components/Spinner/Spinner";
import { ReactComponent as VisibleSVG } from "../../assets/icons/visible.svg";
import { ReactComponent as NotVisibleSVG } from "../../assets/icons/not-visible.svg";

const ServiceTimes = () => {
  const dispatch = useDispatch();
  const services = useSelector(
    (s: RootState) => s.undoable.present.serviceTimes.list
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("#ffffff");
  const [background, setBackground] = useState<string>("#000000a1");
  const [recurrence, setRecurrence] = useState<RecurrenceType>("weekly");
  const [time, setTime] = useState("10:00");
  const [dateTimeISO, setDateTimeISO] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<Weekday>(0);
  const [ordinal, setOrdinal] = useState<MonthWeekOrdinal>(1);
  const [weekday, setWeekday] = useState<Weekday>(3);
  const [nameSize, setNameSize] = useState<number>(12);
  const [timeSize, setTimeSize] = useState<number>(35);
  const [position, setPosition] = useState<ServiceTimePosition>("top-right");
  const [shouldShowName, setShouldShowName] = useState<boolean>(true);
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState(true);

  const { db, updater, isPhone } = useContext(ControllerInfoContext) || {};

  useEffect(() => {
    setShowPreview(!isPhone);
  }, [isPhone]);

  const canSave = useMemo(() => {
    if (!name) return false;
    if (recurrence === "one_time") return !!dateTimeISO;
    if (recurrence === "weekly") return time.length > 0;
    if (recurrence === "monthly") return time.length > 0;
    return false;
  }, [name, recurrence, dateTimeISO, time]);

  const resetForm = () => {
    setName("");
    setColor("#ffffff");
    setBackground("#000000a1");
    setRecurrence("weekly");
    setTime("10:00");
    setDateTimeISO("");
    setDayOfWeek(0);
    setOrdinal(1);
    setWeekday(3);
    setNameSize(12);
    setTimeSize(35);
    setPosition("top-right");
    setShouldShowName(true);
  };

  const onSave = () => {
    if (!canSave) return;

    const base = {
      name,
      color,
      background,
      reccurence: recurrence,
      time: recurrence !== "one_time" ? time : undefined,
      dateTimeISO: recurrence === "one_time" ? dateTimeISO : undefined,
      dayOfWeek: recurrence === "weekly" ? dayOfWeek : undefined,
      ordinal: recurrence === "monthly" ? ordinal : undefined,
      weekday: recurrence === "monthly" ? weekday : undefined,
      position,
      nameSize,
      timeSize,
      shouldShowName,
      updatedAt: new Date().toISOString(),
    } as const;

    if (editingId) {
      dispatch(updateService({ id: editingId, changes: { ...base } }));
    } else {
      dispatch(
        addService({
          id: generateRandomId(),
          timerType: "countdown",
          createdAt: new Date().toISOString(),
          ...base,
        } as ServiceTime)
      );
    }
    setIsFormOpen(false);
    setEditingId(null);
    resetForm();
  };

  const onCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    resetForm();
  };

  const startCreate = () => {
    setEditingId(null);
    resetForm();
    setIsFormOpen(true);
  };

  const startEdit = (id: string) => {
    const s = services.find((x) => x.id === id);
    if (!s) return;
    setEditingId(id);
    setName(s.name || "");
    setColor(s.color || "#ffffff");
    setBackground(s.background || "#000000a1");
    setRecurrence(s.reccurence);
    setTime(s.time || "10:00");
    setDateTimeISO(s.dateTimeISO || "");
    setDayOfWeek(s.dayOfWeek ?? 0);
    setOrdinal((s.ordinal as MonthWeekOrdinal) ?? 1);
    setWeekday(s.weekday ?? 3);
    setNameSize(s.nameFontSize ?? 12);
    setTimeSize(s.timeFontSize ?? 35);
    setPosition(s.position ?? "top-right");
    setShouldShowName(s.shouldShowName ?? true);
    setIsFormOpen(true);
  };

  useEffect(() => {
    if (!db) return;
    const getServices = async () => {
      setIsLoading(true);
      try {
        const services: DBServices | undefined = await db.get("services");
        if (services) {
          dispatch(initiateServices(services.list));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    getServices();
  }, [dispatch, db]);

  const updateServicesFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "services") {
            console.log("updating services from remote");
            const update = _update as DBServices;
            dispatch(updateServicesFromRemote(update));
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateServicesFromExternal);

    return () =>
      updater.removeEventListener("update", updateServicesFromExternal);
  }, [updater, updateServicesFromExternal]);

  useGlobalBroadcast(updateServicesFromExternal);

  return (
    <main className="bg-gray-700 h-screen text-white p-4 flex flex-col gap-4 overflow-hidden">
      {isLoading && (
        <div className="flex justify-center items-center h-full w-full absolute top-0 left-0 bg-gray-700/50 z-10">
          <Spinner />
        </div>
      )}
      <h1 className="text-2xl font-bold">Service Times</h1>

      <Button className="w-fit" onClick={startCreate}>
        Add Service Timer
      </Button>

      {isFormOpen && (
        <div className="flex gap-6 items-start max-md:flex-col">
          <ServiceTimesForm
            editingId={editingId}
            name={name}
            setName={setName}
            color={color}
            setColor={setColor}
            background={background}
            setBackground={setBackground}
            recurrence={recurrence}
            setRecurrence={setRecurrence}
            time={time}
            setTime={setTime}
            dateTimeISO={dateTimeISO}
            setDateTimeISO={setDateTimeISO}
            dayOfWeek={dayOfWeek}
            setDayOfWeek={setDayOfWeek}
            ordinal={ordinal}
            setOrdinal={setOrdinal}
            weekday={weekday}
            setWeekday={setWeekday}
            nameSize={nameSize}
            setNameSize={setNameSize}
            timeSize={timeSize}
            setTimeSize={setTimeSize}
            position={position}
            setPosition={setPosition}
            shouldShowName={shouldShowName}
            setShouldShowName={setShouldShowName}
            canSave={canSave}
            onSave={onSave}
            onCancel={onCancel}
          />
          <div>
            <Button
              className="w-fit md:hidden"
              variant="secondary"
              svg={showPreview ? NotVisibleSVG : VisibleSVG}
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? "Hide Preview" : "Show Preview"}
            </Button>
            {showPreview && (
              <StreamPreview
                name={name}
                color={color}
                background={background}
                nameSize={nameSize}
                timeSize={timeSize}
                shouldShowName={shouldShowName}
                position={position}
              />
            )}
          </div>
        </div>
      )}

      <ServiceTimesList
        services={services}
        onEdit={startEdit}
        onDelete={(id) => dispatch(removeService(id))}
      />
    </main>
  );
};

export default ServiceTimes;
