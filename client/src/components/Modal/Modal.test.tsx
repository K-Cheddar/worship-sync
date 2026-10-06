import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";
import FloatingWindow from "../FloatingWindow/FloatingWindow";
import { FloatingWindowZIndexProvider } from "../FloatingWindow/FloatingWindowZIndexContext";
import Select from "../Select/Select";

const DialogExample = ({ busy = false, onCloseAutoFocus }: { busy?: boolean; onCloseAutoFocus?: ComponentProps<typeof Modal>["onCloseAutoFocus"] }) => {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open review</button>
    <button type="button">Outside target</button>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Review" description="Review this action." busy={busy} onCloseAutoFocus={onCloseAutoFocus}>
      <button type="button">First action</button>
      <button type="button">Last action</button>
    </Modal>
  </>;
};

test("traps keyboard focus, dismisses with Escape and restores the opener", async () => {
  const user = userEvent.setup();
  render(<DialogExample />);
  const trigger = screen.getByRole("button", { name: "Open review" });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "Review" })).toHaveAccessibleDescription("Review this action.");
  expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Last action" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("restores the opener when a close-focus callback observes the event", async () => {
  const user = userEvent.setup();
  const onCloseAutoFocus = jest.fn();
  render(<DialogExample onCloseAutoFocus={onCloseAutoFocus} />);
  const trigger = screen.getByRole("button", { name: "Open review" });
  await user.click(trigger);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("respects a close-focus callback that prevents default", async () => {
  const user = userEvent.setup();
  const onCloseAutoFocus = jest.fn((event: Parameters<NonNullable<ComponentProps<typeof Modal>["onCloseAutoFocus"]>>[0]) => {
    event.preventDefault();
    screen.getByRole("button", { name: "Outside target" }).focus();
  });
  render(<DialogExample onCloseAutoFocus={onCloseAutoFocus} />);
  const trigger = screen.getByRole("button", { name: "Open review" });
  await user.click(trigger);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Outside target" })).toHaveFocus();
  expect(trigger).not.toHaveFocus();
});

test("busy blocks close, Escape and outside dismissal", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<DialogExample busy />);
  const outside = screen.getByRole("button", { name: "Outside target" });
  await user.click(screen.getByRole("button", { name: "Open review" }));
  expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
  await user.keyboard("{Escape}");
  fireEvent.pointerDown(outside);
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  rerender(<DialogExample />);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("headerless full-screen dialogs use their supplied accessible name", () => {
  render(<Modal isOpen onClose={jest.fn()} ariaLabel="Photo from Alex" description="Shared photo" size="full" showCloseButton={false}>Photo</Modal>);
  expect(screen.getByRole("dialog", { name: "Photo from Alex" })).toHaveAccessibleDescription("Shared photo");
});

test("confirmation disables duplicate actions while busy", () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<ConfirmDialog open title="Remove guest?" description="Remove this guest from the schedule." confirmLabel="Removing…" destructive busy onConfirm={onConfirm} onCancel={onCancel} />);
  expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Removing…" }));
  expect(onConfirm).not.toHaveBeenCalled();
});

test("dialogs inherit independent floating-window hosts and restore focus", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<FloatingWindowZIndexProvider>
    <FloatingWindow title="First window" onClose={jest.fn()}><DialogExample /></FloatingWindow>
    <FloatingWindow title="Second window" onClose={jest.fn()}><DialogExample /></FloatingWindow>
  </FloatingWindowZIndexProvider>);
  const triggers = screen.getAllByRole("button", { name: "Open review" });
  const hosts = screen.getAllByTestId("floating-window-overlay-host");
  await user.click(triggers[0]);
  expect(within(hosts[0]).getByRole("dialog", { name: "Review" })).toBeInTheDocument();
  expect(within(hosts[1]).queryByRole("dialog")).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(triggers[0]).toHaveFocus());
  await user.click(triggers[1]);
  expect(within(hosts[1]).getByRole("dialog", { name: "Review" })).toBeInTheDocument();
  expect(within(hosts[0]).queryByRole("dialog")).not.toBeInTheDocument();
  unmount();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByTestId("floating-window-overlay-host")).not.toBeInTheDocument();
});

test("only the upper confirmation dismisses on Escape", async () => {
  const user = userEvent.setup();
  const Nested = () => {
    const [open, setOpen] = useState(false);
    return <Modal isOpen onClose={jest.fn()} title="Editor">
      <button type="button" onClick={() => setOpen(true)}>Delete</button>
      <ConfirmDialog open={open} title="Delete item?" description="Review deletion." confirmLabel="Delete item" zIndexLevel={2} onConfirm={jest.fn()} onCancel={() => setOpen(false)} />
    </Modal>;
  };
  render(<Nested />);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.getByRole("dialog", { name: "Delete item?" })).toHaveClass("z-[55]");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Delete item?" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Editor" })).toBeInTheDocument();
});

test("page dialogs own nested select portals above the floating-window dock", async () => {
  const user = userEvent.setup();
  const Example = () => {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("first");
    return <FloatingWindowZIndexProvider>
      <FloatingWindow title="Tools" onClose={jest.fn()}>Window tools</FloatingWindow>
      <button onClick={() => setOpen(true)}>Open page dialog</button>
      <Modal isOpen={open} title="Page dialog" onClose={() => setOpen(false)}>
        <Select label="Choice" value={value} onChange={setValue} options={[{ value: "first", label: "First" }, { value: "second", label: "Second" }]} />
      </Modal>
    </FloatingWindowZIndexProvider>;
  };
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open page dialog" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Page dialog" });
  const host = screen.getByTestId("modal-overlay-host");
  expect(within(host).getByRole("dialog", { name: "Page dialog" })).toBe(dialog);
  expect(host).toHaveStyle({ zIndex: 10001 });
  await user.click(screen.getByRole("combobox", { name: "Choice:" }));
  await user.click(within(host).getByRole("option", { name: "Second" }));
  expect(screen.getByRole("combobox")).toHaveTextContent("Second");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("supports contained scrolling while preserving the modal viewport cap", () => {
  render(
    <Modal isOpen onClose={jest.fn()} title="Upload files" contentClassName="flex flex-col overflow-hidden">
      <div role="region" aria-label="Selected files" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">
        Selected files
      </div>
    </Modal>,
  );
  const content = screen.getByTestId("modal-content");
  expect(content).toHaveClass("flex", "flex-col", "overflow-hidden");
  expect(content).not.toHaveClass("overflow-y-auto");
  expect(screen.getByRole("dialog", { name: "Upload files" })).toHaveClass("max-h-[90vh]");
});