import "dotenv/config";
import { runSchedulingAutomationProcessor } from "../authService.js";

const args = process.argv.slice(2);
const getArg = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const flags = new Set(args);
const modes = [flags.has("--execute") ? "execute" : "", flags.has("--live") ? "live" : ""].filter(Boolean);
const allowedArgs = new Set(["--dry-run", "--execute", "--live"]);
const unknown = args.filter((argument) => !allowedArgs.has(argument) &&
  !["--church", "--team", "--period", "--cycle", "--limit"].some((name) => argument.startsWith(`${name}=`)));
if (unknown.length) {
  console.error(`Unknown argument: ${unknown[0]}`);
  process.exit(2);
}
if (modes.length > 1 || (flags.has("--dry-run") && modes.length > 0)) {
  console.error("Choose only one of --execute or --live. The default is --dry-run.");
  process.exit(2);
}
const mode = modes[0] || "dry-run";
const configuredLimit = Number.parseInt(getArg("--limit") || "100", 10);
const limit = Number.isFinite(configuredLimit) ? Math.min(Math.max(configuredLimit, 1), 100) : 100;
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  const result = await runSchedulingAutomationProcessor({
    mode,
    churchId: getArg("--church"),
    teamId: getArg("--team"),
    periodId: getArg("--period"),
    cycleId: getArg("--cycle"),
    limit,
    signal: controller.signal,
    logger: { info() {}, error() {} },
  });
  console.log(JSON.stringify(result, null, 2));
  if (controller.signal.aborted) process.exitCode = 130;
} catch (error) {
  console.error(JSON.stringify({
    event: "scheduling_processor.failed",
    mode,
    error: String(error?.message || error).slice(0, 240),
  }));
  process.exitCode = 1;
}
