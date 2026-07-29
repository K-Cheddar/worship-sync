import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanScripturePopover from "./ServicePlanScripturePopover";

describe("ServicePlanScripturePopover", () => {
  it("attaches a parsed scripture reference", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<ServicePlanScripturePopover onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Add scripture/i }));
    await user.type(screen.getByLabelText(/Scripture reference/i), "John 3:16-18");
    await user.click(screen.getByRole("button", { name: /Attach scripture/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        book: "John",
        chapter: "3",
        verseRange: "16-18",
      }),
    );
  });

  it("won't attach text that isn't a scripture reference", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<ServicePlanScripturePopover onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Add scripture/i }));
    await user.type(screen.getByLabelText(/Scripture reference/i), "not a reference");

    expect(
      await screen.findByText(/doesn't look like a scripture reference/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Attach scripture/i })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
