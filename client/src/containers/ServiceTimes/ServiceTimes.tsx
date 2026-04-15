import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import StreamPreview from "./StreamPreview";
import ServiceTimesList from "./ServiceTimesList";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useSyncNextServiceTimer } from "../../hooks/useSyncNextServiceTimer";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import Spinner from "../../components/Spinner/Spinner";
import { Eye, EyeOff } from "lucide-react";
import { getClosestUpcomingService } from "../../utils/serviceTimes";
import { cn } from "@/utils/cnHelper";

type ServiceTimesProps = {
  /** When true, layout matches embedded credits (overlay controller third tab). */
  embeddedInOverlayController?: boolean;
};

const ServiceTimes = ({
  embeddedInOverlayController = false,
}: ServiceTimesProps) => {
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

  const { db, updater, isMobile } = useContext(ControllerInfoContext) || {};
  const { hostId } = useContext(GlobalInfoContext) || {};

  const [upcomingService, setUpcomingService] = useState<{
    service: ServiceTime;
    nextAt: Date;
  } | null>(null);
  const upcomingRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateUpcomingService = useCallback(() => {
    setUpcomingService(getClosestUpcomingService(services));
  }, [services]);

  useEffect(() => {
    updateUpcomingService();
  }, [updateUpcomingService]);

  const targetIso = useSyncNextServiceTimer(upcomingService, hostId);

  // When the current target passes, wait through the grace window then recompute (matches stream info).
  useEffect(() => {
    if (upcomingRefreshTimeoutRef.current) {
      clearTimeout(upcomingRefreshTimeoutRef.current as unknown as number);
      upcomingRefreshTimeoutRef.current = null;
    }

    if (!targetIso) return;

    const now = new Date();
    const target = new Date(targetIso);
    const msUntilTarget = target.getTime() - now.getTime();

    let delayMs: number;
    if (msUntilTarget > 0) {
      delayMs = msUntilTarget + NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS;
    } else {
      const pastMs = Math.abs(msUntilTarget);
      delayMs = Math.max(0, NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS - pastMs);
    }

    if (delayMs === 0) {
      updateUpcomingService();
      return;
    }

    upcomingRefreshTimeoutRef.current = setTimeout(() => {
      updateUpcomingService();
      upcomingRefreshTimeoutRef.current = null;
    }, delayMs) as unknown as NodeJS.Timeout;

    return () => {
      if (upcomingRefreshTimeoutRef.current) {
        clearTimeout(upcomingRefreshTimeoutRef.current as unknown as number);
        upcomingRefreshTimeoutRef.current = null;
      }
    };
  }, [targetIso, updateUpcomingService]);

  useEffect(() => {
    setShowPreview(!isMobile);
  }, [isMobile]);

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

    const base: Partial<ServiceTime> = {
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
      nameFontSize: nameSize,
      timeFontSize: timeSize,
      shouldShowName,
      overrideDateTimeISO: undefined,
      updatedAt: new Date().toISOString(),
    };

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
        dispatch(initiateServices(services?.list ?? []));
      } catch (e) {
        console.error(e);
        dispatch(initiateServices([]));
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
            const update = _update as DBServices;
            // Only process if we have services in the update, or if we currently have no services
            // This prevents empty broadcasts from clearing our existing services
            if (
              (update.list && update.list.length > 0) ||
              services.length === 0
            ) {
              dispatch(updateServicesFromRemote(update));
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, services]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateServicesFromExternal);

    return () =>
      updater.removeEventListener("update", updateServicesFromExternal);
  }, [updater, updateServicesFromExternal]);

  useGlobalBroadcast(updateServicesFromExternal);

  const rootClassName = cn(
    "bg-homepage-canvas text-white flex flex-col",
    embeddedInOverlayController
      ? "relative min-h-0 flex-1 overflow-hidden p-3"
      : "min-h-0 flex-1 gap-4 p-4",
  );

  const inner = (
    <>
      {isLoading && (
        <div className="flex justify-center items-center h-full w-full absolute top-0 left-0 bg-homepage-canvas/50 z-10">
          <Spinner />
        </div>
      )}
      {embeddedInOverlayController ? (
        <h2 className="text-lg font-semibold tracking-tight text-gray-100">
          Service times
        </h2>
      ) : (
        <h1 className="text-2xl font-bold">Service Times</h1>
      )}

      <section className="flex gap-2">
        <Button className="w-fit" onClick={startCreate}>
          Add Service Timer
        </Button>
        {isFormOpen && (
          <Button
            className="w-fit md:hidden"
            variant="secondary"
            svg={showPreview ? EyeOff : Eye}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? "Hide Preview" : "Show Preview"}
          </Button>
        )}
      </section>
      {isFormOpen && (
        <div
          className={cn(
            "flex gap-6 items-start max-md:flex-col",
            embeddedInOverlayController ? "max-h-[40vh]" : "max-h-[50vh]",
          )}
        >
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
      )}

      {(!isMobile || !showPreview) && (
        <ServiceTimesList
          services={services}
          onEdit={startEdit}
          onDelete={(id) => dispatch(removeService(id))}
          upcomingService={upcomingService}
          hostId={hostId}
        />
      )}
    </>
  );

  if (embeddedInOverlayController) {
    return (
      <div className={rootClassName} role="main">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {inner}
        </div>
      </div>
    );
  }

  return <main className={rootClassName}>{inner}</main>;
};

export default ServiceTimes;
