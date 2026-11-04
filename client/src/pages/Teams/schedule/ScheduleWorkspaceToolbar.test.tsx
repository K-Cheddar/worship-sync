import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScheduleWorkspaceToolbar, {
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
  publicationStatus: "draft",
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

  it("keeps publication status next to the available action and retains pending feedback", async () => {
    const onPublicationChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ScheduleWorkspaceToolbar {...makeProps({ onPublicationChange })} />,
    );

    expect(screen.getByRole("status", { name: "Schedule publication status" })).toHaveTextContent("Draft");
    const publicationGroup = within(screen.getByRole("group", { name: "Schedule publication" }));
    const publishButton = publicationGroup.getByRole("button", { name: "Publish" });
    expect(publicationGroup.getByRole("status", { name: "Schedule publication status" })).toHaveTextContent("Draft");
    expect(publishButton).toHaveAttribute("data-variant", "presentSecondary");
    await user.click(publishButton);
    expect(onPublicationChange).toHaveBeenCalledTimes(1);

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          publicationStatus: "draft",
          isScheduleActionPending: true,
          isPublicationPending: true,
          onPublicationChange,
        })}
      />,
    );
    const publishingButton = screen.getByRole("button", { name: "Publishing…" });
    expect(publishingButton).toBeDisabled();
    expect(publishingButton).toHaveAttribute("aria-busy", "true");
  });

  it("shows Published status without an action for read-only users and keeps Unpublish low emphasis", () => {
    const { rerender } = render(
      <ScheduleWorkspaceToolbar
        {...makeProps({ canEdit: false, publicationStatus: "published" })}
      />,
    );

    expect(screen.getByRole("status", { name: "Schedule publication status" })).toHaveTextContent("Published");
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();

    rerender(
      <ScheduleWorkspaceToolbar
        {...makeProps({ canEdit: true, publicationStatus: "published" })}
      />,
    );
    expect(screen.getByRole("button", { name: "Unpublish" })).toHaveAttribute("data-variant", "presentTertiary");
  });

  it("hides publication controls for virtual schedules and preserves Undo/Redo disabled states", () => {
    render(
      <ScheduleWorkspaceToolbar
        {...makeProps({
          publicationStatus: undefined,
          canUndo: false,
          canRedo: true,
          undoBlockedByPendingSave: true,
          redoBlockedByPendingSave: false,
        })}
      />,
    );

    expect(screen.queryByRole("status", { name: "Schedule publication status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
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
