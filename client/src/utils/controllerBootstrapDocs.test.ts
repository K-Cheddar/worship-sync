import {
  DEFAULT_BOOTSTRAP_OUTLINE,
  loadOrCreateItemListsDoc,
  loadOrCreatePreferencesBundle,
} from "./controllerBootstrapDocs";
import {
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
} from "../types";
import { preferencesClusterLoadFallback } from "../store/preferencesSlice";

const notFound = { status: 404, name: "not_found" };

describe("controllerBootstrapDocs", () => {
  describe("loadOrCreateItemListsDoc", () => {
    it("returns an existing non-empty ItemLists registry without writing", async () => {
      const existing = {
        _id: "ItemLists",
        _rev: "1-a",
        itemLists: [{ _id: "sunday", name: "Sunday" }],
        activeList: { _id: "sunday", name: "Sunday" },
      };
      const db = {
        get: jest.fn().mockResolvedValue(existing),
        put: jest.fn(),
      } as unknown as PouchDB.Database;

      await expect(loadOrCreateItemListsDoc(db)).resolves.toBe(existing);
      expect(db.put).not.toHaveBeenCalled();
    });

    it("creates a named default outline after a confirmed ItemLists 404", async () => {
      const created = {
        _id: "ItemLists",
        _rev: "1-created",
        itemLists: [DEFAULT_BOOTSTRAP_OUTLINE],
        activeList: DEFAULT_BOOTSTRAP_OUTLINE,
      };
      const get = jest
        .fn()
        .mockRejectedValueOnce(notFound) // ItemLists missing
        .mockRejectedValueOnce(notFound) // outline detail missing
        .mockResolvedValueOnce(created); // final ItemLists get
      const put = jest.fn().mockResolvedValue({ ok: true });
      const db = { get, put } as unknown as PouchDB.Database;

      await expect(loadOrCreateItemListsDoc(db)).resolves.toEqual(created);
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: DEFAULT_BOOTSTRAP_OUTLINE._id,
          name: DEFAULT_BOOTSTRAP_OUTLINE.name,
          items: [],
          overlays: [],
          docType: "itemListDetails",
        }),
      );
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "ItemLists",
          itemLists: [DEFAULT_BOOTSTRAP_OUTLINE],
          activeList: DEFAULT_BOOTSTRAP_OUTLINE,
          docType: "itemLists",
        }),
      );
    });

    it("heals an existing empty ItemLists registry with a named default outline", async () => {
      const empty = {
        _id: "ItemLists",
        _rev: "1-empty",
        itemLists: [],
        activeList: { _id: "", name: "" },
        docType: "itemLists",
      };
      const healed = {
        ...empty,
        _rev: "2-healed",
        itemLists: [DEFAULT_BOOTSTRAP_OUTLINE],
        activeList: DEFAULT_BOOTSTRAP_OUTLINE,
      };
      const get = jest
        .fn()
        .mockResolvedValueOnce(empty)
        .mockRejectedValueOnce(notFound) // outline detail
        .mockResolvedValueOnce(healed);
      const put = jest.fn().mockResolvedValue({ ok: true });
      const db = { get, put } as unknown as PouchDB.Database;

      await expect(loadOrCreateItemListsDoc(db)).resolves.toEqual(healed);
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "ItemLists",
          _rev: "1-empty",
          itemLists: [DEFAULT_BOOTSTRAP_OUTLINE],
          activeList: DEFAULT_BOOTSTRAP_OUTLINE,
        }),
      );
    });

    it("does not seed a new outline over an unresolved empty registry branch", async () => {
      const conflicted = {
        _id: "ItemLists",
        _rev: "2-winner",
        _conflicts: ["2-losing"],
        itemLists: [],
        activeList: { _id: "", name: "" },
      };
      const db = {
        get: jest.fn().mockResolvedValue(conflicted),
        put: jest.fn(),
      } as unknown as PouchDB.Database;

      await expect(loadOrCreateItemListsDoc(db)).resolves.toBe(conflicted);
      expect(db.get).toHaveBeenCalledTimes(1);
      expect(db.put).not.toHaveBeenCalled();
    });
  });

  describe("loadOrCreatePreferencesBundle", () => {
    it("seeds preferences cluster when preferences doc is missing", async () => {
      const seededPrefs = {
        _id: PREFERENCES_POUCH_ID,
        _rev: "1-p",
        preferences: preferencesClusterLoadFallback.preferences,
        docType: "preferences",
      };
      const seededQl = {
        _id: QUICK_LINKS_POUCH_ID,
        _rev: "1-q",
        quickLinks: [],
        docType: "quickLinks",
      };
      const seededMon = {
        _id: MONITOR_SETTINGS_POUCH_ID,
        _rev: "1-m",
        monitorSettings: preferencesClusterLoadFallback.monitorSettings,
        docType: "monitorSettings",
      };

      let preferencesExists = false;
      const docs = new Map<string, unknown>();

      const get = jest.fn(async (id: string) => {
        if (id === PREFERENCES_POUCH_ID && !preferencesExists) {
          throw notFound;
        }
        if (docs.has(id)) return docs.get(id);
        throw notFound;
      });

      const put = jest.fn(async (doc: { _id: string }) => {
        if (doc._id === PREFERENCES_POUCH_ID) {
          preferencesExists = true;
          docs.set(PREFERENCES_POUCH_ID, {
            ...seededPrefs,
            ...doc,
            _rev: "1-p",
          });
        } else {
          docs.set(doc._id, {
            ...(doc._id === QUICK_LINKS_POUCH_ID
              ? seededQl
              : doc._id === MONITOR_SETTINGS_POUCH_ID
                ? seededMon
                : {}),
            ...doc,
            _rev: "1-x",
          });
        }
        return { ok: true };
      });

      const db = { get, put } as unknown as PouchDB.Database;

      const bundle = await loadOrCreatePreferencesBundle(db);
      expect(bundle.preferences).toEqual(
        preferencesClusterLoadFallback.preferences,
      );
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({ _id: PREFERENCES_POUCH_ID }),
      );
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({ _id: QUICK_LINKS_POUCH_ID }),
      );
      expect(put).not.toHaveBeenCalledWith(
        expect.objectContaining({ _id: MEDIA_ROUTE_FOLDERS_POUCH_ID }),
      );
    });

    it("does not write when preferences read fails for a non-404 reason", async () => {
      const readError = { status: 500, message: "unavailable" };
      const db = {
        get: jest.fn().mockRejectedValue(readError),
        put: jest.fn(),
      } as unknown as PouchDB.Database;

      await expect(loadOrCreatePreferencesBundle(db)).rejects.toBe(readError);
      expect(db.put).not.toHaveBeenCalled();
    });
  });
});
