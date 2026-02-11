import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import HistorySuggestField from "../HistorySuggestField";

jest.mock("../../ui/Popover", () => {
  const MockAnchor = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-anchor">{children}</div>
  );
  const MockContent = ({
    children,
    "data-history-suggest-content": _dataAttr,
    ...rest
  }: {
    children: React.ReactNode;
    "data-history-suggest-content"?: boolean;
    [key: string]: unknown;
  }) => (
    <div data-testid="popover-content" data-history-suggest-content {...rest}>
      {children}
    </div>
  );
  return {
    Popover: ({
      open,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) => {
      const [anchor, content] = React.Children.toArray(children);
      return (
        <>
          {anchor}
          {open && content}
        </>
      );
    },
    PopoverAnchor: ({ children }: { children: React.ReactNode }) => (
      <MockAnchor>{children}</MockAnchor>
    ),
    PopoverContent: ({
      children,
      align: _align,
      sideOffset: _sideOffset,
      onOpenAutoFocus: _onOpenAutoFocus,
      className: _className,
      ...rest
    }: {
      children: React.ReactNode;
      align?: string;
      sideOffset?: number;
      onOpenAutoFocus?: (e: Event) => void;
      className?: string;
      [key: string]: unknown;
    }) => <MockContent data-history-suggest-content {...rest}>{children}</MockContent>,
  };
});

describe("HistorySuggestField", () => {
  describe("single-line (multiline=false)", () => {
    const historyValues = ["Alice", "Bob", "Carol", "Dave", "Eve"];

    it("shows suggestions when input is focused and empty", () => {
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Name"
            value={value}
            onChange={setValue}
            historyValues={historyValues}
            multiline={false}
          />
        );
      };
      render(<Wrapper />);
      const input = screen.getByRole("textbox", { name: /Name/i });
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
      fireEvent.focus(input);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Carol")).toBeInTheDocument();
    });

    it("limits suggestions to 10 when more than 10 history values", () => {
      const many = Array.from({ length: 15 }, (_, i) => `Item ${i + 1}`);
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Name"
            value={value}
            onChange={setValue}
            historyValues={many}
            multiline={false}
          />
        );
      };
      render(<Wrapper />);
      const input = screen.getByRole("textbox", { name: /Name/i });
      fireEvent.focus(input);
      const listbox = screen.getByRole("listbox");
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(10);
      expect(listbox).toBeInTheDocument();
    });

    it("filters suggestions when typing", () => {
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Name"
            value={value}
            onChange={setValue}
            historyValues={historyValues}
            multiline={false}
          />
        );
      };
      render(<Wrapper />);
      const input = screen.getByRole("textbox", { name: /Name/i });
      fireEvent.focus(input);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      fireEvent.change(input, { target: { value: "Al" } });
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    });

    it("applies suggestion on click and closes list", () => {
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Name"
            value={value}
            onChange={setValue}
            historyValues={historyValues}
            multiline={false}
          />
        );
      };
      render(<Wrapper />);
      const input = screen.getByRole("textbox", { name: /Name/i });
      fireEvent.focus(input);
      fireEvent.mouseDown(screen.getByText("Alice"));
      expect(input).toHaveValue("Alice");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("calls onRemoveHistoryValue when clicking remove on a suggestion", () => {
      const onRemove = jest.fn();
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Name"
            value={value}
            onChange={setValue}
            historyValues={historyValues}
            onRemoveHistoryValue={onRemove}
            multiline={false}
          />
        );
      };
      render(<Wrapper />);
      const input = screen.getByRole("textbox", { name: /Name/i });
      fireEvent.focus(input);
      const removeBtn = screen.getByRole("button", {
        name: /remove "Alice" from history/i,
      });
      fireEvent.mouseDown(removeBtn);
      expect(onRemove).toHaveBeenCalledWith("Alice");
    });

    it("shows suggestions sorted alphabetically", () => {
      const unsorted = ["Zara", "Alice", "Molly"];
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Name"
            value={value}
            onChange={setValue}
            historyValues={unsorted}
            multiline={false}
          />
        );
      };
      render(<Wrapper />);
      const input = screen.getByRole("textbox", { name: /Name/i });
      fireEvent.focus(input);
      const options = screen.getAllByRole("option");
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        "Alice",
        "Molly",
        "Zara",
      ]);
    });
  });

  describe("multiline", () => {
    it("limits line suggestions to 10 when many matches", () => {
      const many = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`);
      const Wrapper = () => {
        const [value, setValue] = useState("");
        return (
          <HistorySuggestField
            label="Text"
            value={value}
            onChange={setValue}
            historyValues={many}
            multiline
          />
        );
      };
      render(<Wrapper />);
      const textarea = screen.getByPlaceholderText("Text");
      fireEvent.focus(textarea);
      fireEvent.change(textarea, { target: { value: "Line" } });
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(10);
    });
  });
});
