import {
  beginContentDatabaseSession,
  getContentDatabaseSessionToken,
  hasSuccessfulInitialContentReplication,
  isBibleDocumentActivityIdle,
  isContentReplicationIdle,
  subscribeToContentActivity,
  trackBibleDocumentActivity,
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

  it("requires successful initial replication for the current content session", () => {
    const first = beginContentDatabaseSession("initial-content-db-test");
    expect(hasSuccessfulInitialContentReplication("initial-content-db-test")).toBe(false);
    first.markInitialReplicationComplete();
    expect(
      hasSuccessfulInitialContentReplication("initial-content-db-test", first.token),
    ).toBe(true);

    const next = beginContentDatabaseSession("initial-content-db-test");
    expect(getContentDatabaseSessionToken("initial-content-db-test")).toBe(next.token);
    expect(hasSuccessfulInitialContentReplication("initial-content-db-test")).toBe(false);
    first.release();
    expect(getContentDatabaseSessionToken("initial-content-db-test")).toBe(next.token);
    next.release();
  });

  it("publishes activity completion so blocked cleanup gets another opportunity", () => {
    const changes = jest.fn();
    const unsubscribe = subscribeToContentActivity(changes);
    const finish = trackBibleDocumentActivity("bible-creation-activity-db-test");
    expect(isBibleDocumentActivityIdle("bible-creation-activity-db-test")).toBe(false);
    finish();
    expect(isBibleDocumentActivityIdle("bible-creation-activity-db-test")).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
