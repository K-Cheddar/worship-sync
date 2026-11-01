import { fireEvent, render, screen } from "@testing-library/react";
import SegmentedControl from "./SegmentedControl";

describe("SegmentedControl indicator", () => {
  it("moves and resizes to the selected option without changing selection semantics", () => {
    const left = jest.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return this.textContent === "Longer option" ? 70 : 2;
    });
    const width = jest.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.textContent === "Longer option" ? 120 : 68;
    });
    const height = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    const onChange = jest.fn();
    const options = [{ value: "first", label: "First" }, { value: "second", label: "Longer option" }];
    const view = (value: string) => <SegmentedControl ariaLabel="Example" variant="compact" value={value} onChange={onChange} options={options} />;
    const { rerender } = render(view("first"));
    const indicator = screen.getByTestId("segmented-control-indicator");
    expect(indicator).toHaveStyle({ left: "2px", width: "68px", height: "30px" });
    expect(indicator).toHaveClass("motion-reduce:transition-none", "transition-[left,width]");
    expect(screen.getByRole("button", { name: "First" })).toHaveClass("border-2");
    expect(screen.getByRole("button", { name: "Longer option" })).toHaveClass("border-2");
    fireEvent.click(screen.getByRole("button", { name: "Longer option" }));
    expect(onChange).toHaveBeenCalledWith("second");
    rerender(view("second"));
    expect(indicator).toHaveStyle({ left: "70px", width: "120px" });
    expect(screen.getByRole("button", { name: "Longer option" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "First" })).toHaveClass("border-2");
    expect(screen.getByRole("button", { name: "Longer option" })).toHaveClass("border-2");
    left.mockRestore();
    width.mockRestore();
    height.mockRestore();
  });
});
