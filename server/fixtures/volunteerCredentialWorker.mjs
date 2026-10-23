// Synthetic emulator worker only; communicates secrets over private IPC, never logs.
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerPersonalAccess } from "../volunteerPersonalAccess.js";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) process.exit(2);
process.once("message", async ({ identity, now, options, ...config }) => {
  const app = initializeApp({ projectId: "demo-worshipsync" }); const db = getFirestore(app);
  try {
    const store = createVolunteerPersonalAccess({ ...config, db, now: () => now });
    process.send(await store.prepare(identity, options));
  } catch { process.send({ error: "Synthetic credential operation failed" }); }
  finally { await db.terminate(); await deleteApp(app); process.disconnect(); }
});
process.send({ ready: true });
