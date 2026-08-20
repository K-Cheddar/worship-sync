import {
  isStaleCreditDoc,
  recordAppliedCreditVersion,
  resetAppliedCreditVersions,
} from "./creditVersions";

const DOC_ID = "credits-outline-1-credit-abc";
const EARLIER = "2026-08-18T10:00:00.000Z";
const LATER = "2026-08-18T10:00:05.000Z";

describe("creditVersions", () => {
  beforeEach(() => {
    resetAppliedCreditVersions();
  });

  it("treats docs it has never applied as fresh", () => {
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(false);
  });

  it("rejects a revision older than the one already applied", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(true);
  });

  it("accepts a newer revision from another operator", () => {
    recordAppliedCreditVersion(DOC_ID, EARLIER);
    expect(isStaleCreditDoc(DOC_ID, LATER)).toBe(false);
  });

  it("does not reject a re-delivery of the revision already applied", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    expect(isStaleCreditDoc(DOC_ID, LATER)).toBe(false);
  });

  it("keeps the newest stamp when records arrive out of order", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    recordAppliedCreditVersion(DOC_ID, EARLIER);
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(true);
  });

  it("never rejects docs without a usable updatedAt", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    expect(isStaleCreditDoc(DOC_ID, undefined)).toBe(false);
    expect(isStaleCreditDoc(DOC_ID, "not-a-date")).toBe(false);
  });

  it("ignores unusable stamps when recording", () => {
    recordAppliedCreditVersion(DOC_ID, "not-a-date");
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(false);
  });

  it("ignores calls without a doc id", () => {
    expect(isStaleCreditDoc(undefined, EARLIER)).toBe(false);
    expect(() => recordAppliedCreditVersion(undefined, EARLIER)).not.toThrow();
  });

  it("clears tracking on reset", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    resetAppliedCreditVersions();
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(false);
  });
});
