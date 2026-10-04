import type PouchDB from "pouchdb-browser";
import {
  getControllerMediaRouteFoldersDocId,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
} from "../types";
import {
  loadOrCreateControllerMediaRouteFolders,
  patchControllerMediaRouteFolder,
  repairPersistedMediaRouteFolders,
} from "./controllerMediaRouteFolders";

const missing = { status: 404, name: "not_found" };
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map(Object.entries(seed));
  let rev = 1;
  const get = jest.fn(async (id: string) => {
    const doc = docs.get(id);
    if (!doc) throw missing;
    return { ...doc };
  });
  const put = jest.fn(async (doc: Record<string, unknown>) => {
    const existing = docs.get(String(doc._id));
    if (existing && doc._rev !== existing._rev) throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    const next = { ...doc, _rev: `${rev++}-test` };
    docs.set(String(doc._id), next);
    return { ok: true, rev: next._rev };
  });
  const allDocs = jest.fn(async () => ({ rows: [...docs.values()].map((doc) => ({ doc: { ...doc } })) }));
  return { db: { get, put, allDocs } as unknown as PouchDB.Database, docs, get, put, allDocs };
}

describe("controller media route folder documents", () => {
  it("seeds independent profile docs from the legacy map once", async () => {
    const legacyMap = {
      "controller-item": "legacy-image",
      "controller-settings": "settings",
      "controller-item-image": "legacy-image-override",
    };
    const { db, docs } = makeDb({
      [MEDIA_ROUTE_FOLDERS_POUCH_ID]: { _id: MEDIA_ROUTE_FOLDERS_POUCH_ID, mediaRouteFolders: legacyMap },
    });
    const presentation = await loadOrCreateControllerMediaRouteFolders(db, "presentation");
    const aux = await loadOrCreateControllerMediaRouteFolders(db, "aux/1");
    expect(presentation.mediaRouteFolders["controller-item-image"]).toBe("legacy-image-override");
    expect(presentation.mediaRouteFolders["controller-item-song"]).toBe("legacy-image");
    expect(aux.mediaRouteFolders).toEqual(presentation.mediaRouteFolders);

    await patchControllerMediaRouteFolder(db, "aux/1", "controller-item-image", "videos");
    await patchControllerMediaRouteFolder(db, "presentation", "controller-item-image", "sermon-graphics");
    expect(docs.get(getControllerMediaRouteFoldersDocId("aux/1"))?.mediaRouteFolders).toMatchObject({ "controller-item-image": "videos" });
    expect(docs.get(getControllerMediaRouteFoldersDocId("presentation"))?.mediaRouteFolders).toMatchObject({ "controller-item-image": "sermon-graphics" });
    expect(docs.get(MEDIA_ROUTE_FOLDERS_POUCH_ID)?.mediaRouteFolders).toEqual(legacyMap);
  });

  it("keeps profiles and route keys independent, including overlays and custom IDs", async () => {
    const { db } = makeDb();
    await patchControllerMediaRouteFolder(db, "aux 1", "controller-item-image", "videos");
    await patchControllerMediaRouteFolder(db, "aux:1", "controller-item-image", "announcements");
    await patchControllerMediaRouteFolder(db, "overlay", "overlay-controller", "overlays");
    await patchControllerMediaRouteFolder(db, "aux 1", "controller-item-song", "songs");
    const aux = await loadOrCreateControllerMediaRouteFolders(db, "aux 1");
    expect(aux.mediaRouteFolders).toEqual({ "controller-item-image": "videos", "controller-item-song": "songs" });
    expect((await loadOrCreateControllerMediaRouteFolders(db, "aux:1")).mediaRouteFolders["controller-item-image"]).toBe("announcements");
    expect((await loadOrCreateControllerMediaRouteFolders(db, "overlay")).mediaRouteFolders["overlay-controller"]).toBe("overlays");
    expect(getControllerMediaRouteFoldersDocId("aux 1")).toBe("mediaRouteFolders:aux%201");
  });

  it("creates an empty profile doc and adopts a creation race winner", async () => {
    const { db, docs, put } = makeDb();
    const id = getControllerMediaRouteFoldersDocId("presentation");
    put.mockImplementationOnce(async () => {
      docs.set(id, { _id: id, controllerProfileId: "presentation", mediaRouteFolders: { "controller-default": "race-folder" }, _rev: "1-race" });
      throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    });
    const loaded = await loadOrCreateControllerMediaRouteFolders(db, "presentation");
    expect(loaded.mediaRouteFolders).toEqual({ "controller-default": "race-folder" });
    const fresh = makeDb();
    expect((await loadOrCreateControllerMediaRouteFolders(fresh.db, "brand-new")).mediaRouteFolders).toEqual({});
  });

  it("re-reads route patches after conflict and preserves the other client's route", async () => {
    const id = getControllerMediaRouteFoldersDocId("presentation");
    const { db, docs, put } = makeDb({
      [id]: { _id: id, _rev: "1-old", controllerProfileId: "presentation", mediaRouteFolders: { "controller-default": "old" }, docType: "mediaRouteFolders" },
    });
    put.mockImplementationOnce(async () => {
      docs.set(id, { _id: id, _rev: "2-remote", controllerProfileId: "presentation", mediaRouteFolders: { "controller-default": "remote", "controller-item-song": "songs" }, docType: "mediaRouteFolders" });
      throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    });
    const saved = await patchControllerMediaRouteFolder(db, "presentation", "controller-item-image", "images");
    expect(saved.mediaRouteFolders).toEqual({ "controller-default": "remote", "controller-item-song": "songs", "controller-item-image": "images" });
  });

  it("repairs existing scoped documents and legacy migration data without creating profiles", async () => {
    const legacyId = MEDIA_ROUTE_FOLDERS_POUCH_ID;
    const presentationId = getControllerMediaRouteFoldersDocId("presentation");
    const auxId = getControllerMediaRouteFoldersDocId("aux");
    const { db, docs } = makeDb({
      [legacyId]: { _id: legacyId, _rev: "1-l", mediaRouteFolders: { "controller-item": "deleted", "controller-default": "safe" } },
      [presentationId]: { _id: presentationId, _rev: "1-p", controllerProfileId: "presentation", mediaRouteFolders: { "controller-item-image": "deleted" }, docType: "mediaRouteFolders" },
    });
    const updated = await repairPersistedMediaRouteFolders(db, new Set(["deleted"]), "parent");
    expect(updated).toHaveLength(1);
    expect(docs.get(presentationId)?.mediaRouteFolders).toEqual({ "controller-item-image": "parent" });
    expect(docs.get(legacyId)?.mediaRouteFolders).toMatchObject({
      "controller-item-song": "parent",
      "controller-item-image": "parent",
      "controller-default": "safe",
    });
    expect(docs.get(legacyId)?.mediaRouteFolders).not.toHaveProperty("controller-item");
    expect(docs.has(auxId)).toBe(false);
  });

  it("re-reads a scoped repair conflict and preserves unrelated remote routes", async () => {
    const id = getControllerMediaRouteFoldersDocId("presentation");
    const { db, docs, put } = makeDb({
      [id]: { _id: id, _rev: "1-p", controllerProfileId: "presentation", mediaRouteFolders: { "controller-item-image": "deleted" }, docType: "mediaRouteFolders" },
    });
    put.mockImplementationOnce(async () => {
      docs.set(id, { _id: id, _rev: "2-remote", controllerProfileId: "presentation", mediaRouteFolders: { "controller-item-image": "deleted", "controller-item-song": "songs" }, docType: "mediaRouteFolders" });
      throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    });
    await repairPersistedMediaRouteFolders(db, new Set(["deleted"]), "parent");
    expect(docs.get(id)?.mediaRouteFolders).toEqual({ "controller-item-image": "parent", "controller-item-song": "songs" });
  });
});
