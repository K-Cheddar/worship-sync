import "dotenv/config";
import { init } from "@sentry/node";

const isDevelopment = process.env.NODE_ENV === "development";

init({
  dsn: "https://e5db68f5f94b9bd9e5c800fabaa6cf2e@o4509856644333568.ingest.us.sentry.io/4509856735821824",
  enabled: !isDevelopment,
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
  enableLogs: true,
});
