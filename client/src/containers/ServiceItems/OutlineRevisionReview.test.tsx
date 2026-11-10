import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServiceItem } from "../../types";
import type { OutlineRemoteConflict } from "../../store/itemListSlice";
import OutlineRevisionReview from "./OutlineRevisionReview";

const row = (listId: string, name: string): ServiceItem => ({ _id: `item-${listId}`, listId, name, type: "song" });
const base = [row("a", "Welcome"), row("b", "Scripture")];
const first = [{ ...base[0], name: "Welcome A" }, { ...base[1], name: "Scripture A" }];
const second = [{ ...base[0], name: "Welcome B" }, base[1], row("c", "Closing Song")];
const makeConflict = (): OutlineRemoteConflict => ({
  baselineItems: first, draftBaselineItems: first, localItems: first, remoteItems: first,
  revisionConflict: {
    graph: { winningRevision: "2-private-revision", conflictRevisions: ["2-other-private"], histories: {} },
    versions: [{ revision: "2-private-revision", items: first }, { revision: "2-other-private", items: second }],
    itemReview: { baselineItems: base, localItems: first, remoteItems: second },
  },
});

describe("outline revision review", () => {
  it.each(["First", "Second"])("previews compatible rows and saves only the %s version's conflicting field", async (side) => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    render(<OutlineRevisionReview conflict={makeConflict()} draft={first} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
    expect(screen.queryByText(/private-revision/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(`^${side} version:`) }));
    const preview = screen.getByLabelText("Resulting outline");
    expect(preview).toHaveTextContent(side === "First" ? "Welcome A" : "Welcome B");
    expect(preview).toHaveTextContent("Scripture A");
    expect(preview).toHaveTextContent("Closing Song");
    await user.click(screen.getByRole("button", { name: "Save choices" }));
    expect(onSave).toHaveBeenCalledWith([
      { ...base[0], name: side === "First" ? "Welcome A" : "Welcome B" }, first[1], second[2],
    ], expect.objectContaining({ kind: "rows" }));
  });

  it("shows removed versus edited rows and an exact resulting outline", async () => {
    const user = userEvent.setup();
    const conflict = makeConflict();
    conflict.revisionConflict!.itemReview = { baselineItems: base, localItems: [base[1]], remoteItems: second };
    render(<OutlineRevisionReview conflict={conflict} draft={[base[1]]} onSave={jest.fn()} />);
    expect(screen.getByText("One version removes this row; the other keeps a changed row.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "First version: Remove this row" }));
    expect(screen.getByLabelText("Resulting outline")).not.toHaveTextContent("Welcome");
    expect(screen.getByLabelText("Resulting outline")).toHaveTextContent("Closing Song");
  });

  it("requires an explicit order choice and previews all independently added rows", async () => {
    const user = userEvent.setup();
    const third = row("d", "Prayer");
    const local = [base[1], base[0], third];
    const remote = [base[0], third, base[1], row("c", "Closing Song")];
    const conflict = makeConflict();
    conflict.draftBaselineItems = local;
    conflict.revisionConflict!.itemReview = { baselineItems: [...base, third], localItems: local, remoteItems: remote };
    render(<OutlineRevisionReview conflict={conflict} draft={local} onSave={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
    expect(screen.getByText("Outline order")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Second version: Welcome → Prayer → Scripture → Closing Song/ }));
    expect(within(screen.getByLabelText("Resulting outline")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Welcome (song)", "Prayer (song)", "Scripture (song)", "Closing Song (song)",
    ]);
  });

  it("previews whole versions and clearly lists discarded rows when no reliable baseline exists", async () => {
    const user = userEvent.setup();
    const conflict = makeConflict();
    delete conflict.revisionConflict!.itemReview;
    const onSave = jest.fn();
    render(<OutlineRevisionReview conflict={conflict} draft={first} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Save selected outline" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Saved version 1" }));
    expect(screen.getByText(/Independent changes in other versions may be discarded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Discarded content")).toHaveTextContent("Closing Song");
    expect(screen.getByLabelText("Discarded content")).toHaveTextContent("Welcome B");
    expect(screen.getByLabelText("Resulting outline")).not.toHaveTextContent("Closing Song");
    await user.click(screen.getByRole("button", { name: "Save selected outline" }));
    expect(onSave).toHaveBeenCalledWith(first, { kind: "whole", revision: "2-private-revision" });
  });

  it("resets choices when a reviewed graph or editable draft changes and blocks duplicate saves", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    const conflict = makeConflict();
    const { rerender } = render(<OutlineRevisionReview conflict={conflict} draft={first} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /^First version:/ }));
    rerender(<OutlineRevisionReview conflict={conflict} draft={[...first, row("new", "New draft row")]} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^First version:/ }));
    rerender(<OutlineRevisionReview conflict={{ ...conflict, revisionConflict: { ...conflict.revisionConflict!, graph: { ...conflict.revisionConflict!.graph, winningRevision: "3-new" } } }} draft={first} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
    rerender(<OutlineRevisionReview conflict={{ ...conflict, resolutionChoice: "keep-local" }} draft={first} pendingItems={second} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Saving choices" })).toBeDisabled();
    expect(screen.getByLabelText("Resulting outline")).toHaveTextContent("Welcome B");
    expect(screen.getByLabelText("Resulting outline")).toHaveTextContent("Closing Song");
    expect(screen.getByRole("region", { name: "Review outline changes" })).toHaveAttribute("aria-busy", "true");
    expect(onSave).not.toHaveBeenCalled();
  });
});
