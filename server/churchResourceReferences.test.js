import assert from "node:assert/strict";
import test from "node:test";
import {
  findChurchResourceServicePlanReferences,
  servicePlanReferencesChurchResource,
} from "./churchResourceReferences.js";

const resource = (resourceId) => ({
  id: "resource-ref",
  type: "document",
  title: "Church resource",
  data: { resourceId },
});

test("Service Plan reference scanning recognizes document references without reading storage metadata", async () => {
  const matching = {
    id: "plan-1",
    churchId: "church-1",
    sections: [{ elements: [{ resources: [resource("resource-1")] }] }],
  };
  assert.equal(servicePlanReferencesChurchResource(matching, "resource-1"), true);
  assert.equal(servicePlanReferencesChurchResource(matching, "resource-2"), false);

  const queried = [];
  const references = await findChurchResourceServicePlanReferences({
    queryDocs: async (...args) => {
      queried.push(args);
      return [matching, { id: "plan-2", churchId: "church-1", sections: [] }];
    },
    servicePlansCollection: "servicePlans",
    churchId: "church-1",
    resourceId: "resource-1",
  });
  assert.deepEqual(references.map((plan) => plan.id), ["plan-1"]);
  assert.deepEqual(queried[0], [
    "servicePlans",
    [{ field: "churchId", value: "church-1" }],
    { limit: 5000 },
  ]);
});

test("Service Plan reference scanning supports a future root elements shape", () => {
  assert.equal(
    servicePlanReferencesChurchResource(
      { elements: [{ resources: [resource("resource-1")] }] },
      "resource-1",
    ),
    true,
  );
});
