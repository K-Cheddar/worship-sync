import { render, screen, fireEvent } from "@testing-library/react";
import RichTextEditor from "./RichTextEditor";
import { plainTextToRichText } from "../../types/richText";
import type { RichTextDocument } from "../../types/richText";

describe("RichTextEditor", () => {
  it("renders the initial value's text", () => {
    render(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("Welcome everyone")}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveTextContent(
      "Welcome everyone",
    );
  });

  it("shows a placeholder when empty and not focused", () => {
    render(
      <RichTextEditor
        label="Notes"
        hideLabel
        value={{ blocks: [] }}
        onChange={jest.fn()}
        placeholder="Add notes…"
      />,
    );
    expect(screen.getByText("Add notes…")).toBeInTheDocument();
  });

  it("hides the placeholder while focused", () => {
    render(
      <RichTextEditor
        label="Notes"
        hideLabel
        value={{ blocks: [] }}
        onChange={jest.fn()}
        placeholder="Add notes…"
      />,
    );
    fireEvent.focus(screen.getByRole("textbox", { name: "Notes" }));
    expect(screen.queryByText("Add notes…")).not.toBeInTheDocument();
  });

  it("commits the edited content as a RichTextDocument on blur", () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor label="Title" value={{ blocks: [] }} onChange={handleChange} />,
    );
    const editable = screen.getByRole("textbox", { name: "Title" });

    // Simulate the browser having inserted text while the user typed (jsdom
    // doesn't implement real contentEditable text insertion, so we mutate the
    // DOM directly the way a real edit would leave it, then blur — exercising
    // the same read-DOM-on-blur code path a real edit triggers).
    editable.textContent = "Great Are You Lord";
    fireEvent.blur(editable);

    expect(handleChange).toHaveBeenCalledWith({
      blocks: [{ type: "paragraph", spans: [{ text: "Great Are You Lord" }] }],
    } satisfies RichTextDocument);
  });

  it("does not re-render the DOM from a prop value that matches what it just emitted", () => {
    const handleChange = jest.fn();
    const { rerender } = render(
      <RichTextEditor label="Title" value={{ blocks: [] }} onChange={handleChange} />,
    );
    const editable = screen.getByRole("textbox", { name: "Title" });
    editable.textContent = "Typed live";
    fireEvent.blur(editable);
    const emitted = handleChange.mock.calls[0][0];

    // Parent re-renders with exactly the value we just emitted (as a fresh
    // object, since Redux/useState always produce a new reference).
    rerender(
      <RichTextEditor label="Title" value={{ ...emitted }} onChange={handleChange} />,
    );

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveTextContent(
      "Typed live",
    );
  });

  it("hides the formatting toolbar and disables editing when disabled", () => {
    render(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("Locked")}
        onChange={jest.fn()}
        disabled
      />,
    );
    expect(screen.queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /text color/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
  });

  it("offers a text color picker alongside bold/italic/underline", () => {
    render(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("Welcome")}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Text color" })).toBeInTheDocument();
  });

  /**
   * Block commands don't go through execCommand (which jsdom lacks anyway) —
   * they mutate the block elements directly, so these exercise the real code
   * path rather than a stub.
   */
  const selectInside = (editable: HTMLElement) => {
    // Selecting the editable's whole contents reaches every block inside it,
    // which is what the block commands operate on.
    const range = document.createRange();
    range.selectNodeContents(editable);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  it("toggles the selected block between a bullet and a paragraph", () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Remember this")}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    selectInside(editable);

    const listButton = screen.getByRole("button", { name: "Bulleted list" });
    expect(listButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.mouseDown(listButton);
    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [{ type: "list-item", spans: [{ text: "Remember this" }] }],
    });
    expect(
      screen.getByRole("button", { name: "Bulleted list" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseDown(screen.getByRole("button", { name: "Bulleted list" }));
    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [{ type: "paragraph", spans: [{ text: "Remember this" }] }],
    });
  });

  it("aligns the selected block, storing left as no alignment", () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Centered line")}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    selectInside(editable);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Align center" }));
    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [
        { type: "paragraph", align: "center", spans: [{ text: "Centered line" }] },
      ],
    });
    expect(screen.getByRole("button", { name: "Align center" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Align left" }));
    // Back to the default, which the model represents as no `align` at all.
    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [{ type: "paragraph", spans: [{ text: "Centered line" }] }],
    });
  });

  it("sets the selected block's size, storing normal as no size", async () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Headline")}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    selectInside(editable);

    // The trigger is a Radix popover — it opens on click, while the
    // mousedown handler is what preserves the selection.
    fireEvent.mouseDown(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.mouseDown(await screen.findByRole("button", { name: "Large" }));
    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [{ type: "paragraph", size: "large", spans: [{ text: "Headline" }] }],
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Normal" }));
    // Back to the default, which the model represents as no `size` at all.
    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [{ type: "paragraph", spans: [{ text: "Headline" }] }],
    });
  });

  it("still applies a popover command after the popover clears the live selection", async () => {
    // Regression: opening a popover moves focus, and a real browser drops the
    // contentEditable's selection when it does — so the command found no
    // blocks and silently did nothing. jsdom keeps the selection, so the lost
    // selection is simulated explicitly here.
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Headline")}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    selectInside(editable);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Text size" }));
    fireEvent.blur(editable);
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    window.getSelection()?.removeAllRanges();

    fireEvent.mouseDown(await screen.findByRole("button", { name: "Large" }));

    expect(handleChange).toHaveBeenLastCalledWith({
      blocks: [{ type: "paragraph", size: "large", spans: [{ text: "Headline" }] }],
    });
    // The toolbar must reflect it too, rather than snapping back to Normal.
    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hides list and alignment controls when disabled", () => {
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Locked")}
        onChange={jest.fn()}
        disabled
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Bulleted list" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Align center" }),
    ).not.toBeInTheDocument();
  });

  it("keeps toolbar leading and trailing on the same row as formatting controls", () => {
    render(
      <RichTextEditor
        label="Notes"
        hideLabel
        value={plainTextToRichText("Hello")}
        onChange={jest.fn()}
        toolbarLeading={<span>Notes heading</span>}
        toolbarTrailing={
          <button type="button" aria-label="Remove note">
            Remove
          </button>
        }
      />,
    );
    expect(screen.getByText("Notes heading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });
});
