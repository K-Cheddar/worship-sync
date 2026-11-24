import {
  getSettledHeapUsageMb,
  getStartupDiagnosticMode,
  resolveStartupDatabasePlan,
  resolveStartupReplicationOptions,
  shouldShowStartupDiagnosticsPanel,
  STARTUP_DIAGNOSTIC_MODES,
  type StartupDiagnosticMode,
} from "./startupDiagnostics";

describe("startup diagnostic isolation modes", () => {
  it("defaults to diagnostics-enabled normal mode when no mode was selected", () => {
    expect(getStartupDiagnosticMode()).toBe("normal");
  });

  it("locks only database-isolation routes and keeps pairing and operator setup available", () => {
    expect(shouldShowStartupDiagnosticsPanel("skip-databases", "/workstation/pair")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("content-only", "/login")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("bible-only", "/login/desktop-sso-complete")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("skip-databases", "/workstation/operator")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("content-only", "/home")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel("bible-only", "/controller")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel("skip-databases", "/projector")).toBe(true);
  });

  it.each(["normal", "off", "bounded-batches", "reduced-batches", "sequential"] as const)(
    "keeps regular application routes available in %s mode",
    (mode) => {
      expect(shouldShowStartupDiagnosticsPanel(mode, "/home")).toBe(false);
      expect(shouldShowStartupDiagnosticsPanel(mode, "/controller")).toBe(false);
    },
  );

  it("keeps regular application routes available after off disables diagnostic logging", () => {
    expect(shouldShowStartupDiagnosticsPanel("off", "/controller")).toBe(false);
  });

  it("keeps the diagnostic mode list to the documented experiments", () => {
    expect(STARTUP_DIAGNOSTIC_MODES).toEqual([
      "off",
      "normal",
      "skip-databases",
      "content-only",
      "bible-only",
      "bounded-batches",
      "reduced-batches",
      "sequential",
    ]);
  });

  it.each<[
    StartupDiagnosticMode,
    { content: boolean; bible: boolean; sequential: boolean },
  ]>([
    ["off", { content: true, bible: true, sequential: false }],
    ["normal", { content: true, bible: true, sequential: false }],
    ["skip-databases", { content: false, bible: false, sequential: false }],
    ["content-only", { content: true, bible: false, sequential: false }],
    ["bible-only", { content: false, bible: true, sequential: false }],
    ["bounded-batches", { content: true, bible: true, sequential: false }],
    ["reduced-batches", { content: true, bible: true, sequential: false }],
    ["sequential", { content: true, bible: true, sequential: true }],
  ])("uses the intended database policy for %s", (mode, expected) => {
    expect(resolveStartupDatabasePlan(mode)).toEqual(expected);
  });

  it("uses the original per-database baseline and preserves it when diagnostics are off", () => {
    expect(resolveStartupReplicationOptions("normal", "content")).toEqual({
      batch_size: 150,
      batches_limit: 15,
    });
    expect(resolveStartupReplicationOptions("normal", "bible")).toEqual({
      batch_size: 1000,
      batches_limit: 25,
    });
    expect(resolveStartupReplicationOptions("off", "content")).toEqual({
      batch_size: 150,
      batches_limit: 15,
    });
    expect(resolveStartupReplicationOptions("off", "bible")).toEqual({
      batch_size: 1000,
      batches_limit: 25,
    });
  });

  it.each([
    ["bounded-batches", 100, 2],
    ["reduced-batches", 25, 2],
  ] as const)("uses %s settings for both databases", (mode, batchSize, batchesLimit) => {
    expect(resolveStartupReplicationOptions(mode, "content")).toEqual({
      batch_size: batchSize,
      batches_limit: batchesLimit,
    });
    expect(resolveStartupReplicationOptions(mode, "bible")).toEqual({
      batch_size: batchSize,
      batches_limit: batchesLimit,
    });
  });

  it("reports a settled heap estimate only after five recent samples", () => {
    expect(getSettledHeapUsageMb([1, 2, 3, 4])).toBeNull();
    expect(getSettledHeapUsageMb([10, 7, 9, 4, 8, 6])).toBe(7);
  });
});
