import test from "node:test";
import assert from "node:assert/strict";
import { projectVolunteerScheduleForPersonalAccess } from "./volunteerProjection.js";

test("personal-access projection keeps volunteer-safe data and removes private fields and links", () => {
  const projected = projectVolunteerScheduleForPersonalAccess({
    serviceTimeZone: "America/New_York",
    member: {
      memberId: "internal-member-id",
      userId: "account-id",
      firstName: "Jordan",
      lastName: "Ray",
      email: "private@example.com",
      phoneNumber: "+15555550123",
      notes: "ADMIN-ONLY-MEMBER-NOTE",
      roles: ["admin"],
      positionIds: ["private-position-id"],
      qualifications: ["ADMIN-ONLY-QUALIFICATION"],
      blockoutDates: [{ startDate: "2099-11-01", endDate: "2099-11-02", notes: "Away" }],
      updatedAt: "revision-a",
      archivedAt: null,
    },
    occurrences: [{
      occurrenceId: "service@2099-11-01",
      serviceIds: ["service"],
      name: "Sunday Service",
      date: "2099-11-01",
      startsAt: "2099-11-01T14:00:00.000Z",
      privateOccurrenceField: "INTERNAL-OCCURRENCE-DATA",
      serving: [
        {
          isMe: true,
          name: "Jordan Ray",
          memberId: "internal-member-id",
          scheduleId: "schedule-id",
          teamId: "internal-team-id",
          teamName: "Worship",
          positionId: "vocal-id",
          positionName: "Vocalist",
          columnKey: "vocal-id::0",
          isPrimary: true,
          response: "accepted",
          respondedAt: "2099-10-20T10:00:00.000Z",
          email: "private@example.com",
          blockoutDates: [{ notes: "PRIVATE-TEAMMATE-DATA" }],
        },
        {
          isMe: false,
          name: "Casey R.",
          memberId: "teammate-id",
          email: "teammate@example.com",
          phoneNumber: "+15555550124",
          response: "declined",
          respondedAt: "PRIVATE-RESPONSE-TIME",
          blockoutDates: [{ notes: "PRIVATE-TEAMMATE-DATA" }],
        },
      ],
      plan: {
        planId: "internal-plan-id",
        name: "Sunday Order",
        published: true,
        publicUrls: { team: "https://example.test/services/secret-token" },
        publicLinkToken: "SECRET-PLAN-TOKEN",
        privateNotes: "PRIVATE-PLAN-NOTE",
        sections: [{
          name: "Opening",
          internalNotes: "PRIVATE-SECTION-NOTE",
          elements: [{
            type: "song",
            title: "Welcome",
            startTime: "10:00",
            durationSeconds: 240,
            teamNotes: "PRIVATE-ELEMENT-NOTE",
            assignedMemberId: "internal-member-id",
          }],
        }],
      },
    }],
  });

  const serialized = JSON.stringify(projected);
  for (const secret of [
    "internal-member-id", "account-id", "private@example.com", "+15555550123",
    "ADMIN-ONLY-MEMBER-NOTE", "ADMIN-ONLY-QUALIFICATION", "private-position-id",
    "internal-team-id", "teammate-id", "teammate@example.com", "PRIVATE-RESPONSE-TIME",
    "PRIVATE-TEAMMATE-DATA", "internal-plan-id", "secret-token", "SECRET-PLAN-TOKEN",
    "PRIVATE-PLAN-NOTE", "PRIVATE-SECTION-NOTE", "PRIVATE-ELEMENT-NOTE",
    "INTERNAL-OCCURRENCE-DATA",
  ]) {
    assert.equal(serialized.includes(secret), false, `projection leaked ${secret}`);
  }
  assert.equal(projected.member.firstName, "Jordan");
  assert.equal(projected.member.updatedAt, "revision-a");
  assert.deepEqual(projected.member.blockoutDates, [
    { startDate: "2099-11-01", endDate: "2099-11-02", notes: "Away" },
  ]);
  assert.equal(projected.occurrences[0].serving[0].response, "accepted");
  assert.equal(projected.occurrences[0].serving[1].name, "Casey R.");
  assert.deepEqual(projected.occurrences[0].serving[1], { name: "Casey R.", isMe: false });
  assert.deepEqual(projected.occurrences[0].plan.sections[0].elements[0], {
    type: "song", title: "Welcome", startTime: "10:00", durationSeconds: 240,
  });
});
