import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MediaProviderRetryModal from "./MediaProviderRetryModal";

test("retrying blocks close, Escape and outside dismissal; idle actions still work", async () => {
  const user = userEvent.setup();
  const onDismiss = jest.fn();
  const onRetry = jest.fn();
  const props = { isOpen: true, failedCount: 2, onDismiss, onRetry };
  const view = render(<><button>Outside</button><MediaProviderRetryModal {...props} isRetrying /></>);
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
  await user.keyboard("{Escape}");
  fireEvent.pointerDown(screen.getByText("Outside"));
  expect(onDismiss).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<><button>Outside</button><MediaProviderRetryModal {...props} isRetrying={false} /></>);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(screen.getByText("Outside"));
  await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  await user.keyboard("{Escape}");
  expect(onDismiss).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledTimes(3);
});
