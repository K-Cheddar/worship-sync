import { buildServicePlanFlowSnapshot } from "../pages/buildServicePlanFlowSnapshot";
import { plainTextToRichText } from "../types/richText";
import type { ServicePlan } from "../types/servicePlan";
import {
  buildServiceFlowRoleOptions,
  visibleServiceFlowMicrophoneAssignmentsForItem,
} from "./serviceFlowAudience";

const legacyPlan: ServicePlan = {
  planId: "legacy-plan",
  churchId: "church-1",
  planKey: "legacy@2026-09-25",
  serviceId: "service-1",
  date: "2026-09-25",
  startsAt: "2026-09-25T22:00:00.000Z",
  name: "Legacy plan",
  sections: [{
    id: "section-1",
    name: "Worship",
    elements: [{
      id: "item-1",
      type: "free",
      title: plainTextToRichText("Welcome"),
      teamNotes: [{
        id: "legacy-role-note",
        scope: "role",
        label: "Legacy Team · Legacy Operator",
        teamId: "legacy-team",
        teamName: "Legacy Team",
        positionId: "legacy-operator",
        note: plainTextToRichText("Legacy cue"),
      }],
    }],
  }],
};

describe("service flow audience helpers", () => {
  it("supplements a missing roster with roles discovered from legacy notes and microphones", () => {
    const snapshot = buildServicePlanFlowSnapshot({
      plan: legacyPlan,
      startsAt: legacyPlan.startsAt!,
    });
    snapshot.roles = [];
    snapshot.service.sections[0].items[0].microphoneAssignments = [{
      microphone: { id: "mic-legacy", name: "Legacy mic", type: "Headset", color: "#22d3ee" },
      audiences: [{
        positionId: "legacy-mic-operator",
        roleName: "Legacy Mic Operator",
        teamId: "legacy-team",
        teamName: "Legacy Team",
      }],
    }];

    expect(buildServiceFlowRoleOptions(snapshot).map((role) => role.positionId))
      .toEqual(["legacy-mic-operator", "legacy-operator"]);
  });

  it("does not let an unscoped legacy microphone defeat a selected audience", () => {
    const snapshot = buildServicePlanFlowSnapshot({
      plan: legacyPlan,
      startsAt: legacyPlan.startsAt!,
    });
    const item = snapshot.service.sections[0].items[0];
    item.microphoneAssignments = [{
      microphone: { id: "mic-legacy", name: "Legacy mic", type: "Headset", color: "#22d3ee" },
      audiences: [],
    }];

    expect(visibleServiceFlowMicrophoneAssignmentsForItem(item, "", [])).toHaveLength(1);
    expect(visibleServiceFlowMicrophoneAssignmentsForItem(item, "Presentation", ["operator"]))
      .toHaveLength(0);
  });
});
