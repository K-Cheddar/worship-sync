export const FIXTURE_OWNER = "presentation-controller-v1";
export type FixtureManifest = {
  owner: string;
  database: string;
  outlineId: string;
  ids: string[];
  baselineSelection: Record<string, string>;
};
export type FixtureDoc = Record<string, any> & { _id: string; _rev?: string };

export function planFixtureCleanup(
  documents: FixtureDoc[], references: FixtureDoc[], manifest: FixtureManifest, approvedReferences: string[] = [],
) {
  if (manifest.owner !== FIXTURE_OWNER || typeof manifest.outlineId !== "string" || !Array.isArray(manifest.ids) ||
    !manifest.ids.every(id => typeof id === "string" && id.length > 0) || !manifest.outlineId.startsWith("e2e-controller-outline-") ||
    !manifest.ids.includes(manifest.outlineId) || new Set(manifest.ids).size !== manifest.ids.length) {
    throw new Error("Invalid fixture ownership manifest");
  }
  const owned = documents.filter(doc => manifest.ids.includes(doc._id));
  const unowned = owned.filter(doc => doc.e2eFixture?.owner !== FIXTURE_OWNER || doc.e2eFixture?.outlineId !== manifest.outlineId);
  const foreign = references.filter(doc => !manifest.ids.includes(doc._id) && !["allItems", "ItemLists"].includes(doc._id));
  const unapproved = foreign.filter(doc => !approvedReferences.includes(doc._id));
  if (unowned.length || unapproved.length) {
    throw new Error(`Cleanup refused: unowned IDs [${unowned.map(d => d._id)}], outside references [${unapproved.map(d => d._id)}]; fixture IDs [${manifest.ids}]`);
  }
  for (const doc of foreign) {
    if (!Array.isArray(doc.items) || !doc.items.some((entry: any) => manifest.ids.includes(entry._id))) {
      throw new Error(`Reference ${doc._id} needs manual inspection; only explicitly approved outline item references can be removed`);
    }
  }
  return { owned, approvedOutlines: foreign };
}
