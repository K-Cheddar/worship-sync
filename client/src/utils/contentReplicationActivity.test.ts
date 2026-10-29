import {
  isContentReplicationIdle,
  trackContentReplication,
} from "./contentReplicationActivity";

describe("content replication activity", () => {
  it("keeps shared databases busy until every active replication settles", () => {
    const first = trackContentReplication("content-db-test");
    const second = trackContentReplication("content-db-test");
    expect(isContentReplicationIdle("content-db-test")).toBe(false);

    first.setBusy(false);
    expect(isContentReplicationIdle("content-db-test")).toBe(false);
    second.setBusy(false);
    expect(isContentReplicationIdle("content-db-test")).toBe(true);

    second.setBusy(true);
    expect(isContentReplicationIdle("content-db-test")).toBe(false);
    second.release();
    expect(isContentReplicationIdle("content-db-test")).toBe(true);
  });

  it("releases a cancelled replication and ignores later stale events", () => {
    const activity = trackContentReplication("cancelled-content-db-test");
    activity.release();
    activity.setBusy(true);

    expect(isContentReplicationIdle("cancelled-content-db-test")).toBe(true);
  });
});
