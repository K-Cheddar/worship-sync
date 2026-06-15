import {
  getControllerRightPanelWidthPx,
  CONTROLLER_LG_BREAKPOINT_PX,
} from "./controllerPanelLayout";

describe("getControllerRightPanelWidthPx", () => {
  it("uses desktop percent at and above the lg breakpoint", () => {
    expect(getControllerRightPanelWidthPx(CONTROLLER_LG_BREAKPOINT_PX)).toBe(256);
    expect(getControllerRightPanelWidthPx(1600)).toBe(400);
  });

  it("uses mobile percent below the lg breakpoint", () => {
    expect(getControllerRightPanelWidthPx(CONTROLLER_LG_BREAKPOINT_PX - 1)).toBe(
      Math.round(((CONTROLLER_LG_BREAKPOINT_PX - 1) * 65) / 100),
    );
  });
});
