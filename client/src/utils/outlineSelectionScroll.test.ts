import {
  requestOutlineSelectionScroll,
  subscribeOutlineSelectionScroll,
} from "./outlineSelectionScroll";

describe("outlineSelectionScroll", () => {
  it("notifies current listeners and ignores unsubscribed ones", () => {
    const active = jest.fn();
    const removed = jest.fn();
    const unsubscribeActive = subscribeOutlineSelectionScroll(active);
    const unsubscribeRemoved = subscribeOutlineSelectionScroll(removed);

    unsubscribeRemoved();
    requestOutlineSelectionScroll();

    expect(active).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();

    unsubscribeActive();
    requestOutlineSelectionScroll();
    expect(active).toHaveBeenCalledTimes(1);
  });
});
