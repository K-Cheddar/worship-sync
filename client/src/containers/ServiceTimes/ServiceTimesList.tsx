import { ServiceTime } from "../../types";
import ServiceItem from "./ServiceItem";
import TimeAdjuster from "./TimeAdjuster";
import NextServiceLiveCountdown from "./NextServiceLiveCountdown";

type Props = {
  services: ServiceTime[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  upcomingService: { service: ServiceTime; nextAt: Date } | null;
  upcomingServiceTimeText: string | null;
};

const ServiceTimesList = ({
  services,
  onEdit,
  onDelete,
  upcomingService,
  upcomingServiceTimeText,
}: Props) => {
  const otherServices = services.filter(
    (s) => s.id !== upcomingService?.service.id,
  );

  return (
    <section className="flex w-full shrink-0 flex-col gap-2 rounded-md border border-white/12 bg-black/30 p-4">
      <h2 className="text-xl font-semibold">Service Times</h2>
      {services.length === 0 ? (
        <p className="text-gray-300">No service times yet.</p>
      ) : (
        <>
          {upcomingService && (
            <div className="flex min-w-0 shrink-0 flex-col gap-2 rounded-md border border-cyan-400/45 bg-white/5 p-3">
              <p>Next service</p>
              <ServiceItem
                service={upcomingService.service}
                onEdit={onEdit}
                onDelete={onDelete}
              />
              <NextServiceLiveCountdown
                service={upcomingService.service}
                timeText={upcomingServiceTimeText}
              />
              <TimeAdjuster serviceId={upcomingService.service.id} />
            </div>
          )}

          {otherServices.length > 0 && (
            <ul className="scrollbar-variable flex flex-col gap-2">
              {otherServices.map((s) => (
                <ServiceItem
                  key={s.id}
                  service={s}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default ServiceTimesList;
