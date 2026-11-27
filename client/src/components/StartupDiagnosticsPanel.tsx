import { useState } from "react";
import { Link } from "react-router-dom";
import AuthScreenMain from "./AuthScreenMain";
import Button from "./Button/Button";
import {
  getStartupDiagnosticMode,
  setStartupDiagnosticMode,
  STARTUP_DIAGNOSTIC_MODES,
  type StartupDiagnosticMode,
} from "../utils/startupDiagnostics";

const modeLabels: Record<StartupDiagnosticMode, string> = {
  off: "Off",
  normal: "Normal authenticated startup",
  "skip-databases": "Authenticated startup, databases paused",
  "content-only": "Content database only",
  "replication-only": "Content replication only, no app cache",
  "bible-only": "Bible database only",
  sequential: "Content, then Bible",
};

const StartupDiagnosticsPanel = () => {
  const activeMode = getStartupDiagnosticMode();
  const [selectedMode, setSelectedMode] = useState(activeMode);

  return (
    <AuthScreenMain>
      <section
        aria-labelledby="startup-diagnostics-title"
        className="w-full max-w-xl rounded-2xl border border-gray-500 bg-gray-800 p-6"
      >
        <h1 id="startup-diagnostics-title" className="text-2xl font-semibold">
          Startup diagnostics
        </h1>
        <p className="mt-2 text-sm text-gray-200">
          Mode: <span className="font-medium text-cyan-200">{modeLabels[activeMode]}</span>
        </p>
        <p className="mt-3 text-sm text-gray-300">
          Application routes that need both databases are locked for this isolation test. Workstation pairing, sign-in, and operator selection remain available.
          Startup events appear in Chrome DevTools with the label <code>[WorshipSync startup]</code>.
        </p>
        {selectedMode === "replication-only" ? (
          <p className="mt-3 text-sm text-gray-300">
            This mode pulls content with the normal 150 by 15 settings, without the item-cache subscriber, Bible database, or app managers. Authentication and database permissions stay active.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-gray-300">
          Select a mode in Chrome DevTools to reload into another experiment. Normal and sequential modes open the regular application.
        </p>
        <label className="mt-5 block text-sm font-medium" htmlFor="startup-diagnostic-mode">
          Test mode
        </label>
        <select
          id="startup-diagnostic-mode"
          className="mt-2 w-full rounded-md border border-gray-500 bg-gray-900 px-3 py-2 text-white"
          value={selectedMode}
          onChange={(event) => setSelectedMode(event.target.value as StartupDiagnosticMode)}
        >
          {STARTUP_DIAGNOSTIC_MODES.map((mode) => (
            <option key={mode} value={mode}>{modeLabels[mode]}</option>
          ))}
        </select>
        <Button className="mt-4 w-full justify-center" onClick={() => setStartupDiagnosticMode(selectedMode)}>
          {selectedMode === "off" ? "Turn off diagnostics and reload" : "Apply mode and reload"}
        </Button>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <Link className="inline-flex text-sm font-medium text-cyan-200 underline" to="/login">
            Sign in
          </Link>
          <Link className="inline-flex text-sm font-medium text-cyan-200 underline" to="/workstation/pair">
            Pair a workstation
          </Link>
        </div>
      </section>
    </AuthScreenMain>
  );
};

export default StartupDiagnosticsPanel;
