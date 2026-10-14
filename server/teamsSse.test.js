import assert from "node:assert/strict";
import test from "node:test";
import { addTeamsSseClient, emitTeamsEvent, removeTeamsSseClient } from "./teamsSse.js";

const clientFor = () => {
  const writes = [];
  return {
    writes,
    write(value) { writes.push(String(value)); },
  };
};

test("Teams SSE carries Services change identifiers without resource documents", () => {
  const churchId = "sse-services-projection-test";
  const client = clientFor();
  addTeamsSseClient(churchId, client);
  try {
    emitTeamsEvent(churchId, "service-plan-updated", {
      planKey: "sunday@2026-10-11",
      saveOperationId: "operation-1",
      servicePlan: { name: "Private plan", sections: [{ name: "Private content" }] },
    });
    emitTeamsEvent(churchId, "service-plan-template-updated", {
      templateId: "template-1",
      template: { name: "Private template", sections: [{ name: "Private content" }] },
    });

    const events = client.writes.map((line) =>
      JSON.parse(line.slice("data: ".length).trim()),
    );
    assert.deepEqual(events.map(({ type, planKey, templateId, saveOperationId }) => ({
      type, planKey, templateId, saveOperationId,
    })), [
      {
        type: "service-plan-updated",
        planKey: "sunday@2026-10-11",
        templateId: undefined,
        saveOperationId: "operation-1",
      },
      {
        type: "service-plan-template-updated",
        planKey: undefined,
        templateId: "template-1",
        saveOperationId: undefined,
      },
    ]);
    assert.equal(JSON.stringify(events).includes("Private plan"), false);
    assert.equal(JSON.stringify(events).includes("Private template"), false);
  } finally {
    removeTeamsSseClient(churchId, client);
  }
});
