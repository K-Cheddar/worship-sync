import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RichTextEditor from "./RichTextEditor";
import { plainTextToRichText } from "../../types/richText";
import type { RichTextDocument } from "../../types/richText";

const makeMatchMedia = (matches: boolean): typeof window.matchMedia =>
  ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;

describe("RichTextEditor", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Default to the compact (mobile) toolbar unless a test opts into desktop.
    window.matchMedia = makeMatchMedia(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

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

  it("emits edited content immediately as a RichTextDocument", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <RichTextEditor label="Title" value={{ blocks: [] }} onChange={handleChange} />,
    );
    const editable = screen.getByRole("textbox", { name: "Title" });

    await user.click(editable);
    await user.keyboard("Great Are You Lord");

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "Great Are You Lord" }] }],
      } satisfies RichTextDocument),
    );
  });

  it("does not re-render the DOM from a prop value that matches what it just emitted", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    const { rerender } = render(
      <RichTextEditor label="Title" value={{ blocks: [] }} onChange={handleChange} />,
    );
    const editable = screen.getByRole("textbox", { name: "Title" });
    await user.click(editable);
    await user.keyboard("Typed live");
    await waitFor(() => expect(handleChange).toHaveBeenCalled());
    const emitted = handleChange.mock.calls.at(-1)?.[0];

    // Parent re-renders with exactly the value we just emitted (as a fresh
    // object, since Redux/useState always produce a new reference).
    rerender(
      <RichTextEditor label="Title" value={{ ...emitted }} onChange={handleChange} />,
    );

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveTextContent(
      "Typed live",
    );
  });

  it("keeps live text when a normalized autosave echo arrives while focused", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    const { rerender } = render(
      <RichTextEditor
        label="Notes"
        value={{
          blocks: [
            { type: "paragraph", spans: [{ text: "Keep typing" }] },
            { type: "paragraph", spans: [{ text: " " }] },
          ],
        }}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    await user.click(editable);
    expect(editable).toHaveFocus();

    // Server normalize turns space-only paragraphs into spans: [].
    rerender(
      <RichTextEditor
        label="Notes"
        value={{
          blocks: [
            { type: "paragraph", spans: [{ text: "Keep typing" }] },
            { type: "paragraph", spans: [] },
          ],
        }}
        onChange={handleChange}
      />,
    );

    expect(editable).toHaveFocus();
    expect(editable).toHaveTextContent("Keep typing");
  });

  it("applies a genuinely external value update", () => {
    const { rerender } = render(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("Before")}
        onChange={jest.fn()}
      />,
    );

    rerender(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("After")}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveTextContent(
      "After",
    );
  });

  it("turns dash input into a bullet and Tab nests the next item", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={{ blocks: [] }}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });

    await user.click(editable);
    await user.keyboard("- Parent{Enter}Child{Tab}");

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [
          { type: "list-item", spans: [{ text: "Parent" }] },
          { type: "list-item", indent: 1, spans: [{ text: "Child" }] },
        ],
      }),
    );
  });

  it("turns numbered input into an ordered list", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={{ blocks: [] }}
        onChange={handleChange}
      />,
    );

    await user.click(screen.getByRole("textbox", { name: "Notes" }));
    await user.keyboard("1. First{Enter}Second");

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [
          {
            type: "list-item",
            listStyle: "ordered",
            spans: [{ text: "First" }],
          },
          {
            type: "list-item",
            listStyle: "ordered",
            spans: [{ text: "Second" }],
          },
        ],
      }),
    );
  });

  it("supports keyboard undo without waiting for blur", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={{ blocks: [] }}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });

    await user.click(editable);
    await user.keyboard("A");
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "A" }] }],
      }),
    );
    await user.keyboard("{Control>}z{/Control}");

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({ blocks: [] }),
    );
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "A" }] }],
      }),
    );
  });

  it("sanitizes pasted HTML to the supported schema", async () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={{ blocks: [] }}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.focus(editable);

    fireEvent.paste(editable, {
      clipboardData: {
        files: [],
        items: [],
        types: ["text/html", "text/plain"],
        getData: (type: string) =>
          type === "text/html"
            ? '<p>Safe <a href="https://bad.test">link</a><img src="bad"></p>'
            : "Safe link",
      },
    });

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{
          type: "paragraph",
          spans: [{ text: "Safe link" }],
        }],
      }),
    );
  });

  it("pastes public contrast-chip HTML as the authored hue, not ink", async () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={{ blocks: [] }}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.focus(editable);

    // Public chips rewrite style.color to white/black and keep the hue only
    // as background (and, after the fix, also as data-rich-text-color).
    fireEvent.paste(editable, {
      clipboardData: {
        files: [],
        items: [],
        types: ["text/html", "text/plain"],
        getData: (type: string) =>
          type === "text/html"
            ? '<p><span style="color: #ffffff; background-color: #000000;">Black cue</span></p>'
            : "Black cue",
      },
    });

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{
          type: "paragraph",
          spans: [{ text: "Black cue", color: "#000000" }],
        }],
      }),
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
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More formatting" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /text color/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveClass(
      "select-text",
      "cursor-text",
    );
  });

  it("offers undo, emphasis, lists, and color as primary note toolbar controls", () => {
    // Compact toolbar prioritizes the actions operators use most when writing
    // service cues: undo mistakes, bold a cue, bullet a checklist, color a
    // warning. Size, italic, underline, numbered lists, and alignment stay in More.
    render(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("Welcome")}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulleted list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text color" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More formatting" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Italic" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Text size" })).not.toBeInTheDocument();
  });

  it("reflects the selected text's authored color in the picker control", async () => {
    const user = userEvent.setup();
    render(
      <RichTextEditor
        label="Notes"
        value={{
          blocks: [
            {
              type: "paragraph",
              spans: [{ text: "Gray", color: "#666666" }],
            },
          ],
        }}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByText("Gray"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Text color" })).toHaveStyle({
        borderColor: "#666666",
      }),
    );
  });

  it("keeps the text color picker open while applying a color", async () => {
    // Regression: TipTap defers focus() to rAF. Calling focus on every color
    // sample used to dismiss the Radix popover before the operator could drag.
    window.matchMedia = makeMatchMedia(true);
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Colored")}
        onChange={handleChange}
      />,
    );

    await user.tripleClick(screen.getByText("Colored"));
    await user.click(screen.getByRole("button", { name: "Text color" }));
    expect(
      screen.getByRole("button", { name: "Close popover" }),
    ).toBeInTheDocument();

    const notes = screen.getByRole("textbox", { name: "Notes" });
    const pickerInput = screen
      .getAllByRole("textbox")
      .find((el) => el !== notes);
    expect(pickerInput).toBeTruthy();
    fireEvent.change(pickerInput!, { target: { value: "#ef4444" } });

    // TipTap focus is async (rAF); color apply is also debounced (~80ms).
    expect(
      await screen.findByRole("button", { name: "Close popover" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(handleChange).toHaveBeenCalled());
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: [
          expect.objectContaining({
            spans: [expect.objectContaining({ color: "#ef4444" })],
          }),
        ],
      }),
    );
  });

  it("shows the full formatting toolbar on desktop widths", () => {
    window.matchMedia = makeMatchMedia(true);
    render(
      <RichTextEditor
        label="Title"
        value={plainTextToRichText("Welcome")}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulleted list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Numbered list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Align center" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text size" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text color" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More formatting" }),
    ).not.toBeInTheDocument();
  });

  it("undoes and redoes from the toolbar without waiting for blur", async () => {
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={{ blocks: [] }}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.focus(editable);

    // Seed TipTap history the same way the keyboard-undo test does.
    const user = userEvent.setup();
    await user.click(editable);
    await user.keyboard("A");
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "A" }] }],
      }),
    );

    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({ blocks: [] }),
    );

    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "A" }] }],
      }),
    );
  });

  it("toggles the selected block between a bullet and a paragraph", async () => {
    window.matchMedia = makeMatchMedia(true);
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Remember this")}
        onChange={handleChange}
      />,
    );
    fireEvent.focus(screen.getByRole("textbox", { name: "Notes" }));

    const listButton = screen.getByRole("button", { name: "Bulleted list" });
    expect(listButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.mouseDown(listButton);
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "list-item", spans: [{ text: "Remember this" }] }],
      }),
    );
    expect(
      screen.getByRole("button", { name: "Bulleted list" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseDown(screen.getByRole("button", { name: "Bulleted list" }));
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "Remember this" }] }],
      }),
    );
  });

  it("aligns the selected block, storing left as no alignment", async () => {
    window.matchMedia = makeMatchMedia(true);
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Centered line")}
        onChange={handleChange}
      />,
    );
    fireEvent.focus(screen.getByRole("textbox", { name: "Notes" }));

    fireEvent.mouseDown(screen.getByRole("button", { name: "Align center" }));
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [
          { type: "paragraph", align: "center", spans: [{ text: "Centered line" }] },
        ],
      }),
    );
    expect(screen.getByRole("button", { name: "Align center" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Align left" }));
    // Back to the default, which the model represents as no `align` at all.
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "Centered line" }] }],
      }),
    );
  });

  it("sets the selected block's size, storing normal as no size", async () => {
    window.matchMedia = makeMatchMedia(true);
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Headline")}
        onChange={handleChange}
      />,
    );
    fireEvent.focus(screen.getByRole("textbox", { name: "Notes" }));

    // The trigger is a Radix popover — it opens on click, while the
    // mousedown handler is what preserves the selection.
    fireEvent.mouseDown(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.mouseDown(await screen.findByRole("button", { name: "Large" }));
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", size: "large", spans: [{ text: "Headline" }] }],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "Normal" }));
    // Back to the default, which the model represents as no `size` at all.
    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", spans: [{ text: "Headline" }] }],
      }),
    );
  });

  it("applies a popover command after its trigger moves focus", async () => {
    window.matchMedia = makeMatchMedia(true);
    const handleChange = jest.fn();
    render(
      <RichTextEditor
        label="Notes"
        value={plainTextToRichText("Headline")}
        onChange={handleChange}
      />,
    );
    const editable = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.focus(editable);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.mouseDown(await screen.findByRole("button", { name: "Large" }));

    await waitFor(() =>
      expect(handleChange).toHaveBeenLastCalledWith({
        blocks: [{ type: "paragraph", size: "large", spans: [{ text: "Headline" }] }],
      }),
    );
    // The toolbar must reflect it too, rather than snapping back to Normal.
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    expect(await screen.findByRole("button", { name: "Large" })).toHaveAttribute(
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
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More formatting" }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More formatting" }),
    ).toBeInTheDocument();
  });
});
