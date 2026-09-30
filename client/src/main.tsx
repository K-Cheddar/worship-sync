import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";
import reportWebVitals from "./reportWebVitals";
import * as Sentry from "@sentry/react";
import { initConsoleLogForwarder } from "./utils/consoleLogForwarder";
import { isPublicSharePathname } from "./utils/publicSharePathRedirect";
import BootstrapRecoveryScreen from "./components/BootstrapRecoveryScreen";
import {
  loadSelectedBootstrapModule,
  normalizeBootstrapPathname,
} from "./utils/bootstrapRecovery";

initConsoleLogForwarder();

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: "https://91c81677b775b6e269ae52b678fb0e53@o4509856644333568.ingest.us.sentry.io/4509860218863616",
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Tracing
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
    // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
    tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
    // Session Replay
    replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
    replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
    // Enable logs to be sent to Sentry
    enableLogs: true,
  });
}

// if (import.meta.env.DEV) {
//   import("eruda").then(({ default: eruda }) => eruda.init());
// }

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

const renderBootstrapRecovery = () =>
  root.render(
    <BootstrapRecoveryScreen onReload={() => window.location.reload()} />,
  );

const BootstrapLoadingScreen = () => (
  <div
    className="flex min-h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-300"
    aria-busy="true"
  >
    Loading…
  </div>
);

type ServiceWorkerDiagnostic = {
  available: boolean;
  active: string | null;
  waiting: string | null;
  installing: string | null;
};

const getServiceWorkerDiagnostic = async (): Promise<ServiceWorkerDiagnostic> => {
  try {
    if (!("serviceWorker" in navigator)) {
      return { available: false, active: null, waiting: null, installing: null };
    }

    const registration = await Promise.race([
      navigator.serviceWorker.getRegistration(),
      new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 250)),
    ]);
    return {
      available: true,
      active: registration?.active?.state ?? null,
      waiting: registration?.waiting?.state ?? null,
      installing: registration?.installing?.state ?? null,
    };
  } catch {
    return { available: "serviceWorker" in navigator, active: null, waiting: null, installing: null };
  }
};

const captureBootstrapFailure = async (
  stage: "first failure" | "retry failure" | "post-reload failure",
  error: unknown,
  isPublic: boolean,
) => {
  const serviceWorker = await getServiceWorkerDiagnostic();
  const reloadAttempted = (() => {
    try {
      return window.sessionStorage.getItem("worshipsync:bootstrap-chunk-reload") === "1";
    } catch {
      return null;
    }
  })();

  Sentry.withScope((scope) => {
    scope.setTag("failure_type", "bootstrap_import_failure");
    scope.setContext("bootstrap_recovery", {
      pathname: normalizeBootstrapPathname(window.location.pathname),
      bootstrap: isPublic ? "public" : "operator",
      stage,
      online: navigator.onLine,
      user_agent: navigator.userAgent,
      service_worker_controller: Boolean(navigator.serviceWorker?.controller),
      service_worker_registration: serviceWorker,
      reload_attempted: reloadAttempted,
    });
    Sentry.captureException(error);
  });
};

const boot = async () => {
  // Dynamic import so public path URLs do not download the operator HashRouter graph.
  const isPublic = isPublicSharePathname(window.location.pathname);
  const result = await loadSelectedBootstrapModule(
    isPublic,
    {
      public: () => import("./public/PublicApp"),
      operator: () => import("./App"),
    },
    {
      onFailure: (stage, error) => captureBootstrapFailure(stage, error, isPublic),
    },
  );

  if (result.status === "failed") {
    renderBootstrapRecovery();
    return;
  }

  const Root = result.module.default;

  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );

  // Register the worker without taking over an active operator session. A
  // downloaded update waits for the in-app safe-refresh flow.
  serviceWorkerRegistration.register();

  // If you want to start measuring performance in your app, pass a function
  // to log results (for example: reportWebVitals(console.log))
  // or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
  reportWebVitals();
};

root.render(<BootstrapLoadingScreen />);
void boot().catch((error: unknown) => {
  try {
    Sentry.captureException(error);
  } catch {
    // Reporting must not block the bootstrap recovery screen.
  }
  renderBootstrapRecovery();
});
