import test from "node:test";
import assert from "node:assert/strict";
import {
  getChurchIntegrationsPath,
  normalizeChurchIntegrationsForStorage,
} from "./churchIntegrations.js";

test("getChurchIntegrationsPath matches churches data segment", () => {
  assert.equal(
    getChurchIntegrationsPath("church-42"),
    "churches/church-42/data/integrations",
  );
});

test("normalizeChurchIntegrationsForStorage applies defaults", () => {
  const out = normalizeChurchIntegrationsForStorage({});
  assert.equal(out.version, 1);
  assert.equal(out.servicePlanning.enabled, false);
  assert.ok(Array.isArray(out.servicePlanning.elementRules));
  assert.ok(Array.isArray(out.servicePlanning.people));
  assert.equal(out.catalog.servicePlanning.status, "available");
  assert.equal(out.catalog.songSelect.status, "coming_soon");
});

test("normalizeChurchIntegrationsForStorage normalizes a full service planning config", () => {
  const out = normalizeChurchIntegrationsForStorage({
    servicePlanning: {
      enabled: true,
      elementRules: [
        {
          id: "r1",
          matchElementType: "Welcome",
          matchMode: "contains",
          displayName: "Welcome and Announcements",
          nameSources: ["title", "ledBy"],
          multiOverlay: { mode: "single" },
        },
      ],
      people: [
        {
          id: "p1",
          names: ["Greg Baldeo"],
          displayName: "Dr. Greg Baldeo",
          title: "Lead Pastor",
        },
      ],
    },
  });
  assert.equal(out.servicePlanning.enabled, true);
  assert.equal(out.servicePlanning.elementRules.length, 1);
  assert.equal(out.servicePlanning.elementRules[0].matchElementType, "Welcome");
  assert.equal(out.servicePlanning.people[0].displayName, "Dr. Greg Baldeo");
});

test("normalizeChurchIntegrationsForStorage defaults missing nameSources to ledBy only", () => {
  const out = normalizeChurchIntegrationsForStorage({
    servicePlanning: {
      enabled: true,
      elementRules: [
        {
          id: "r1",
          matchElementType: "Welcome",
          matchMode: "contains",
          displayName: "Welcome",
          multiOverlay: { mode: "single" },
        },
      ],
      people: [],
    },
  });
  assert.deepEqual(out.servicePlanning.elementRules[0].nameSources, ["ledBy"]);
});

test("normalizeChurchIntegrationsForStorage allows empty rule display name when match text is set", () => {
  const out = normalizeChurchIntegrationsForStorage({
    servicePlanning: {
      enabled: true,
      elementRules: [
        {
          id: "r1",
          matchElementType: "Welcome",
          matchMode: "contains",
          displayName: "",
          nameSources: ["title"],
          multiOverlay: { mode: "single" },
        },
      ],
      people: [],
    },
  });
  assert.equal(out.servicePlanning.elementRules[0].displayName, "");
  assert.equal(out.servicePlanning.elementRules[0].matchElementType, "Welcome");
});

test("normalizeChurchIntegrationsForStorage defaults overlaySyncEnabled to true", () => {
  const out = normalizeChurchIntegrationsForStorage({
    servicePlanning: {
      enabled: true,
      elementRules: [
        {
          id: "r1",
          matchElementType: "Welcome",
          matchMode: "contains",
          displayName: "Welcome",
          nameSources: ["title"],
          multiOverlay: { mode: "single" },
        },
      ],
      people: [],
    },
  });
  assert.equal(out.servicePlanning.elementRules[0].overlaySyncEnabled, true);
});

test("normalizeChurchIntegrationsForStorage preserves overlaySyncEnabled=false", () => {
  const out = normalizeChurchIntegrationsForStorage({
    servicePlanning: {
      enabled: true,
      elementRules: [
        {
          id: "r1",
          matchElementType: "Song of Praise",
          matchMode: "contains",
          overlaySyncEnabled: false,
          displayName: "",
          nameSources: ["title"],
          multiOverlay: { mode: "single" },
        },
      ],
      people: [],
    },
  });
  assert.equal(out.servicePlanning.elementRules[0].overlaySyncEnabled, false);
});
