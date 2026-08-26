import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BoardPresentationFontScaleControl from "./BoardPresentationFontScaleControl";

describe("BoardPresentationFontScaleControl", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("accumulates a burst of clicks and persists only the final size once", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onChange = jest.fn();
    render(
      <BoardPresentationFontScaleControl value={1} onChange={onChange} />,
    );

    const increase = screen.getByRole("button", {
      name: /Increase presentation text size/i,
    });
    await user.click(increase);
    await user.click(increase);
    await user.click(increase);

    // Readout tracks every click immediately, not just the first.
    expect(screen.getByText("130%")).toBeInTheDocument();

    expect(onChange).not.toHaveBeenCalled();

    // The debounced write lands once, carrying the accumulated size — not a
    // single step, and not one request per click.
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(1.3);
  });

  it("adopts an external value change (live sync) that isn't its own echo", async () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <BoardPresentationFontScaleControl value={1} onChange={onChange} />,
    );
    expect(screen.getByText("100%")).toBeInTheDocument();

    rerender(
      <BoardPresentationFontScaleControl value={1.5} onChange={onChange} />,
    );

    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  it("disables the buttons at the size bounds", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <BoardPresentationFontScaleControl value={2} onChange={onChange} />,
    );
    expect(
      screen.getByRole("button", { name: /Increase presentation text size/i }),
    ).toBeDisabled();

    rerender(
      <BoardPresentationFontScaleControl value={0.5} onChange={onChange} />,
    );
    expect(
      screen.getByRole("button", { name: /Decrease presentation text size/i }),
    ).toBeDisabled();
  });

  it("omits the Reset button in compact size", () => {
    render(
      <BoardPresentationFontScaleControl
        value={1.2}
        onChange={jest.fn()}
        size="compact"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Reset presentation text size/i }),
    ).not.toBeInTheDocument();
  });

  it("omits the Reset button in mini size", () => {
    render(
      <BoardPresentationFontScaleControl
        value={1.2}
        onChange={jest.fn()}
        size="mini"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Reset presentation text size/i }),
    ).not.toBeInTheDocument();
  });

  it("stacks the mini percentage above the buttons", () => {
    render(
      <BoardPresentationFontScaleControl
        value={1.3}
        onChange={jest.fn()}
        size="mini"
      />,
    );

    const readout = screen.getByText("130%");
    const decrease = screen.getByRole("button", {
      name: /Decrease presentation text size/i,
    });
    expect(
      readout.compareDocumentPosition(decrease) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
