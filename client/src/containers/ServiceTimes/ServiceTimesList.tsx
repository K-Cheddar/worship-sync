import { ServiceTime } from "../../types";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import ServiceItem from "./ServiceItem";
import TimeAdjuster from "./TimeAdjuster";

type Props = {
  services: ServiceTime[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  upcomingService: { service: ServiceTime; nextAt: Date } | null;
};

const ServiceTimesList = ({
  services,
  onEdit,
  onDelete,
  upcomingService,
}: Props) => {
  const timers = useSelector((s: RootState) => s.timers.timers);
  const nextServiceTimer = timers.find((t) => t.id === "next-service");

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border border-white/12 bg-black/30 p-4">
      <h2 className="text-xl font-semibold">Service Times</h2>
      {services.length === 0 ? (
        <p className="text-gray-300">No service times yet.</p>
      ) : (
        <ul className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {upcomingService && (
            <div className="flex flex-col gap-2 rounded-md border border-cyan-400/45 bg-white/5 p-3">
              <p>Next service</p>
              <ServiceItem
                service={upcomingService.service}
                onEdit={onEdit}
                onDelete={onDelete}
              />
              {nextServiceTimer && (
                <TimeAdjuster serviceId={upcomingService.service.id} />
              )}
            </div>
          )}

          {services
            .filter((s) => s.id !== upcomingService?.service.id)
            .map((s) => (
              <ServiceItem
                key={s.id}
                service={s}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
        </ul>
      )}
    </section>
  );
};

export default ServiceTimesList;
