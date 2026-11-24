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
  "bible-only": "Bible database only",
  "reduced-batches": "Both databases, reduced batches",
  sequential: "Content, then Bible",
};

const StartupDiagnosticsPanel = () => {
  const activeMode = getStartupDiagnosticMode();
  const [selectedMode, setSelectedMode] = useState(activeMode);

  const applyMode = () => {
    setStartupDiagnosticMode(selectedMode);
  };

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
          Controller and display screens are locked in all open staging tabs during this test. Workstation pairing and sign-in remain available.
          Startup events appear in Chrome DevTools with the label <code>[WorshipSync startup]</code>.
        </p>
        <p className="mt-3 text-sm text-gray-300">
          Diagnostic modes are for staging investigation. Pair a workstation after selecting a mode to measure authenticated startup.
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
        <Button className="mt-4 w-full justify-center" onClick={applyMode}>
          {selectedMode === "off" ? "Turn off diagnostics and reload" : "Apply mode and reload"}
        </Button>
        <Link className="mt-4 inline-flex text-sm font-medium text-cyan-200 underline" to="/workstation/pair">
          Pair a workstation
        </Link>
      </section>
    </AuthScreenMain>
  );
};

export default StartupDiagnosticsPanel;
