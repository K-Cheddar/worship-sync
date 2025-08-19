import { init } from "@sentry/node";

init({
  dsn: "https://e5db68f5f94b9bd9e5c800fabaa6cf2e@o4509856644333568.ingest.us.sentry.io/4509856735821824", // Replace with your DSN
  tracesSampleRate: 1.0, // Optional: enables performance monitoring
  sendDefaultPii: true, // Captures IP and headers if needed
  enableLogs: true,
});
