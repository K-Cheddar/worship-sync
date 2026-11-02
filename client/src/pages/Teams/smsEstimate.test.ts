import { measureMessage } from "./smsEstimate";

it("estimates GSM and Unicode message segments with their separate limits", () => {
  expect(measureMessage("a".repeat(160))).toEqual({ characterCount: 160, segmentCount: 1 });
  expect(measureMessage("a".repeat(161)).segmentCount).toBe(2);
  expect(measureMessage("✓".repeat(70)).segmentCount).toBe(1);
  expect(measureMessage("✓".repeat(71)).segmentCount).toBe(2);
  expect(measureMessage("^".repeat(81)).segmentCount).toBe(2);
});
