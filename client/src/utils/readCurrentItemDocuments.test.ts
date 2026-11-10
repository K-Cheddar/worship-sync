import { readCurrentItemDocuments } from "./readCurrentItemDocuments";

const song = { _id: "song", type: "song", name: "Recovered song", _rev: "1-a" };

describe("readCurrentItemDocuments", () => {
  it("replays from sequence zero when an empty IndexedDB snapshot omits update_seq", async () => {
    const db = {
      allDocs: jest.fn().mockResolvedValue({ rows: [] }),
      changes: jest.fn().mockResolvedValue({ results: [{ id: song._id, seq: 1, doc: song }] }),
    } as unknown as PouchDB.Database;

    const documents = await readCurrentItemDocuments(db, [song._id]);

    expect(db.allDocs).toHaveBeenCalledWith({ keys: [song._id], include_docs: true, update_seq: true });
    expect(db.changes).toHaveBeenCalledWith({ since: 0, doc_ids: [song._id], include_docs: true });
    expect([...documents.values()]).toEqual([song]);
  });
});
