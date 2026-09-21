import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanScripturePopover from "./ServicePlanScripturePopover";

describe("ServicePlanScripturePopover", () => {
  it("attaches a parsed scripture reference", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<ServicePlanScripturePopover onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Add scripture/i }));
    await user.type(screen.getByLabelText(/Scripture reference/i), "John 3:16-18");

    expect(within(screen.getByRole("group", { name: "book" })).getByRole("button", { name: "John" })).toHaveClass("bg-gray-900");
    expect(within(screen.getByRole("group", { name: "chapter" })).getByRole("button", { name: "3" })).toHaveClass("bg-gray-900");
    expect(within(screen.getByRole("group", { name: "Start" })).getByRole("button", { name: "16" })).toHaveClass("bg-gray-900");
    expect(within(screen.getByRole("group", { name: "End" })).getByRole("button", { name: "18" })).toHaveClass("bg-gray-900");
    await user.click(screen.getByRole("button", { name: /Attach scripture/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        book: "John",
        chapter: "3",
        verseRange: "16-18",
      }),
    );
    expect(screen.getByRole("button", { name: /Add scripture/i })).toBeInTheDocument();
  });

  it("shows an attaching state and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let resolveAttach: (() => void) | undefined;
    const onSelect = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAttach = resolve;
        }),
    );
    render(<ServicePlanScripturePopover onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Add scripture/i }));
    await user.type(screen.getByLabelText(/Scripture reference/i), "John 3:16");
    await user.click(screen.getByRole("button", { name: /Attach scripture/i }));

    const pendingButton = screen.getByRole("button", {
      name: /Attaching scripture\.\.\./i,
    });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    await user.click(pendingButton);
    expect(onSelect).toHaveBeenCalledTimes(1);

    resolveAttach?.();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add scripture/i })).toBeInTheDocument();
    });
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

  it("builds a scripture reference from the controller passage picker", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<ServicePlanScripturePopover onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Add scripture/i }));
    await user.click(within(screen.getByRole("group", { name: "book" })).getByRole("button", { name: "John" }));
    await user.click(within(screen.getByRole("group", { name: "Start" })).getByRole("button", { name: "16" }));
    await user.click(within(screen.getByRole("group", { name: "End" })).getByRole("button", { name: "18" }));
    await user.click(screen.getByRole("button", { name: /Attach scripture/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        book: "John",
        chapter: "1",
        verseRange: "16-18",
      }),
    );
  });

  it("can be cancelled without attaching", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<ServicePlanScripturePopover onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Add scripture/i }));
    await user.type(screen.getByLabelText(/Scripture reference/i), "John 3:16");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: /Add scripture/i })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
