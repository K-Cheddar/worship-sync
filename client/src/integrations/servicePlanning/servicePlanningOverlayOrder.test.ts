import type { OverlayInfo } from "../../types";
import { moveOverlayAfterServicePlanningAnchor } from "./servicePlanningOverlayOrder";

const overlay = (id: string): OverlayInfo => ({ id, type: "participant" });

describe("moveOverlayAfterServicePlanningAnchor", () => {
  it("moves the first synced overlay to the top when there is no anchor", () => {
    const list = [overlay("a"), overlay("b"), overlay("c")];

    expect(moveOverlayAfterServicePlanningAnchor(list, "c").map((o) => o.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves reused overlays after the previous synced overlay", () => {
    const list = [overlay("sabbath"), overlay("welcome"), overlay("cohost")];

    expect(
      moveOverlayAfterServicePlanningAnchor(list, "cohost", "sabbath").map(
        (o) => o.id,
      ),
    ).toEqual(["sabbath", "cohost", "welcome"]);
  });

  it("returns the original list when the overlay is already positioned", () => {
    const list = [overlay("a"), overlay("b"), overlay("c")];

    expect(moveOverlayAfterServicePlanningAnchor(list, "b", "a")).toBe(list);
  });
});
