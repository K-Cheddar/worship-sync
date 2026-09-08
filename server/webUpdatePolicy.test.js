import test from "node:test";
import assert from "node:assert/strict";
import { resolveMinimumSupportedWebVersion } from "./webUpdatePolicy.js";

test("uses a configured minimum version at or below the deployed version", () => {
  assert.equal(
    resolveMinimumSupportedWebVersion("2.22.0", "2.23.0"),
    "2.22.0",
  );
});

test("fails open for invalid or future minimum versions", () => {
  assert.equal(resolveMinimumSupportedWebVersion("", "2.23.0"), null);
  assert.equal(resolveMinimumSupportedWebVersion("newest", "2.23.0"), null);
  assert.equal(resolveMinimumSupportedWebVersion("2.24.0", "2.23.0"), null);
});
