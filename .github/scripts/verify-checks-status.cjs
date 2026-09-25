const requiredJobs = ["client_tests", "coverage", "server_tests", "lint_typecheck"];
let checks;

try {
  checks = JSON.parse(process.env.CHECK_RESULTS || "{}");
} catch (error) {
  console.error(`Could not read required check results: ${error.message}`);
  process.exit(1);
}

const failures = requiredJobs.filter((job) => checks[job]?.result !== "success");

if (failures.length > 0) {
  for (const job of failures) {
    console.error(`${job}: ${checks[job]?.result || "missing result"}`);
  }
  process.exit(1);
}

console.log("All required checks succeeded.");
