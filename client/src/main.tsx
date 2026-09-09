import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";
import reportWebVitals from "./reportWebVitals";
import * as Sentry from "@sentry/react";
import { initConsoleLogForwarder } from "./utils/consoleLogForwarder";
import { isPublicSharePathname } from "./utils/publicSharePathRedirect";

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

const boot = async () => {
  // Dynamic import so public path URLs do not download the operator HashRouter graph.
  const Root = isPublicSharePathname(window.location.pathname)
    ? (await import("./public/PublicApp")).default
    : (await import("./App")).default;

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

void boot();
