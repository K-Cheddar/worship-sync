import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import {
  ServiceTime,
  DBServices,
} from "../../types";
import {
  addService,
  removeService,
  updateService,
  updateServicesFromRemote,
} from "../../store/serviceTimesSlice";
import generateRandomId from "../../utils/generateRandomId";
import Button from "../../components/Button/Button";
import ServiceTimesForm from "./ServiceTimesForm";
import ServiceTimesList from "./ServiceTimesList";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";
import Spinner from "../../components/Spinner/Spinner";
import { Plus } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "@/components/ui/tabs";

/** Service times editor for the overlay controller "Service times" tab only. */
const ServiceTimes = () => {
  const dispatch = useDispatch();
  const services = useSelector(
    (s: RootState) => s.undoable.present.serviceTimes.list
  );
  const isServicesInitialized = useSelector(
    (s: RootState) => s.undoable.present.serviceTimes.isInitialized,
  );

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"services" | "edit">("services");

  const { updater, isMobile } = useContext(ControllerInfoContext) || {};

  const editingService = useMemo(
    () => services.find((s) => s.id === editingId) ?? null,
    [services, editingId],
  );

  const upcomingService = useDisplayedUpcomingService(
    services,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );

  const targetIso = useMemo(() => {
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [upcomingService]);
  const upcomingServiceTimeText = useNextServiceCountdownText(targetIso);

  const handleSave = useCallback(
    (values: Partial<ServiceTime>) => {
      if (editingId) {
        dispatch(updateService({ id: editingId, changes: { ...values } }));
      } else {
        dispatch(
          addService({
            id: generateRandomId(),
            timerType: "countdown",
            createdAt: new Date().toISOString(),
            ...values,
          } as ServiceTime)
        );
      }
      setIsFormOpen(false);
      setEditingId(null);
      if (isMobile) setMobileTab("services");
    },
    [dispatch, editingId, isMobile],
  );

  const handleCancel = useCallback(() => {
    setIsFormOpen(false);
    setEditingId(null);
    if (isMobile) setMobileTab("services");
  }, [isMobile]);

  const startCreate = () => {
    setEditingId(null);
    setIsFormOpen(true);
    if (isMobile) setMobileTab("edit");
  };

  const startEdit = (id: string) => {
    setEditingId(id);
    setIsFormOpen(true);
    if (isMobile) setMobileTab("edit");
  };

  const updateServicesFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "services") {
            const update = _update as DBServices;
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
    <ServiceTimesForm
      editingId={editingId}
      initialValues={editingService}
      onSave={handleSave}
      onCancel={handleCancel}
    />
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
      {!isServicesInitialized && (
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
