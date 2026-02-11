import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CreditHistoryTextArea from "../CreditHistoryTextArea";

describe("CreditHistoryTextArea", () => {
  const historyLines = ["Alice", "Bob", "Carol"];

  const renderWithState = (initialValue = "") => {
    const Wrapper = () => {
      const [value, setValue] = useState(initialValue);
      return (
        <CreditHistoryTextArea
          value={value}
          onChange={setValue}
          historyLines={historyLines}
        />
      );
    };

    return render(<Wrapper />);
  };

  it("does not show suggestions when the current line is empty", () => {
    renderWithState("");

    const textarea = screen.getByPlaceholderText("Text");
    // Ensure no suggestions are shown initially
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();

    // Clicking into the textarea with empty value should still not show suggestions
    fireEvent.click(textarea);
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("shows filtered suggestions only after typing at least one character on the current line", () => {
    renderWithState("");

    const textarea = screen.getByPlaceholderText("Text");
    fireEvent.focus(textarea);
    // Type a single character
    fireEvent.change(textarea, { target: { value: "A" } });

    // Now suggestions should be visible and filtered by "A"
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // "Bob" should not match "A"
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("does not select a suggestion until the user presses arrow keys, then applies it with Enter", () => {
    renderWithState("");

    const textarea = screen.getByPlaceholderText("Text");
    fireEvent.focus(textarea);
    // Type "Al" so "Alice" is suggested
    fireEvent.change(textarea, { target: { value: "Al" } });
    expect(screen.getByText("Alice")).toBeInTheDocument();

    const listItems = screen.getAllByRole("option");
    expect(listItems).toHaveLength(1);
    const aliceListItem = listItems[0];
    // Initially, no suggestion list item should have the active (bg-gray-700) class
    expect(aliceListItem).not.toHaveClass("bg-gray-700");

    // Press ArrowDown to move selection to the first suggestion
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(aliceListItem).toHaveClass("bg-gray-700");

    // Press Enter to apply the active suggestion
    fireEvent.keyDown(textarea, { key: "Enter" });

    // After applying, the textarea value should be exactly "Alice"
    expect((textarea as HTMLTextAreaElement).value).toBe("Alice");
  });

  it("calls onRemoveHistoryLine when clicking the X on a suggestion", () => {
    const onRemoveHistoryLine = jest.fn();

    const Wrapper = () => {
      const [value, setValue] = useState("");
      return (
        <CreditHistoryTextArea
          value={value}
          onChange={setValue}
          historyLines={historyLines}
          onRemoveHistoryLine={onRemoveHistoryLine}
        />
      );
    };

    render(<Wrapper />);

    const textarea = screen.getByPlaceholderText("Text");
    fireEvent.focus(textarea);
    // Type "Al" so "Alice" is suggested
    fireEvent.change(textarea, { target: { value: "Al" } });

    // Suggestion appears with an X button
    expect(screen.getByText("Alice")).toBeInTheDocument();
    const removeButton = screen.getByRole("button", {
      name: /remove "Alice" from history/i,
    });

    fireEvent.mouseDown(removeButton);

    expect(onRemoveHistoryLine).toHaveBeenCalledWith("Alice");
  });
});

