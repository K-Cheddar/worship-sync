import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServiceItem } from "../../types";
import OutlineRevisionReview from "./OutlineRevisionReview";
import { createOutlineMoveIntent } from "../../utils/outlineSync";

const row = (listId: string, name: string): ServiceItem => ({ _id: `item-${listId}`, listId, name, type: "song" });
const base = [row("a", "Welcome"), row("b", "Scripture")];
const local = [{ ...base[0], name: "Welcome A" }, { ...base[1], name: "Scripture A" }];
const remote = [{ ...base[0], name: "Welcome B" }, base[1], row("c", "Closing Song")];
const conflict = { baselineItems: base, localItems: local, remoteItems: remote };

it.each(["My", "Saved"])("reviews only overlapping fields and preserves compatible edits using %s edit", async (side) => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  render(<OutlineRevisionReview conflict={conflict} draft={local} onSave={onSave} isOpen onClose={() => undefined} />);
  expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
  expect(screen.queryByText("Closing Song")).not.toBeInTheDocument();
  expect(screen.queryByText("Scripture A")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: new RegExp(`^${side} edit:`) }));
  await user.click(screen.getByRole("button", { name: "Save choices" }));
  expect(onSave).toHaveBeenCalledWith([
    { ...base[0], name: side === "My" ? "Welcome A" : "Welcome B" }, local[1], remote[2],
  ]);
});

it("reviews delete versus edit without rendering media metadata", async () => {
  const user = userEvent.setup(); const onSave = jest.fn();
  render(<OutlineRevisionReview conflict={{ ...conflict, remoteItems: [{ ...remote[0], background: "https://private/media", localImage: { id: "asset-secret", ownerDeviceId: "device", ownerLabel: "Device", fileName: "private.jpg", contentType: "image/jpeg", storagePolicy: "local-only" } }, base[1]] }} draft={[base[1]]} onSave={onSave} isOpen onClose={() => undefined} />);
  expect(screen.queryByText(/private|asset-secret/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "My edit: Remove this row" }));
  await user.click(screen.getByRole("button", { name: "Save choices" }));
  expect(onSave).toHaveBeenCalledWith([base[1]]);
});

it("shows a focused move-versus-delete choice with destinations", async () => {
  const user = userEvent.setup(); const onSave = jest.fn();
  const draft = [base[1], base[0]];
  const intent = createOutlineMoveIntent({ outlineId: "outline", ownerKey: "owner",
    resultingItems: draft, movedIds: [base[1].listId] })!;
  const moveConflict = { baselineItems: base, localItems: draft, remoteItems: [base[0]], moveIntents: [intent] };
  render(<OutlineRevisionReview conflict={moveConflict} draft={draft} onSave={onSave} isOpen onClose={() => undefined} />);

  expect(screen.getByText("Original: after Welcome.")).toBeVisible();
  expect(screen.getByText("My change: Move Scripture before Welcome.")).toBeVisible();
  expect(screen.getByText("Saved change: Remove Scripture.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep saved change: Remove Scripture" }));
  await user.click(screen.getByRole("button", { name: "Save choices" }));
  expect(onSave).toHaveBeenCalledWith([base[0]]);
});

it("reviews replaced rows before allowing a whole current-outline choice", async () => {
  const user = userEvent.setup(); const onSave = jest.fn();
  const draft = [row("new-a", "Local replacement")];
  const saved = [row("new-b", "Remote replacement")];
  render(<OutlineRevisionReview conflict={{ baselineItems: base, localItems: draft, remoteItems: saved }} draft={draft} onSave={onSave} isOpen onClose={() => undefined} />);
  expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "My draft" }));
  expect(screen.getByLabelText("Changes to discard")).toHaveTextContent("Remote replacement");
  await user.click(screen.getByRole("button", { name: "Save choices" }));
  expect(onSave).toHaveBeenCalledWith(draft);
});

it("resets choices for new edits and prevents duplicate pending saves", async () => {
  const user = userEvent.setup(); const onSave = jest.fn();
  const { rerender } = render(<OutlineRevisionReview conflict={conflict} draft={local} onSave={onSave} isOpen onClose={() => undefined} />);
  await user.click(screen.getByRole("button", { name: /^My edit:/ }));
  rerender(<OutlineRevisionReview conflict={conflict} draft={[...local, row("new", "New row")]} onSave={onSave} isOpen onClose={() => undefined} />);
  expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
  rerender(<OutlineRevisionReview conflict={{ ...conflict, resolutionChoice: "keep-local" }} draft={local} onSave={onSave} isOpen onClose={() => undefined} />);
  expect(screen.getByRole("button", { name: "Saving choices" })).toBeDisabled();
  expect(screen.getByRole("region", { name: "Outline conflict decisions" })).toHaveAttribute("aria-busy", "true");
  expect(onSave).not.toHaveBeenCalled();
});

it("shows changed positions for a genuine competing order decision", async () => {
  const user = userEvent.setup(); const onSave = jest.fn();
  const third = row("c", "Prayer"); const baseline = [...base, third];
  const draft = [base[1], base[0], third]; const saved = [base[0], third, base[1]];
  render(<OutlineRevisionReview conflict={{ baselineItems: baseline, localItems: draft, remoteItems: saved }} draft={draft} onSave={onSave} isOpen onClose={() => undefined} />);
  expect(screen.getByText(/no recorded drag destination/)).toBeVisible();
  expect(screen.getByText(/My order: Scripture/)).toBeVisible();
  expect(screen.getByText(/Saved order: Welcome/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep saved order" }));
  await user.click(screen.getByRole("button", { name: "Save choices" }));
  expect(onSave).toHaveBeenCalledWith(saved);
});
