import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityOccurrenceScopesOverlap,
  canonicalizeAvailabilityOccurrenceScope,
} from "./teamAvailabilityOccurrenceScope.js";

const grouped = (date, serviceIds) => ({
  occurrenceId: `group:weekend@${date}`,
  groupId: "weekend",
  serviceId: serviceIds[0],
  serviceIds,
  serviceDate: date,
  startsAt: `${date}T15:00:00.000Z`,
});

const standalone = (date, serviceId) => ({
  occurrenceId: `${serviceId}@${date}T15:00:00.000Z`,
  serviceId,
  serviceDate: date,
  startsAt: `${date}T15:00:00.000Z`,
});

test("grouped service membership is scoped to its occurrence date", () => {
  const scope = canonicalizeAvailabilityOccurrenceScope([
    grouped("2027-01-02", ["sabbath", "second"]),
    standalone("2027-01-09", "sabbath"),
  ]);

  assert.equal(scope.ambiguous, false);
  assert.equal(scope.rows.length, 2);
  assert.deepEqual(scope.rows.map((row) => row.date).sort(), ["2027-01-02", "2027-01-09"]);
});

test("exact grouped and standalone aliases are equivalent only on the same date", () => {
  const scope = canonicalizeAvailabilityOccurrenceScope([
    grouped("2027-01-02", ["sabbath", "second"]),
    standalone("2027-01-02", "sabbath"),
    standalone("2027-01-02", "second"),
  ]);

  assert.equal(scope.ambiguous, false);
  assert.equal(scope.rows.length, 1);
  assert.deepEqual(scope.rows[0], {
    date: "2027-01-02",
    groupId: "weekend",
    serviceIds: ["sabbath", "second"],
  });
});

test("historical grouped membership is preserved when current grouping changes", () => {
  const historical = canonicalizeAvailabilityOccurrenceScope([
    grouped("2027-01-02", ["sabbath", "second"]),
    standalone("2027-01-02", "sabbath"),
    standalone("2027-01-02", "second"),
  ]);
  const current = canonicalizeAvailabilityOccurrenceScope([
    grouped("2027-01-02", ["sabbath", "second", "evening"]),
  ]);

  assert.equal(historical.ambiguous, false);
  assert.equal(current.ambiguous, false);
  assert.notDeepEqual(historical.keys, current.keys);
  assert.equal(availabilityOccurrenceScopesOverlap(historical.rows, current.rows), true);
});

test("independent services on one date remain distinct and partial aliases require review", () => {
  const independent = canonicalizeAvailabilityOccurrenceScope([
    standalone("2027-01-02", "sabbath"),
    standalone("2027-01-02", "concert"),
  ]);
  const partialAlias = canonicalizeAvailabilityOccurrenceScope([
    grouped("2027-01-02", ["sabbath", "second"]),
    standalone("2027-01-02", "sabbath"),
  ]);

  assert.equal(independent.ambiguous, false);
  assert.equal(independent.rows.length, 2);
  assert.equal(partialAlias.ambiguous, true);
});
