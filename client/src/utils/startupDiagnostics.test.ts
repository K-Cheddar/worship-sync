import {
  getSettledHeapUsageMb,
  getStartupDiagnosticMode,
  resolveStartupDatabasePlan,
  shouldShowStartupDiagnosticsPanel,
  STARTUP_DIAGNOSTIC_MODES,
  type StartupDiagnosticMode,
} from "./startupDiagnostics";

describe("startup diagnostic isolation modes", () => {
  it("defaults to diagnostics off when no mode was selected", () => {
    expect(getStartupDiagnosticMode()).toBe("off");
  });

  it("locks only database-isolation routes and keeps pairing and operator setup available", () => {
    expect(shouldShowStartupDiagnosticsPanel("skip-databases", "/workstation/pair")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("content-only", "/login")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("bible-only", "/login/desktop-sso-complete")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("skip-databases", "/workstation/operator")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel("content-only", "/home")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel("replication-only", "/home")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel("bible-only", "/controller")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel("skip-databases", "/projector")).toBe(true);
  });

  it.each(["normal", "off", "sequential"] as const)(
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
      "replication-only",
      "bible-only",
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
    ["replication-only", { content: true, bible: false, sequential: false }],
    ["bible-only", { content: false, bible: true, sequential: false }],
    ["sequential", { content: true, bible: true, sequential: true }],
  ])("uses the intended database policy for %s", (mode, expected) => {
    expect(resolveStartupDatabasePlan(mode)).toEqual(expected);
  });

  it("reports a settled heap estimate only after five recent samples", () => {
    expect(getSettledHeapUsageMb([1, 2, 3, 4])).toBeNull();
    expect(getSettledHeapUsageMb([10, 7, 9, 4, 8, 6])).toBe(7);
  });

  it("exposes replication diagnostics through the existing startup snapshot", () => {
    const snapshot = window.__worshipSyncStartupDiagnostics?.snapshot();

    expect(snapshot).toHaveProperty("expensiveReplicationBatches");
    expect(snapshot).toHaveProperty("boundedRevisionWriteStatistics");
    expect(snapshot).toHaveProperty("recoveredInterruptedReplicationBatches");
  });
});
