import "dotenv/config";
import { getFirebaseAdminRuntime } from "../server/firebaseAdminRuntime.js";
import { createVolunteerContactIndex } from "../server/volunteerContactIndex.js";

const churchId = process.argv.find((arg) => arg.startsWith("--church="))?.slice("--church=".length);
const secret = process.env.AUTH_VOLUNTEER_PORTAL_SECRET;
const db = getFirebaseAdminRuntime()?.db;
if (!churchId || !secret || !db) {
  console.error("Requires --church=<churchId>, AUTH_VOLUNTEER_PORTAL_SECRET and configured Firestore.");
  process.exitCode = 1;
} else {
  try {
    const index = createVolunteerContactIndex({ db, memberCollection: "teamRosterMembers", secret });
    const result = process.argv.includes("--audit-only")
      ? await index.auditChurch(churchId) : await index.backfillChurch(churchId);
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode = 1;
  } catch (error) {
    console.error("Contact index migration did not complete:", error.message);
    process.exitCode = 1;
  } finally { await db.terminate(); }
}
