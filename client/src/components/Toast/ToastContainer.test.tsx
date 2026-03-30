import { render, screen } from "@testing-library/react";
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
});
