import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultCurrentServiceWorkspace,
  getCurrentServiceWorkspacePath,
  normalizeCurrentServiceWorkspaceForStorage,
  normalizeCurrentServiceWorkspacePatch,
} from "./currentServiceWorkspace.js";

test("current service workspace defaults every optional section on", () => {
  assert.deepEqual(createDefaultCurrentServiceWorkspace(), {
    sections: {
      displays: true,
      credits: true,
      team: true,
      chat: true,
    },
  });
  assert.deepEqual(normalizeCurrentServiceWorkspaceForStorage(undefined), {
    sections: {
      displays: true,
      credits: true,
      team: true,
      chat: true,
    },
  });
});

test("normalizes partial snapshots while preserving explicit false values", () => {
  assert.deepEqual(
    normalizeCurrentServiceWorkspaceForStorage({
      sections: { displays: false, team: false },
    }),
    {
      sections: {
        displays: false,
        credits: true,
        team: false,
        chat: true,
      },
    },
  );
});

test("normalizes field-level patches and rejects invalid patches", () => {
  assert.deepEqual(
    normalizeCurrentServiceWorkspacePatch({ sections: { chat: false } }),
    { sections: { chat: false } },
  );
  assert.throws(
    () => normalizeCurrentServiceWorkspacePatch({ sections: { team: "no" } }),
    /must be a boolean/,
  );
  assert.throws(
    () => normalizeCurrentServiceWorkspacePatch({ sections: {} }),
    /At least one workspace setting/,
  );
});

test("returns the shared current service workspace RTDB path", () => {
  assert.equal(
    getCurrentServiceWorkspacePath("church-42"),
    "churches/church-42/data/currentServiceWorkspace",
  );
});
