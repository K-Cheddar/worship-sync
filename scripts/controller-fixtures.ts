import "dotenv/config";
import axios from "axios";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { FIXTURE_OWNER, planFixtureCleanup, type FixtureDoc, type FixtureManifest } from "../e2e/controllerFixtureCleanup";

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const database = args.includes("--database") ? value("--database") : "";
if (!/^worship-sync-[a-z0-9-]+$/.test(database)) throw new Error("Supply an exact --database worship-sync-<tenant> (never inferred from a title)");
const client = axios.create({
  baseURL: `https://${process.env.COUCHDB_HOST}/${encodeURIComponent(database)}/`,
  auth: { username: process.env.COUCHDB_USER!, password: process.env.COUCHDB_PASSWORD! },
  timeout: 30_000,
});
const find = async (selector: object): Promise<FixtureDoc[]> => {
  const { data } = await client.post("_find", { selector, limit: 1000 });
  if (data.docs.length === 1000) throw new Error("Inventory reached its limit; narrow the query before cleanup");
  return data.docs;
};
const get = async (id: string) => (await client.get(encodeURIComponent(id))).data;
const put = async (doc: FixtureDoc) => client.put(encodeURIComponent(doc._id), doc);
const referencesFor = (ids: string[]) => find({ $or: [
  { items: { $elemMatch: { _id: { $in: ids } } } },
  { itemLists: { $elemMatch: { _id: { $in: ids } } } },
  { "activeList._id": { $in: ids } },
  { resources: { $elemMatch: { songId: { $in: ids } } } },
] });
async function inventory() {
  const fixtures = await find({ $or: [
    { name: { $regex: "^E2E Presentation Controller" } },
    { "e2eFixture.owner": FIXTURE_OWNER },
  ] });
  const [registry, library] = await Promise.all([get("ItemLists"), get("allItems")]);
  const matches = (entries: FixtureDoc[]) => entries.filter(entry => entry.name?.startsWith("E2E Presentation Controller") || fixtures.some(doc => doc._id === entry._id));
  const registryMatches = matches(registry.itemLists ?? []);
  const libraryMatches = matches(library.items ?? []);
  const ids = [...new Set([...fixtures, ...registryMatches, ...libraryMatches].map(doc => doc._id))];
  return { database, fixtures, registryMatches, libraryMatches, references: ids.length ? await referencesFor(ids) : [] };
}

let affectedIds: string[] = [];
try {
  const before = await inventory();
  const output = resolve(args.includes("--output") ? value("--output") : `playwright/.fixtures/inventory-${Date.now()}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(before, null, 2));
  console.log(`Inventory saved: ${output}`);
  console.log(JSON.stringify({ fixtures: before.fixtures.map(doc => ({ id: doc._id, rev: doc._rev, name: doc.name, ownership: doc.e2eFixture ?? "ambiguous legacy record" })), registryMatches: before.registryMatches, libraryMatches: before.libraryMatches, references: before.references.map(doc => doc._id) }, null, 2));
  if (args.includes("--cleanup")) {
    if (!args.includes("--manifest")) throw new Error("Cleanup requires an exact --manifest path");
    const manifest: FixtureManifest = JSON.parse(await readFile(value("--manifest"), "utf8"));
    affectedIds = Array.isArray(manifest.ids) ? manifest.ids.filter(id => typeof id === "string") : [];
    if (manifest.database !== database) throw new Error("Manifest database differs from --database");
    const references = await referencesFor(manifest.ids);
    const approvedReferences = args.flatMap((arg, index) => arg === "--remove-reference" ? [args[index + 1]] : []);
    // Read every exact manifest ID: absence from the name/marker inventory is
    // not proof that an existing document is missing or safe to alter.
    const exactDocuments = await find({ _id: { $in: manifest.ids } });
    const { owned, approvedOutlines } = planFixtureCleanup(exactDocuments, references, manifest, approvedReferences);
    const registry = await get("ItemLists");
    if (manifest.ids.includes(registry.activeList?._id)) throw new Error(`Fixture is the live operator outline: ${registry.activeList._id}`);
    for (const doc of approvedOutlines) {
      const updated = { ...doc, items: doc.items.filter((entry: any) => !manifest.ids.includes(entry._id)) };
      await put(updated); // revision conflicts stop cleanup; never overwrite another writer
    }
    registry.itemLists = registry.itemLists.filter((entry: any) => !manifest.ids.includes(entry._id));
    for (const [scope, id] of Object.entries(registry.selectedIdByScope ?? {})) {
      if (id !== manifest.outlineId) continue;
      if (manifest.baselineSelection[scope]) registry.selectedIdByScope[scope] = manifest.baselineSelection[scope];
      else delete registry.selectedIdByScope[scope];
    }
    await put(registry);
    const library = await get("allItems");
    library.items = library.items.filter((entry: any) => !manifest.ids.includes(entry._id));
    await put(library);
    // Recheck outside references immediately before deleting records.
    planFixtureCleanup(owned, await referencesFor(manifest.ids), manifest);
    for (const doc of owned) await client.delete(encodeURIComponent(doc._id), { params: { rev: doc._rev } });
    const after = await inventory();
    const remaining = [...after.fixtures, ...after.registryMatches, ...after.libraryMatches].filter(doc => manifest.ids.includes(doc._id));
    if (remaining.length) throw new Error(`Fixture records or registry references remain: ${remaining.map(doc => doc._id)}`);
    console.log(`Removed owned IDs: ${owned.map(doc => doc._id).join(", ")}; remaining requested IDs: none`);
    await writeFile(value("--manifest"), JSON.stringify({ ...manifest, status: "cleaned" }, null, 2));
  }
} catch (error: any) {
  console.error(`Fixture operation failed (HTTP ${error.response?.status ?? "n/a"}): ${error.response ? "database request failed; inspect the saved inventory" : error.message}. Affected IDs: ${affectedIds.join(", ") || "none"}`);
  try {
    const remaining = await inventory();
    console.error(`Remaining E2E IDs: ${remaining.fixtures.map(doc => doc._id).join(", ") || "none"}; reference documents: ${remaining.references.map(doc => doc._id).join(", ") || "none"}`);
  } catch { console.error("Remaining records could not be queried; affected IDs require inspection."); }
  process.exitCode = 1;
}
