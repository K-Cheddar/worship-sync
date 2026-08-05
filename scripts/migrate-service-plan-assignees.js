import fs from "node:fs/promises";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : "";
};

const hasFlag = (flag) => args.includes(flag);

const printUsage = () => {
  console.log(`
Convert service plans and templates to multi-assignee microphones.

Each element's single assignee (assignedName / assignedMemberId) and its
element-level microphoneAssignments become one \`assignees\` list. Microphones
that had no person attached land on an unassigned slot, which is exactly what
they were: a stand or spare mic.

Usage:
  node scripts/migrate-service-plan-assignees.js [--dry-run] [--church=<id>]

Options:
  --dry-run           Report what would change without writing anything.
  --church=<id>       Only migrate one church's documents.
  --batch=<number>    Documents per write batch. Default: 200 (max 400).
  --report=<path>     JSON report output path.
  --help              Show this help text.

Run --dry-run first and read the report. Writes are idempotent: an element that
already has \`assignees\` is left untouched, so a re-run is safe.
`);
};

if (hasFlag("--help")) {
  printUsage();
  process.exit(0);
}

const dryRun = hasFlag("--dry-run");
const churchFilter = getArgValue("--church").trim();
const batchSize = Math.min(
  Math.max(Number.parseInt(getArgValue("--batch") || "200", 10) || 200, 1),
  400,
);
const reportPath = path.resolve(
  getArgValue("--report") || "service-plan-assignees-migration-report.json",
);

const normalizeFirebasePrivateKey = (raw) =>
  String(raw || "").replace(/\\n/g, "\n").trim();

const firestore = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizeFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "Missing Firebase admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
    );
    process.exit(1);
  }
  const app =
    getApps()[0] || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return db;
};

let idCounter = 0;
const createAssigneeId = () => {
  idCounter += 1;
  return `servicePlanAssignee_migrated_${Date.now().toString(36)}_${idCounter}`;
};

const text = (value) => String(value ?? "").trim();

/**
 * The single conversion rule, applied to one element.
 *
 * Returns null when the element already carries `assignees` or has nothing to
 * convert, so the caller can skip untouched documents and keep the run
 * idempotent.
 */
export const migrateServicePlanElement = (element) => {
  if (!element || typeof element !== "object") return null;
  if (Array.isArray(element.assignees)) return null;

  const name = text(element.assignedName);
  const memberId = text(element.assignedMemberId);
  const microphoneIds = (
    Array.isArray(element.microphoneAssignments) ? element.microphoneAssignments : []
  )
    .map((assignment) => text(assignment?.microphoneId))
    .filter(Boolean)
    .filter((microphoneId, index, values) => values.indexOf(microphoneId) === index);

  if (!name && !memberId && !microphoneIds.length) return null;

  const assignees = [];
  if (name || memberId) {
    assignees.push({
      id: createAssigneeId(),
      ...(name ? { name } : {}),
      ...(memberId ? { memberId } : {}),
      // The one microphone case is unambiguous: a single mic on an item with a
      // single named person was that person's mic. Anything more stays
      // unassigned rather than guessing who held what.
      ...(microphoneIds.length === 1 ? { microphoneIds } : {}),
    });
  }
  const unassignedMicrophoneIds =
    assignees.length && microphoneIds.length === 1 ? [] : microphoneIds;
  if (unassignedMicrophoneIds.length) {
    assignees.push({
      id: createAssigneeId(),
      microphoneIds: unassignedMicrophoneIds,
    });
  }

  const next = { ...element, assignees };
  delete next.assignedName;
  delete next.assignedMemberId;
  delete next.microphoneAssignments;
  return next;
};

/** Returns the converted sections, or null when nothing in them changed. */
export const migrateServicePlanSections = (sections) => {
  if (!Array.isArray(sections)) return null;
  let changed = false;
  const next = sections.map((section) => {
    const elements = Array.isArray(section?.elements) ? section.elements : [];
    const nextElements = elements.map((element) => {
      const migrated = migrateServicePlanElement(element);
      if (!migrated) return element;
      changed = true;
      return migrated;
    });
    return { ...section, elements: nextElements };
  });
  return changed ? next : null;
};

const migrateCollection = async (db, collectionName, report) => {
  let query = db.collection(collectionName);
  if (churchFilter) query = query.where("churchId", "==", churchFilter);
  const snapshot = await query.get();

  let batch = db.batch();
  let pending = 0;

  for (const doc of snapshot.docs) {
    report.scanned += 1;
    const data = doc.data();
    const sections = migrateServicePlanSections(data?.sections);
    if (!sections) continue;

    report.converted += 1;
    report.documents.push({
      collection: collectionName,
      id: doc.id,
      churchId: data?.churchId || null,
      name: data?.name || null,
    });
    if (dryRun) continue;

    // The revision moves so an editor with the document open sees a conflict
    // and reloads, rather than autosaving the pre-migration shape back over it.
    const revision =
      Number.isSafeInteger(data?.revision) && data.revision >= 0 ? data.revision : 0;
    batch.update(doc.ref, { sections, revision: revision + 1 });
    pending += 1;
    if (pending >= batchSize) {
      await batch.commit();
      report.written += pending;
      batch = db.batch();
      pending = 0;
    }
  }

  if (!dryRun && pending > 0) {
    await batch.commit();
    report.written += pending;
  }
};

const run = async () => {
  const db = firestore();
  const report = {
    startedAt: new Date().toISOString(),
    dryRun,
    churchFilter: churchFilter || null,
    scanned: 0,
    converted: 0,
    written: 0,
    documents: [],
  };

  for (const collectionName of ["servicePlans", "servicePlanTemplates"]) {
    await migrateCollection(db, collectionName, report);
  }

  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `${dryRun ? "[dry run] " : ""}scanned ${report.scanned}, ` +
      `${dryRun ? "would convert" : "converted"} ${report.converted}, ` +
      `wrote ${report.written}.`,
  );
  console.log(`Report: ${reportPath}`);
};

// Importable for tests; only connects to Firestore when run directly.
if (process.argv[1] && process.argv[1].endsWith("migrate-service-plan-assignees.js")) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
