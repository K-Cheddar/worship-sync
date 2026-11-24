import {
  isStartupDiagnosticsBuildEnabled,
  resolveStartupDatabasePlan,
  resolveStartupReplicationOptions,
  shouldShowStartupDiagnosticsPanel,
  STARTUP_DIAGNOSTIC_MODES,
  type StartupDiagnosticMode,
} from "./startupDiagnostics";

describe("startup diagnostics build gate", () => {
  it.each([
    ["production", "true", false],
    ["development", "true", false],
    ["staging", undefined, false],
    ["staging", "false", false],
    ["staging", "true", true],
  ])("enables only an explicitly flagged staging build (%s, %s)", (mode, flag, enabled) => {
    expect(isStartupDiagnosticsBuildEnabled(mode, flag)).toBe(enabled);
  });
});

describe("startup diagnostic isolation modes", () => {
  it("holds app routes while leaving workstation pairing and sign-in available", () => {
    expect(shouldShowStartupDiagnosticsPanel(true, "/workstation/pair")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel(true, "/login")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel(true, "/login/desktop-sso-complete")).toBe(false);
    expect(shouldShowStartupDiagnosticsPanel(true, "/workstation/operator")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel(true, "/controller")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel(true, "/projector")).toBe(true);
    expect(shouldShowStartupDiagnosticsPanel(false, "/controller")).toBe(false);
  });

  it("keeps the diagnostic mode list to the documented experiments", () => {
    expect(STARTUP_DIAGNOSTIC_MODES).toEqual([
      "off",
      "normal",
      "skip-databases",
      "content-only",
      "bible-only",
      "reduced-batches",
      "sequential",
    ]);
  });

  it.each<[
    StartupDiagnosticMode,
    { content: boolean; bible: boolean; reducedBatches: boolean; sequential: boolean },
  ]>([
    ["off", { content: true, bible: true, reducedBatches: false, sequential: false }],
    ["normal", { content: true, bible: true, reducedBatches: false, sequential: false }],
    ["skip-databases", { content: false, bible: false, reducedBatches: false, sequential: false }],
    ["content-only", { content: true, bible: false, reducedBatches: false, sequential: false }],
    ["bible-only", { content: false, bible: true, reducedBatches: false, sequential: false }],
    ["reduced-batches", { content: true, bible: true, reducedBatches: true, sequential: false }],
    ["sequential", { content: true, bible: true, reducedBatches: false, sequential: true }],
  ])("uses the intended database policy for %s", (mode, expected) => {
    expect(resolveStartupDatabasePlan(mode)).toEqual(expected);
  });

  it("bounds both startup pulls while keeping a smaller comparison mode", () => {
    expect(resolveStartupReplicationOptions("normal")).toEqual({
      batch_size: 100,
      batches_limit: 2,
    });
    expect(resolveStartupReplicationOptions("reduced-batches")).toEqual({
      batch_size: 25,
      batches_limit: 2,
    });
  });
});
