import { render, screen, within } from "@testing-library/react";
import ToastContainer from "./ToastContainer";

describe("ToastContainer", () => {
  it("groups toasts by position and renders function children with toast id", () => {
    const onRemove = jest.fn();

    render(
      <ToastContainer
        toasts={[
          {
            id: "a",
            message: "Top",
            position: "top-center",
          },
          {
            id: "b",
            position: "bottom-right",
            children: (toastId) => <span data-testid="fn-child">{toastId}</span>,
          },
        ]}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("Top")).toBeInTheDocument();
    expect(screen.getByTestId("fn-child")).toHaveTextContent("b");
    expect(screen.getByTestId("toast-group-top-center")).toBeInTheDocument();
    expect(screen.getByTestId("toast-group-bottom-right")).toBeInTheDocument();
  });

  it("defaults position to top-center when omitted", () => {
    render(
      <ToastContainer
        toasts={[{ id: "only", message: "Hello" }]}
        onRemove={jest.fn()}
      />,
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByTestId("toast-group-top-center")).toBeInTheDocument();
  });

  it("stacks toasts in a readable column with newest closest to the edge", () => {
    render(
      <ToastContainer
        toasts={[
          { id: "older", message: "Older", position: "top-center" },
          { id: "newer", message: "Newer", position: "top-center" },
        ]}
        onRemove={jest.fn()}
      />,
    );

    const group = screen.getByTestId("toast-group-top-center");
    expect(group).toHaveClass("flex", "flex-col", "gap-2");

    const statuses = within(group).getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveTextContent("Newer");
    expect(statuses[1]).toHaveTextContent("Older");
  });

  it("keeps every stacked toast visible and actionable", () => {
    render(
      <ToastContainer
        toasts={[
          { id: "older", message: "Older", position: "top-center" },
          { id: "newer", message: "Newer", position: "top-center" },
        ]}
        onRemove={jest.fn()}
      />,
    );

    const group = screen.getByTestId("toast-group-top-center");
    const statuses = within(group).getAllByRole("status");
    const closeButtons = within(group).getAllByRole("button", {
      name: "Close toast",
    });

    expect(statuses).toHaveLength(2);
    expect(closeButtons).toHaveLength(2);
  });
});
