import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";
import {
  getServicePlanLiveElementId,
  isServicePlanManualLive,
} from "./servicePlanLive";

const plan: ServicePlan = {
  planId: "church-1::service-1@2026-07-26",
  churchId: "church-1",
  planKey: "service-1@2026-07-26",
  serviceId: "service-1",
  date: "2026-07-26",
  name: "Easter Sunday",
  startsAt: "2026-07-26T14:00:00.000Z",
  timezone: "UTC",
  sections: [
    {
      id: "section-1",
      name: "Worship",
      elements: [
        {
          id: "welcome",
          type: "free",
          title: plainTextToRichText("Welcome"),
          durationMinutes: 5,
        },
        {
          id: "song",
          type: "song",
          title: plainTextToRichText("Song"),
          durationMinutes: 10,
        },
      ],
    },
  ],
};

describe("getServicePlanLiveElementId", () => {
  it("follows the timed schedule by default", () => {
    expect(
      getServicePlanLiveElementId(plan, Date.parse("2026-07-26T14:02:00.000Z")),
    ).toBe("welcome");
    expect(
      getServicePlanLiveElementId(plan, Date.parse("2026-07-26T14:07:00.000Z")),
    ).toBe("song");
  });

  it("lets a manual pin override the schedule for every shared view", () => {
    expect(
      getServicePlanLiveElementId(
        {
          ...plan,
          publicLive: { mode: "manual", currentElementId: "song" },
        },
        Date.parse("2026-07-26T14:02:00.000Z"),
      ),
    ).toBe("song");
  });
});

describe("isServicePlanManualLive", () => {
  it("is true only for a manual pin", () => {
    expect(isServicePlanManualLive({ publicLive: { mode: "schedule" } })).toBe(
      false,
    );
    expect(
      isServicePlanManualLive({
        publicLive: { mode: "manual", currentElementId: "welcome" },
      }),
    ).toBe(true);
  });
});
