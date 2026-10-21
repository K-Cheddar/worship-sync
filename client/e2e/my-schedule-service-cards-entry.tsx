import React from "react";
import ReactDOM from "react-dom/client";
import { Check } from "lucide-react";
import Icon from "../src/components/Icon/Icon";
import MySchedule from "../src/pages/MySchedule";
import ServiceOccurrenceCard, {
  SERVICE_OCCURRENCE_GRID_CLASS_NAME,
} from "../src/components/ServiceOccurrenceCard/ServiceOccurrenceCard";
import type { MyScheduleOccurrence } from "../src/api/auth";
import type {
  MyScheduleMember,
  PersonalScheduleAccess,
} from "../src/pages/myScheduleOperations";
import "../src/index.css";

const startsAt = (week: number) =>
  new Date(Date.UTC(2099, 0, 5 + week * 7, 15)).toISOString();

const fixtureOccurrences = Array.from({ length: 6 }, (_, index) => {
  const date = startsAt(index);
  return {
    occurrenceId: `service-${index + 1}@${date}`,
    serviceIds: [`service-${index + 1}`],
    name: index === 0 ? "Sabbath Service & 2nd service" : `Fixture Service ${index + 1}`,
    date: date.slice(0, 10),
    startsAt: date,
    plan: index === 1 ? { planId: "fixture-plan", name: "Fixture plan", sections: [] } : null,
    serving: [{
      memberId: "fixture-member",
      name: "Jordan Ray",
      isMe: true,
      scheduleId: `schedule-${index + 1}`,
      teamId: "media",
      teamName: "Media",
      positionId: "camera",
      positionName: index === 2
        ? "Camera - Stationary and Shoulder Rig (Long Position Name)"
        : "Camera - Stationary",
      columnKey: `camera::${index}`,
      isPrimary: true,
      response: index === 0 ? "accepted" : index === 3 ? "declined" : "pending",
    }],
  } as unknown as MyScheduleOccurrence;
});

const fixtureMember: MyScheduleMember = {
  memberId: "fixture-member",
  churchId: "fixture-church",
  firstName: "Jordan",
  lastName: "Ray",
  blockoutDates: [],
  updatedAt: "2098-01-01T00:00:00.000Z",
};

const access: PersonalScheduleAccess = {
  churchId: "fixture-church",
  memberId: "fixture-member",
  churchName: "Fixture Church",
  operations: {
    load: async () => ({
      success: true,
      member: fixtureMember,
      serviceTimeZone: "UTC",
      occurrences: fixtureOccurrences,
    }),
    respond: async ({ response }) => ({ success: true, response }),
    saveBlockouts: async (blockoutDates) => ({
      success: true,
      member: { ...fixtureMember, blockoutDates },
    }),
    acceptUnanswered: async () => ({
      success: true,
      newlyAccepted: 0,
      alreadyAccepted: 0,
      alreadyDeclined: 0,
      skipped: 0,
      failedScheduleCount: 0,
      schedules: [],
      authorizationChanged: false,
      hasMore: false,
      nextCursor: null,
    }),
  },
};

const PlanCardPreview = () => (
  <section className="mx-auto w-full max-w-[90rem] px-3 pt-3">
    <h1 className="mb-2 text-sm font-semibold text-gray-100">Plans card preview</h1>
    <ul aria-label="Plans service card preview" className={SERVICE_OCCURRENCE_GRID_CLASS_NAME}>
      <ServiceOccurrenceCard
        calendarDate="2099-01-05"
        startsAt={startsAt(0)}
        timeZone="UTC"
        serviceName="Sabbath Service & Second Worship Gathering"
        showTime={false}
        ariaLabel="Open plan preview for Sabbath Service & Second Worship Gathering, up next"
        isNextUpcoming
        isToday={false}
        statusTone="success"
        statusMarker={<Icon svg={Check} size="xs" className="text-emerald-300" />}
        onOpen={() => undefined}
      />
      <ServiceOccurrenceCard
        calendarDate="2099-01-12"
        startsAt={startsAt(1)}
        timeZone="UTC"
        serviceName="Power Up"
        ariaLabel="Open plan preview for Power Up"
        isNextUpcoming={false}
        isToday={false}
        statusTone="success"
        statusMarker={<Icon svg={Check} size="xs" className="text-emerald-300" />}
        onOpen={() => undefined}
      />
      <ServiceOccurrenceCard
        calendarDate="2099-01-19"
        startsAt={startsAt(2)}
        timeZone="UTC"
        serviceName="Easter Sunday"
        ariaLabel="Open plan preview for Easter Sunday, today"
        isNextUpcoming={false}
        isToday
        statusMarker={<span className="size-1.5 rounded-full bg-orange-400/45" />}
        onOpen={() => undefined}
      />
    </ul>
  </section>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <PlanCardPreview />
    <MySchedule access={access} />
  </>,
);
