import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import Spinner from "../../components/Spinner/Spinner";
import { Plus } from "lucide-react";
import { getClosestUpcomingService, getEffectiveTargetTime } from "../../utils/serviceTimes";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "@/components/ui/tabs";

/** Service times editor for the overlay controller “Service times” tab only. */
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
  const [isLoading, setIsLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState<"services" | "edit">("services");

  const { db, updater, isMobile } = useContext(ControllerInfoContext) || {};

  const [upcomingService, setUpcomingService] = useState<{
    service: ServiceTime;
    nextAt: Date;
  } | null>(null);
  const upcomingRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const formRef = useRef<HTMLElement | null>(null);
  const [previewMaxHeightPx, setPreviewMaxHeightPx] = useState<number | null>(
    null,
  );

  const updateUpcomingService = useCallback(() => {
    setUpcomingService(getClosestUpcomingService(services));
  }, [services]);

  useEffect(() => {
    updateUpcomingService();
  }, [updateUpcomingService]);

  const targetIso = useMemo(() => {
    if (!upcomingService) return null;
    const effectiveTime = getEffectiveTargetTime(upcomingService.service);
    return effectiveTime ? effectiveTime.toISOString() : null;
  }, [upcomingService]);
  const upcomingServiceTimeText = useNextServiceCountdownText(targetIso);

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
    if (isMobile) setMobileTab("services");
  };

  const onCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    resetForm();
    if (isMobile) setMobileTab("services");
  };

  const startCreate = () => {
    setEditingId(null);
    resetForm();
    setIsFormOpen(true);
    if (isMobile) setMobileTab("edit");
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
    if (isMobile) setMobileTab("edit");
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

  const syncPreviewMaxHeight = useCallback(() => {
    if (!isFormOpen) {
      setPreviewMaxHeightPx(null);
      return;
    }
    const wide =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches;
    const el = formRef.current;
    if (!wide || !el) {
      setPreviewMaxHeightPx(null);
      return;
    }
    setPreviewMaxHeightPx(Math.ceil(el.getBoundingClientRect().height));
  }, [isFormOpen]);

  useLayoutEffect(() => {
    syncPreviewMaxHeight();
    const mq =
      typeof window !== "undefined"
        ? window.matchMedia("(min-width: 768px)")
        : null;
    const onMq = () => syncPreviewMaxHeight();
    mq?.addEventListener("change", onMq);
    const el = formRef.current;
    const ro =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncPreviewMaxHeight())
        : null;
    if (el && ro) ro.observe(el);
    return () => {
      mq?.removeEventListener("change", onMq);
      if (ro && el) ro.disconnect();
    };
  }, [syncPreviewMaxHeight]);

  const listSection = (
    <ServiceTimesList
      services={services}
      onEdit={startEdit}
      onDelete={(id) => dispatch(removeService(id))}
      upcomingService={upcomingService}
      upcomingServiceTimeText={upcomingServiceTimeText}
    />
  );

  const editorLayout = isFormOpen ? (
    <div className="flex w-full shrink-0 flex-col gap-4 md:flex-row md:items-stretch md:gap-6">
      <ServiceTimesForm
          ref={formRef}
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
      <StreamPreview
        name={name}
        color={color}
        background={background}
        nameSize={nameSize}
        timeSize={timeSize}
        shouldShowName={shouldShowName}
        position={position}
        maxColumnHeightPx={isMobile ? null : previewMaxHeightPx}
      />
    </div>
  ) : null;

  const editTabPlaceholder = (
    <div className="rounded-md border border-white/12 bg-black/30 p-4 text-gray-200">
      <p className="text-sm">
        Open the Services tab to add a timer or choose one to edit.
      </p>
      <Button
        variant="secondary"
        className="mt-3 w-full justify-center sm:w-fit"
        onClick={() => setMobileTab("services")}
      >
        Go to Services
      </Button>
    </div>
  );

  const tabsContentClass =
    "mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto outline-none data-[state=inactive]:hidden";

  return (
    <div
      role="main"
      className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-homepage-canvas p-3 text-white scrollbar-variable"
    >
      {isLoading && (
        <div className="flex justify-center items-center h-full w-full absolute top-0 left-0 bg-homepage-canvas/50 z-10">
          <Spinner />
        </div>
      )}
      <h2 className="shrink-0 text-lg font-semibold tracking-tight text-gray-100">
        Service times
      </h2>

      {isMobile ? (
        <Tabs
          value={mobileTab}
          onValueChange={(v) =>
            setMobileTab(v === "edit" ? "edit" : "services")
          }
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList variant="line" className={lineTabsListShellClassName}>
            <TabsTrigger
              value="services"
              className={lineTabsTriggerClassName}
            >
              Services
            </TabsTrigger>
            <TabsTrigger value="edit" className={lineTabsTriggerClassName}>
              Edit
            </TabsTrigger>
          </TabsList>
          <TabsContent value="services" forceMount className={tabsContentClass}>
            <Button
              className="w-fit shrink-0"
              svg={Plus}
              iconSize="sm"
              variant="cta"
              onClick={startCreate}
            >
              Add Service Timer
            </Button>
            {listSection}
          </TabsContent>
          <TabsContent value="edit" forceMount className={tabsContentClass}>
            {isFormOpen ? editorLayout : editTabPlaceholder}
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <section className="flex shrink-0 gap-2">
            <Button
              className="w-fit"
              svg={Plus}
              iconSize="sm"
              onClick={startCreate}
              variant="cta"
            >
              Add Service Timer
            </Button>
          </section>
          {editorLayout}
          {listSection}
        </>
      )}
    </div>
  );
};

export default ServiceTimes;
