import { isMonitorShowingTimerCountdownSlide } from "./monitorTimerPresentation";
import { Presentation } from "../types";

const countdownSlide = {
  boxes: [
    {},
    { words: ["", "{{timer}}"] },
  ],
} as Presentation["slide"];

describe("isMonitorShowingTimerCountdownSlide", () => {
  it("returns true for type timer with {{timer}} slide", () => {
    expect(
      isMonitorShowingTimerCountdownSlide({
        type: "timer",
        slide: countdownSlide,
      } as Presentation)
    ).toBe(true);
  });

  it("returns true for quick-link style type slide with timerId and {{timer}}", () => {
    expect(
      isMonitorShowingTimerCountdownSlide({
        type: "slide",
        timerId: "t1",
        slide: countdownSlide,
      } as Presentation)
    ).toBe(true);
  });

  it("returns false for type slide without timerId even with {{timer}}", () => {
    expect(
      isMonitorShowingTimerCountdownSlide({
        type: "slide",
        slide: countdownSlide,
      } as Presentation)
    ).toBe(false);
  });

  it("returns false without {{timer}} token", () => {
    expect(
      isMonitorShowingTimerCountdownSlide({
        type: "timer",
        slide: { boxes: [{}, { words: ["", "Hello"] }] } as Presentation["slide"],
      } as Presentation)
    ).toBe(false);
  });
});
