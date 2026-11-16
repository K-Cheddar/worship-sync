import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import type { DBItemListDetails, ServiceItem } from "../types";
import {
  inspectServiceListRevisions, outlineRevisionItemReview, resolveServiceListRevisionConflict,
  ServiceListConflictError, type ServiceListFieldDb,
} from "./persistServiceListField";
import { getOutlineItemConflicts, reconcileOutlineItems } from "./outlineSync";

const row = (listId: string, name: string): ServiceItem => ({ _id: `song-${listId}`, listId, name, type: "song" });
const baseline = [row("welcome", "Welcome"), row("scripture", "Scripture"), row("prayer", "Prayer")];

async function setup() {
  const prefix = `outline-safety-${Date.now()}-${Math.random()}`;
  const a = new PouchDB(`${prefix}-a`);
  const b = new PouchDB(`${prefix}-b`);
  const c = new PouchDB(`${prefix}-c`);
  await a.put({ _id: "outline", name: "Sunday", docType: "itemListDetails", items: baseline,
    overlays: ["overlay-before"], servicePlanBinding: { serviceId: "service", servicePlanId: "plan" },
    metadata: { custom: "keep" }, createdAt: "2026-01-01T00:00:00.000Z" });
  await Promise.all([b.replicate.from(a), c.replicate.from(a)]);
  const base = await a.get<DBItemListDetails>("outline");
  await a.put({ ...base, items: [{ ...baseline[0], name: "Welcome A" }, { ...baseline[1], name: "Scripture A" }] });
  await b.put({ ...base, items: [{ ...baseline[0], name: "Welcome B", background: "welcome-background" }, baseline[1], baseline[2], row("closing", "Closing Song")], overlays: ["overlay-from-b"] });
  await a.replicate.from(b);
  const db = a as unknown as ServiceListFieldDb;
  const head = await a.get<DBItemListDetails>("outline", { conflicts: true });
  const inspected = await inspectServiceListRevisions(db, "outline", head);
  const conflict = inspected.conflict!.revisionConflict!;
  const review = outlineRevisionItemReview(conflict, head.items, head.items)!;
  return { a, b, c, db, head, conflict, review, base, cleanup: () => Promise.all([a.destroy(), b.destroy(), c.destroy()]) };
}

function selection(env: Awaited<ReturnType<typeof setup>>, name = "Welcome A") {
  const choices = Object.fromEntries(getOutlineItemConflicts(env.review.baselineItems, env.review.localItems, env.review.remoteItems)
    .map((entry) => [entry.key, entry.localRow?.name === name ? "local" as const : "remote" as const]));
  const result = reconcileOutlineItems(env.review.baselineItems, env.review.localItems, env.review.remoteItems, (entry) => choices[entry.key]);
  return { items: result.items, decision: { kind: "rows" as const, review: env.review, choices } };
}

describe("outline row conflict safety with real disconnected PouchDB replicas", () => {
  it.each(["Welcome A", "Welcome B"])("preserves independent changes when the operator selects %s", async (name) => {
    const env = await setup();
    try {
      const originalRemove = env.a.remove.bind(env.a);
      const remove = jest.spyOn(env.a, "remove");
      expect(env.conflict.itemReview).toBeDefined();
      expect((await env.a.get("outline", { conflicts: true }))._conflicts).toHaveLength(1);
      const chosen = selection(env, name);
      remove.mockImplementation(async (id, rev) => {
        // Every deletion must follow a durable, content-verified commit.
        const committed = await env.a.get<DBItemListDetails>("outline");
        expect(committed.items).toEqual(chosen.items);
        expect(env.conflict.graph.conflictRevisions).toContain(rev);
        return originalRemove(id, rev);
      });
      const saved = await resolveServiceListRevisionConflict(env.db, "outline", chosen.items, env.conflict, chosen.decision);
      expect(saved.items).toEqual([
        { ...baseline[0], name, background: "welcome-background" },
        { ...baseline[1], name: "Scripture A" }, row("closing", "Closing Song"),
      ]);
      expect(saved).toMatchObject({ overlays: ["overlay-from-b"], servicePlanBinding: { serviceId: "service", servicePlanId: "plan" }, metadata: { custom: "keep" }, createdAt: "2026-01-01T00:00:00.000Z" });
      expect(remove).toHaveBeenCalledTimes(1);
      expect((await env.a.get("outline", { conflicts: true }))._conflicts).toBeUndefined();
      await env.b.replicate.from(env.a);
      expect((await env.b.get<DBItemListDetails>("outline", { conflicts: true })).items).toEqual(saved.items);
    } finally { await env.cleanup(); }
  });

  it("rejects incomplete choices and a preview that drops an independent row before any write or retirement", async () => {
    const env = await setup();
    try {
      const put = jest.spyOn(env.a, "put");
      const remove = jest.spyOn(env.a, "remove");
      const chosen = selection(env);
      await expect(resolveServiceListRevisionConflict(env.db, "outline", chosen.items, env.conflict, { ...chosen.decision, choices: {} })).rejects.toThrow("choices no longer match");
      await expect(resolveServiceListRevisionConflict(env.db, "outline", chosen.items.filter((item) => item.listId !== "closing"), env.conflict, chosen.decision)).rejects.toThrow("choices no longer match");
      expect(put).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { await env.cleanup(); }
  });

  it("rejects a new revision arriving between validation and commit", async () => {
    const env = await setup();
    try {
      const chosen = selection(env);
      let reads = 0;
      const guardedDb: ServiceListFieldDb = { ...env.db, get: async (id, options) => {
        if (options?.revs && !options.rev && ++reads === 2) {
          await env.c.put({ ...env.base, items: [...baseline, row("new", "New during review")] });
          await env.a.replicate.from(env.c);
        }
        return env.a.get(id, options);
      }, put: jest.fn(), remove: jest.fn() };
      await expect(resolveServiceListRevisionConflict(guardedDb, "outline", chosen.items, env.conflict, chosen.decision)).rejects.toBeInstanceOf(ServiceListConflictError);
      expect(guardedDb.put).not.toHaveBeenCalled();
      expect(guardedDb.remove).not.toHaveBeenCalled();
      expect((await env.a.get("outline", { conflicts: true }))._conflicts).toHaveLength(2);
    } finally { await env.cleanup(); }
  });

  it("does not retire branches if the acknowledged saved body differs from the preview", async () => {
    const env = await setup();
    try {
      const chosen = selection(env);
      const remove = jest.fn();
      const wrongBodyDb: ServiceListFieldDb = { get: env.db.get.bind(env.a), remove,
        put: async (doc) => env.a.put({ ...doc, items: doc.items.filter((item) => item.listId !== "closing") }) };
      await expect(resolveServiceListRevisionConflict(wrongBodyDb, "outline", chosen.items, env.conflict, chosen.decision)).rejects.toBeInstanceOf(ServiceListConflictError);
      expect(remove).not.toHaveBeenCalled();
      expect((await env.a.get("outline", { conflicts: true }))._conflicts).toHaveLength(1);
    } finally { await env.cleanup(); }
  });

  it("preserves reviewed leaves when another branch arrives after put but before retirement", async () => {
    const env = await setup();
    try {
      const chosen = selection(env);
      const remove = jest.fn();
      const racingDb: ServiceListFieldDb = { get: env.db.get.bind(env.a), remove, put: async (doc) => {
        const result = await env.a.put(doc);
        await env.c.put({ ...env.base, items: [...baseline, row("new", "New after commit")] });
        await env.a.replicate.from(env.c);
        return result;
      } };
      await expect(resolveServiceListRevisionConflict(racingDb, "outline", chosen.items, env.conflict, chosen.decision)).rejects.toBeInstanceOf(ServiceListConflictError);
      expect(remove).not.toHaveBeenCalled();
      expect((await env.a.get("outline", { conflicts: true }))._conflicts).toHaveLength(2);
    } finally { await env.cleanup(); }
  });

  it("does not retire acknowledged branches after the account session ends", async () => {
    const env = await setup();
    try {
      let active = true;
      const chosen = selection(env);
      const remove = jest.fn();
      const database: ServiceListFieldDb = { get: env.db.get.bind(env.a), remove, put: async (doc) => {
        const result = await env.a.put(doc);
        active = false;
        return result;
      } };
      await expect(resolveServiceListRevisionConflict(database, "outline", chosen.items, env.conflict, chosen.decision, () => active)).rejects.toBeInstanceOf(ServiceListConflictError);
      expect(remove).not.toHaveBeenCalled();
      expect((await env.a.get("outline", { conflicts: true }))._conflicts).toHaveLength(1);
    } finally { await env.cleanup(); }
  });

  it("preserves independent document fields even when a metadata conflict requires whole-version review", async () => {
    const env = await setup();
    try {
      const branchA = env.conflict.versions.find((version) => version.items[0].name === "Welcome A")!;
      const a = await env.a.get<DBItemListDetails>("outline", { rev: branchA.revision });
      await env.a.put({ ...a, name: "Title A", metadata: { custom: "Edited by A" } });
      await env.b.put({ ...await env.b.get<DBItemListDetails>("outline"), name: "Title B" });
      await env.a.replicate.from(env.b);
      const inspected = await inspectServiceListRevisions(env.db, "outline", await env.a.get<DBItemListDetails>("outline", { conflicts: true }));
      const reviewed = inspected.conflict!.revisionConflict!;
      expect(reviewed.itemReview).toBeUndefined();
      expect(reviewed.documentConflicts).toEqual(["name"]);
      const selected = reviewed.versions.find((version) => version.document?.name === "Title A")!;
      const saved = await resolveServiceListRevisionConflict(env.db, "outline", selected.items, reviewed, { kind: "whole", revision: selected.revision });
      expect(saved).toMatchObject({ name: "Title A", metadata: { custom: "Edited by A" }, overlays: ["overlay-from-b"], servicePlanBinding: { serviceId: "service", servicePlanId: "plan" } });
      expect(saved.items).toEqual(selected.items);
    } finally { await env.cleanup(); }
  });

  it("never retires a branch whose body was not available in the reviewed versions", async () => {
    const env = await setup();
    try {
      const put = jest.spyOn(env.a, "put");
      const remove = jest.spyOn(env.a, "remove");
      const incomplete = { ...env.conflict, versions: env.conflict.versions.slice(0, 1) };
      await expect(resolveServiceListRevisionConflict(env.db, "outline", env.head.items, incomplete, { kind: "whole" })).rejects.toBeInstanceOf(ServiceListConflictError);
      expect(put).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { await env.cleanup(); }
  });

  it("leaves persisted conflicts available for inspection in a later authorized session", async () => {
    const env = await setup();
    try {
      const freshHandle = new PouchDB(env.a.name);
      const head = await freshHandle.get<DBItemListDetails>("outline", { conflicts: true });
      const next = await inspectServiceListRevisions(freshHandle as unknown as ServiceListFieldDb, "outline", head);
      expect(next.conflict?.revisionConflict?.graph).toEqual(env.conflict.graph);
      expect(next.conflict?.revisionConflict?.versions).toHaveLength(2);
      // PouchDB shares the IndexedDB connection; setup cleanup destroys it.
    } finally { await env.cleanup(); }
  });
});
