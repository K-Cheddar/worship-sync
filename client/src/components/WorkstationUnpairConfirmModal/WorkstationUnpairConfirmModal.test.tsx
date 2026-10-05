import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkstationUnpairConfirmModal from "./WorkstationUnpairConfirmModal";

test("busy unlink keeps the standard close visible and disabled without changing confirmation", async () => {
  const user = userEvent.setup();
  const onClose = jest.fn();
  const onConfirm = jest.fn();
  const props = { isOpen: true, onClose, onConfirm };
  const view = render(<><button>Outside</button><WorkstationUnpairConfirmModal {...props} isConfirming /></>);
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Unlink" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
  await user.keyboard("{Escape}");
  fireEvent.pointerDown(screen.getByText("Outside"));
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  view.rerender(<WorkstationUnpairConfirmModal {...props} />);
  await user.click(screen.getByRole("button", { name: "Unlink" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
});
