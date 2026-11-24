import "dotenv/config";
import { runSchedulingAutomationProcessor } from "../authService.js";

const namedArguments = new Set(["--church", "--team", "--period", "--cycle", "--limit"]);
const modeFlags = new Set(["--dry-run", "--execute", "--live"]);
const values = new Map();
const modes = [];

for (const argument of process.argv.slice(2)) {
  if (modeFlags.has(argument)) {
    modes.push(argument.slice(2));
    continue;
  }
  const separator = argument.indexOf("=");
  const name = separator < 0 ? argument : argument.slice(0, separator);
  const value = separator < 0 ? "" : argument.slice(separator + 1).trim();
  if (!namedArguments.has(name)) {
    console.error(`Unknown argument: ${name}`);
    process.exit(2);
  }
  if (values.has(name)) {
    console.error(`Argument ${name} may be supplied only once.`);
    process.exit(2);
  }
  if (!value) {
    console.error(`Argument ${name} requires a non-empty value in --name=value form.`);
    process.exit(2);
  }
  values.set(name, value);
}

if (modes.length > 1) {
  console.error("Choose exactly one execution mode. The default is --dry-run.");
  process.exit(2);
}
const mode = modes[0] || "dry-run";
const churchId = values.get("--church") || "";
const teamId = values.get("--team") || "";
const periodId = values.get("--period") || "";
const cycleId = values.get("--cycle") || "";
const limitText = values.get("--limit") || "100";
const limit = Number(limitText);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
  console.error("Argument --limit must be a whole number from 1 to 100.");
  process.exit(2);
}
if (teamId && !churchId) {
  console.error("Argument --team requires --church.");
  process.exit(2);
}
if (periodId && (!churchId || !teamId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId))) {
  console.error("Argument --period requires --church, --team, and a valid YYYY-MM value.");
  process.exit(2);
}
if ([churchId, teamId, cycleId].some((value) => value && !/^[A-Za-z0-9_-]{1,128}$/.test(value))) {
  console.error("Church, team, and cycle identifiers must be non-empty plain identifiers.");
  process.exit(2);
}

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  const result = await runSchedulingAutomationProcessor({
    mode,
    churchId,
    teamId,
    periodId,
    cycleId,
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
