import test from "node:test";
import assert from "node:assert/strict";
import { resolveScheduleSmsDispatchConfig } from "./scheduleSmsDispatchConfig.js";

test("bulk schedule SMS stays disabled unless the server switch and measured segment rate are set", () => {
  const disabled = resolveScheduleSmsDispatchConfig({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.maxConcurrentProviderRequests, 1);
  assert.equal(disabled.maxRecipientsPerRun, 10);
  assert.equal(disabled.pollIntervalMs, 5000);

  const noRate = resolveScheduleSmsDispatchConfig({ SCHEDULE_BULK_DISPATCH_ENABLED: "true" });
  assert.equal(noRate.enabled, false);
  assert.match(noRate.readinessMessage, /verified send rate/i);
});

test("server activation uses an explicit positive segment rate and bounded execution settings", () => {
  const config = resolveScheduleSmsDispatchConfig({
    SCHEDULE_BULK_DISPATCH_ENABLED: "true",
    SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND: "1.5",
    SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN: "12",
    SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY: "2",
    SCHEDULE_BULK_DISPATCH_POLL_INTERVAL_MS: "7000",
    SCHEDULE_BULK_DISPATCH_LEASE_MS: "120000",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.segmentsPerSecond, 1.5);
  assert.equal(config.maxRecipientsPerRun, 12);
  assert.equal(config.maxConcurrentProviderRequests, 2);
  assert.equal(config.pollIntervalMs, 7000);
  assert.equal(config.leaseMs, 120000);
  assert.equal(config.readinessMessage, "");
});

test("unsafe or invalid limit values fall back to conservative defaults", () => {
  const config = resolveScheduleSmsDispatchConfig({
    SCHEDULE_BULK_DISPATCH_ENABLED: "TRUE",
    SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND: "Infinity",
    SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN: "1000",
    SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY: "10",
    SCHEDULE_BULK_DISPATCH_POLL_INTERVAL_MS: "1",
    SCHEDULE_BULK_DISPATCH_LEASE_MS: "2000",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.maxRecipientsPerRun, 10);
  assert.equal(config.maxConcurrentProviderRequests, 1);
  assert.equal(config.pollIntervalMs, 5000);
  assert.equal(config.leaseMs, 90000);
});

