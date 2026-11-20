import { requestSelectedSlideNavigation, slideNavigationSlice } from "./slideNavigationSlice";

describe("slideNavigationSlice", () => {
  it("counts intentional navigation separately from structural item selection", () => {
    const initial = slideNavigationSlice.getInitialState();
    expect(slideNavigationSlice.reducer(initial, requestSelectedSlideNavigation()))
      .toEqual({ selectedSlideScrollRequest: 1 });
    expect(slideNavigationSlice.reducer(initial, { type: "item/setSelectedSlide", payload: 3 }))
      .toBe(initial);
  });
});
