import {
  isStaleCreditDoc,
  recordAppliedCreditVersion,
  resetAppliedCreditVersions,
} from "./creditVersions";

const DOC_ID = "credits-outline-1-credit-abc";
const EARLIER = "2-earlier";
const LATER = "3-later";

describe("creditVersions", () => {
  beforeEach(() => {
    resetAppliedCreditVersions();
  });

  it("treats docs it has never applied as fresh", () => {
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(false);
  });

  it("rejects a lower PouchDB revision generation", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(true);
  });

  it("accepts a higher PouchDB revision generation from another operator", () => {
    recordAppliedCreditVersion(DOC_ID, EARLIER);
    expect(isStaleCreditDoc(DOC_ID, LATER)).toBe(false);
  });

  it("does not reject a re-delivery of the revision already applied", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    expect(isStaleCreditDoc(DOC_ID, LATER)).toBe(false);
  });

  it("keeps the newest revision generation when records arrive out of order", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    recordAppliedCreditVersion(DOC_ID, EARLIER);
    expect(isStaleCreditDoc(DOC_ID, EARLIER)).toBe(true);
  });

  it("never rejects docs without a usable PouchDB revision", () => {
    recordAppliedCreditVersion(DOC_ID, LATER);
    expect(isStaleCreditDoc(DOC_ID, undefined)).toBe(false);
    expect(isStaleCreditDoc(DOC_ID, "not-a-date")).toBe(false);
  });

  it("ignores unusable revisions when recording", () => {
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
