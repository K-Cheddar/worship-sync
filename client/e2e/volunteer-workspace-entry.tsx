import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { GlobalInfoContext } from "../src/context/globalInfo";
import MySchedule from "../src/pages/MySchedule";
import { VolunteerNavigationGuardProvider } from "../src/pages/VolunteerNavigationGuard";
import type { MyScheduleOccurrence } from "../src/api/auth";
import type { PersonalScheduleAccess } from "../src/pages/myScheduleOperations";
import type { MyScheduleMember } from "../src/pages/myScheduleOperations";
import { getVolunteerAvailability, type VolunteerSession } from "../src/api/volunteer";
import "../src/index.css";

const timestamp = (day: number) => new Date(Date.UTC(2099, 10, day, 15)).toISOString();
const historicalGroupId = "group:1jrege3bu2c6hs0lrc7c@2026-11-07";
const historicalIndividualId = "1j8r6dqu4anb91e4jac8@2026-11-07";

const occurrences = Array.from({ length: 8 }, (_, index) => {
  const startsAt = timestamp(1 + index * 7);
  const serviceDate = startsAt.slice(0, 10);
  return {
    occurrenceId: `fixture-service-${index + 1}@${serviceDate}`,
    serviceIds: [`fixture-service-${index + 1}`],
    name: index === 0
      ? "Sabbath Service & Second Worship Gathering with Guest Musicians"
      : `Fixture Service ${index + 1}`,
    date: serviceDate,
    startsAt,
    plan: null,
    serving: [{
      memberId: "fixture-member",
      name: "Jordan Ray",
      isMe: true,
      scheduleId: `schedule-${index + 1}`,
      teamId: "media",
      teamName: "Media",
      positionId: "camera",
      positionName: "Camera - Stationary and Shoulder Rig (Long Position Name)",
      columnKey: `camera::${index}`,
      isPrimary: true,
      response: "pending",
    }],
  } as unknown as MyScheduleOccurrence;
});

const availabilityOccurrences = [
  {
    occurrenceId: historicalGroupId,
    responseOccurrenceIds: [historicalGroupId, historicalIndividualId],
    name: "Sabbath Service & 2nd service",
    startsAt: "2026-11-07T14:00:00.000Z",
    serviceDate: "2026-11-07",
  },
  ...Array.from({ length: 6 }, (_, index) => {
    const startsAt = timestamp(14 + index * 7);
    return {
      occurrenceId: `fixture-availability-${index + 1}@${startsAt.slice(0, 10)}`,
      name: index === 0
        ? "Sabbath Service with a Long Guest Musician and Volunteer Team Name"
        : `Fixture Availability Service ${index + 1}`,
      startsAt,
      serviceDate: startsAt.slice(0, 10),
    };
  }),
];

const availabilityRequest = {
  recipientId: "fixture-recipient",
  formId: "fixture-form",
  name: "November Availability",
  responseDeadline: "2099-11-01",
  availabilityMessage: "Please respond for each service date.",
  respondedAt: "",
  submissionId: "",
  editable: true,
  occurrences: availabilityOccurrences,
  availability: {},
  unansweredOccurrenceIds: availabilityOccurrences.map(({ occurrenceId }) => occurrenceId),
  availabilityRevision: Object.fromEntries(availabilityOccurrences.flatMap(({ occurrenceId, responseOccurrenceIds }) =>
    (responseOccurrenceIds?.length ? responseOccurrenceIds : [occurrenceId]).map((id) => [id, 0]),
  )),
};

const member: MyScheduleMember = {
  memberId: "fixture-member",
  churchId: "fixture-church",
  firstName: "Jordan",
  lastName: "Ray",
  blockoutDates: [],
  updatedAt: "2098-01-01T00:00:00.000Z",
};
const session: VolunteerSession = {
  churchId: "fixture-church",
  memberId: "fixture-member",
  csrfToken: "fixture-csrf-token",
  expiresAt: Date.UTC(2100, 0, 1),
};

const access: PersonalScheduleAccess = {
  churchId: "fixture-church",
  memberId: "fixture-member",
  churchName: "Fixture Church",
  sessionKey: "fixture-session",
  operations: {
    load: async () => ({ success: true, member, serviceTimeZone: "America/New_York", occurrences }),
    respond: async ({ response }) => ({ success: true, response }),
    saveBlockouts: async (blockoutDates) => ({ success: true, member: { ...member, blockoutDates } }),
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
    loadAvailability: (options) => getVolunteerAvailability(session, options),
    saveAvailability: async () => ({ success: true, submissionId: "fixture-response" }),
  },
};

const context = {
  churchId: "fixture-church",
  churchName: "Fixture Church",
  userId: "fixture-volunteer",
  role: "member",
} as never;

const WorkspaceRoute = ({ accountless }: { accountless: boolean }) => {
  const page = <MySchedule access={accountless ? access : undefined} navigationGuardProvided />;
  return (
    <VolunteerNavigationGuardProvider>
      {accountless ? page : <GlobalInfoContext.Provider value={context}>{page}</GlobalInfoContext.Provider>}
    </VolunteerNavigationGuardProvider>
  );
};

const accountless = new URLSearchParams(window.location.search).get("mode") === "accountless";
const initialPath = accountless ? "/s?view=schedule" : "/my-schedule";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <WorkspaceRoute key={accountless ? "accountless" : "signed-in"} accountless={accountless} />
  </HashRouter>,
);

if (!window.location.hash) window.location.hash = `#${initialPath}`;
