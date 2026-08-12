import test from "node:test";
import assert from "node:assert/strict";
import {
  getChurchIntegrationsPath,
  normalizeChurchIntegrationsAdminUpdate,
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
  assert.equal(out.restream.enabled, false);
  assert.equal(out.restream.connected, false);
  assert.deepEqual(out.restream.platformSummary, []);
  assert.equal(out.youtube.enabled, false);
  assert.equal(out.youtube.connected, false);
  assert.equal(out.youtube.accountLabel, "");
  assert.equal(out.canva.enabled, false);
  assert.equal(out.canva.connected, false);
  assert.equal(out.canva.accountLabel, "");
});

test("normalizeChurchIntegrationsForStorage normalizes Canva status", () => {
  const out = normalizeChurchIntegrationsForStorage({
    canva: {
      enabled: true,
      connected: true,
      accountLabel: "Church Creative",
      lastError: "",
      lastImportedAt: 123,
    },
  });

  assert.equal(out.canva.enabled, true);
  assert.equal(out.canva.connected, true);
  assert.equal(out.canva.accountLabel, "Church Creative");
  assert.equal(out.canva.lastImportedAt, 123);
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

test("normalizeChurchIntegrationsForStorage normalizes restream status", () => {
  const out = normalizeChurchIntegrationsForStorage({
    restream: {
      enabled: true,
      connected: true,
      accountLabel: "Main Restream",
      lastError: "Temporary issue",
      lastEventAt: 123,
      sessionStartedAt: 100,
      platformSummary: ["YouTube", "Facebook"],
    },
  });

  assert.equal(out.restream.enabled, true);
  assert.equal(out.restream.connected, true);
  assert.equal(out.restream.accountLabel, "Main Restream");
  assert.equal(out.restream.lastError, "Temporary issue");
  assert.equal(out.restream.lastEventAt, 123);
  assert.equal(out.restream.sessionStartedAt, 100);
  assert.deepEqual(out.restream.platformSummary, ["YouTube", "Facebook"]);
});

test("normalizeChurchIntegrationsAdminUpdate omits server-managed connection state", () => {
  const update = normalizeChurchIntegrationsAdminUpdate({
    servicePlanning: {
      enabled: true,
      elementRules: [],
      sectionRules: [],
      people: [],
    },
    restream: {
      enabled: false,
      connected: false,
      accountLabel: "Stale Restream status",
    },
    youtube: {
      enabled: false,
      connected: false,
      accountLabel: "Stale YouTube status",
    },
  });

  assert.equal(update.servicePlanning.enabled, true);
  assert.equal(Object.hasOwn(update, "restream"), false);
  assert.equal(Object.hasOwn(update, "youtube"), false);
});
