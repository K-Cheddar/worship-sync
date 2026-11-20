import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScheduleWorkspaceToolbar, {
  getScheduleWorkspacePublicationClassName,
  resolveSchedulePublicationStatus,
} from "./ScheduleWorkspaceToolbar";

type ToolbarProps = ComponentProps<typeof ScheduleWorkspaceToolbar>;

const makeProps = (overrides: Partial<ToolbarProps> = {}): ToolbarProps => ({
  staffingSummary: <div>3 Services</div>,
  membersControl: <button type="button">Members</button>,
  canEdit: true,
  canUndo: false,
  canRedo: false,
  undoBlockedByPendingSave: false,
  redoBlockedByPendingSave: false,
  autoFilling: false,
  undoLabel: null,
  redoLabel: null,
  undoShortcut: { undo: "Ctrl+Z", redo: "Ctrl+Y" },
  onUndo: jest.fn(),
  onRedo: jest.fn(),
  autoFillMenuItem: { text: "Auto-fill", onClick: jest.fn() },
  lifecycleStatus: "draft",
  isScheduleActionPending: false,
  isPublicationPending: false,
  onPublicationChange: jest.fn(),
  showOrganizeOptions: true,
  organizeMode: "byService",
  onOrganizeModeChange: jest.fn(),
  scheduleLayout: "board",
  scheduleLayoutOptions: [
    { value: "board", label: "Cards" },
    { value: "transpose", label: "By position" },
    { value: "grid", label: "Grid" },
  ],
  onScheduleLayoutChange: jest.fn(),
  moreMenuItems: [
    { text: "Save as PDF", onClick: jest.fn() },
    { text: "Copy view-only link", onClick: jest.fn() },
  ],
  ...overrides,
});

describe("ScheduleWorkspaceToolbar", () => {
  it.each([
    ["an explicit Draft", { scheduleId: "schedule-1", published: false }, "draft"],
    ["an explicit Published schedule", { scheduleId: "schedule-1", published: true }, "published"],
    ["a legacy schedule without publication metadata", { scheduleId: "schedule-1" }, "published"],
    ["a virtual schedule", { scheduleId: "virtual:team:period" }, undefined],
    ["a local schedule", { scheduleId: "local-schedule-1" }, undefined],
    ["no selected schedule", undefined, undefined],
  ])("resolves publication status for %s", (_label, schedule, expected) => {
    expect(resolveSchedulePublicationStatus(schedule)).toBe(expected);
  });

  it.each([
    ["a saved Draft", { scheduleId: "schedule-1", published: false }, "border-amber-500/50 bg-amber-950/20"],
    ["a Published schedule", { scheduleId: "schedule-1", published: true }, undefined],
    ["a legacy Published schedule", { scheduleId: "schedule-1" }, undefined],
    ["a virtual schedule", { scheduleId: "virtual:team:period" }, undefined],
  ])("applies the workspace appearance only to %s", (_label, schedule, expected) => {
    const status = resolveSchedulePublicationStatus(schedule);
    expect(getScheduleWorkspacePublicationClassName(status)).toBe(expected);
  });

  it.each([
    [1280, "desktop"],
    [768, "tablet"],
    [390, "mobile"],
  ])("keeps preferences in More at %s px (%s)", async (width) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    const user = userEvent.setup();
    const onOrganizeModeChange = jest.fn();
    const onScheduleLayoutChange = jest.fn();
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({ onOrganizeModeChange, onScheduleLayoutChange })}
      />,
    );
    expect(screen.getByText("3 Services")).toBeInTheDocument();
    const statusBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(statusBanner).toHaveTextContent(
      "Draft schedule Not published · Not visible to volunteers",
    );
    expect(statusBanner).toHaveClass("flex-wrap", "py-2", "min-w-0");
    const toolbarControls = within(screen.getByRole("group", { name: "Team schedule controls" }));
    expect(toolbarControls.queryByRole("status", { name: "Schedule lifecycle status" })).not.toBeInTheDocument();
    expect(toolbarControls.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(toolbarControls.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand all services" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse all services" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More schedule actions" }));

    const organizeMenuItem = screen.getByRole("menuitem", { name: "Organize" });
    await user.hover(organizeMenuItem);
    const selectedOrganizeOption = await screen.findByRole("menuitem", { name: /By service/ });
    expect(selectedOrganizeOption).toHaveTextContent(/\u2713/);
    expect(screen.getByRole("menuitem", { name: "By date" })).toBeInTheDocument();

    await user.hover(screen.getByRole("menuitem", { name: "Layout" }));
    const selectedLayoutOption = await screen.findByRole("menuitem", { name: /Cards/ });
    expect(selectedLayoutOption).toHaveTextContent(/\u2713/);
    expect(screen.getByRole("menuitem", { name: "By position" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Grid" })).toBeInTheDocument();

    expect(screen.getByRole("menuitem", { name: "Auto-fill" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Save as PDF" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy view-only link" })).toBeInTheDocument();
    expect(onOrganizeModeChange).not.toHaveBeenCalled();
    expect(onScheduleLayoutChange).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("keeps the organize submenu hidden when the schedule has one service", async () => {
    const user = userEvent.setup();
    render(<ScheduleWorkspaceToolbar {...makeProps({ showOrganizeOptions: false })} />);

    await user.click(screen.getByRole("button", { name: "More schedule actions" }));
    expect(screen.queryByRole("menuitem", { name: "Organize" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Layout" })).toBeInTheDocument();
  });

  it("shows Publish in the Draft banner and retains pending feedback", async () => {
    const onPublicationChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ScheduleWorkspaceToolbar {...makeProps({ onPublicationChange })} />,
    );

    const publicationGroup = within(screen.getByRole("group", { name: "Schedule status banner" }));
    const publishButton = publicationGroup.getByRole("button", { name: "Publish" });
    expect(publicationGroup.getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Draft schedule");
    expect(publishButton).toHaveAttribute("data-variant", "presentSecondary");
    expect(within(screen.getByRole("group", { name: "Team schedule controls" })).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    await user.click(publishButton);
    expect(onPublicationChange).toHaveBeenCalledTimes(1);
    expect(publicationGroup.getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Draft schedule");

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          lifecycleStatus: "draft",
          isScheduleActionPending: true,
          isPublicationPending: true,
          onPublicationChange,
        })}
      />,
    );
    const publishingButton = within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Publishing…" });
    expect(publishingButton).toBeDisabled();
    expect(publishingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("group", { name: "Schedule status banner" })).toBeInTheDocument();
  });

  it("updates the banner and styling when the selected schedule changes", async () => {
    const onPublicationChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ScheduleWorkspaceToolbar {...makeProps({ onPublicationChange })} />);
    const draftBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(draftBanner).toHaveClass("border-amber-500/40", "bg-amber-950/35");

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: "published", onPublicationChange })}
      />,
    );
    const publishedBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(publishedBanner).toHaveTextContent("Published schedule Visible to volunteers");
    expect(publishedBanner).toHaveClass("border-emerald-800/70", "bg-emerald-950/20");
    await user.click(within(publishedBanner).getByRole("button", { name: "Unpublish" }));
    expect(onPublicationChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Draft schedule")).not.toBeInTheDocument();

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          lifecycleStatus: "published",
          isScheduleActionPending: true,
          isPublicationPending: true,
          onPublicationChange,
        })}
      />,
    );
    const unpublishingButton = within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Unpublishing…" });
    expect(unpublishingButton).toBeDisabled();
    expect(screen.getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Published schedule");

    // A failed request leaves the saved schedule Published and restores Unpublish.
    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: "published", onPublicationChange })}
      />,
    );
    expect(within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Unpublish" })).toBeEnabled();

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: "draft", onPublicationChange })}
      />,
    );
    const unpublishedBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(unpublishedBanner).toHaveTextContent("Draft schedule Not published · Not visible to volunteers");
    expect(unpublishedBanner).toHaveClass("border-amber-500/40", "bg-amber-950/35");

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: "virtual" })}
      />,
    );
    const virtualBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(virtualBanner).toHaveTextContent("Schedule preview Not saved yet · Make an assignment to start a draft");
    expect(virtualBanner).toHaveClass("border-slate-700", "bg-slate-900/50");
    expect(within(virtualBanner).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(within(virtualBanner).queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();

    // Once the first edit persists, the banner follows the selected Draft schedule.
    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: "draft", onPublicationChange })}
      />,
    );
    const firstEditDraftBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(firstEditDraftBanner).toHaveTextContent("Draft schedule Not published · Not visible to volunteers");
    expect(firstEditDraftBanner).toHaveClass("border-amber-500/40", "bg-amber-950/35");
    expect(within(firstEditDraftBanner).getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("shows Published status without an action for read-only users and keeps Unpublish low emphasis", () => {
    const { rerender } = render(
      <ScheduleWorkspaceToolbar
        {...makeProps({ canEdit: false, lifecycleStatus: "published" })}
      />,
    );

    const statusBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(statusBanner).toHaveTextContent("Published schedule Visible to volunteers");
    expect(within(statusBanner).queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(within(statusBanner).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ canEdit: true, lifecycleStatus: "published" })}
      />,
    );
    expect(within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Unpublish" })).toHaveAttribute("data-variant", "presentTertiary");
  });

  it("shows Draft messaging to read-only users without publication actions", () => {
    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({ canEdit: false, lifecycleStatus: "draft" })}
      />,
    );

    const statusBanner = screen.getByRole("group", { name: "Schedule status banner" });
    expect(statusBanner).toHaveTextContent(
      "Not published · Not visible to volunteers",
    );
    expect(within(statusBanner).getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Draft schedule");
    expect(within(statusBanner).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(within(statusBanner).queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
  });

  it("shows the Virtual banner without publication actions and preserves Undo/Redo disabled states", () => {
    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          lifecycleStatus: "virtual",
          canUndo: false,
          canRedo: true,
          undoBlockedByPendingSave: true,
          redoBlockedByPendingSave: false,
        })}
      />,
    );

    expect(screen.getByRole("group", { name: "Schedule status banner" })).toHaveTextContent(
      "Schedule preview Not saved yet · Make an assignment to start a draft",
    );
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });

  it("does not guess a lifecycle state while the selected schedule is unavailable", () => {
    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: undefined })}
      />,
    );

    expect(screen.queryByRole("group", { name: "Schedule status banner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Schedule lifecycle status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
  });

  it("keeps the current lifecycle state through pending and failed publication requests", async () => {
    const user = userEvent.setup();
    const onPublicationChange = jest.fn();
    const { rerender } = render(
      <ScheduleWorkspaceToolbar {...makeProps({ onPublicationChange })} />,
    );

    await user.click(within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Publish" }));
    expect(onPublicationChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Draft schedule");

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          isScheduleActionPending: true,
          isPublicationPending: true,
          onPublicationChange,
        })}
      />,
    );
    expect(within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Publishing…" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Draft schedule");

    // A failed request clears the pending state without changing the owner's status.
    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ onPublicationChange })}
      />,
    );
    expect(within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Publish" })).toBeEnabled();

    // The parent updates the selected schedule only after a successful response.
    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ lifecycleStatus: "published", onPublicationChange })}
      />,
    );
    expect(screen.getByRole("status", { name: "Schedule lifecycle status" })).toHaveTextContent("Published schedule");
    expect(within(screen.getByRole("group", { name: "Schedule status banner" })).getByRole("button", { name: "Unpublish" })).toBeEnabled();
  });

  it("supports keyboard navigation and selection in the organize submenu", async () => {
    const user = userEvent.setup();
    const onOrganizeModeChange = jest.fn();
    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          canEdit: false,
          autoFillMenuItem: undefined,
          onOrganizeModeChange,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More schedule actions" }));
    await user.keyboard("{ARROWDOWN}");
    await user.keyboard("{ARROWRIGHT}");
    await user.keyboard("{ENTER}");
    expect(onOrganizeModeChange).toHaveBeenCalledWith("byDate");
  });

  it("supports keyboard navigation and selection in the layout submenu", async () => {
    const user = userEvent.setup();
    const onScheduleLayoutChange = jest.fn();
    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          canEdit: false,
          autoFillMenuItem: undefined,
          showOrganizeOptions: false,
          onScheduleLayoutChange,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More schedule actions" }));
    await user.keyboard("{ARROWDOWN}");
    await user.keyboard("{ARROWRIGHT}");
    await user.keyboard("{ARROWDOWN}");
    await user.keyboard("{ENTER}");
    expect(onScheduleLayoutChange).toHaveBeenCalledWith("transpose");
  });
});
