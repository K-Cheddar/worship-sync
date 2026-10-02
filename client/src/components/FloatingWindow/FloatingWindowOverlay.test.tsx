import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FloatingWindow from "./FloatingWindow";
import { FloatingWindowZIndexProvider } from "./FloatingWindowZIndexContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Select from "@/components/Select/Select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const renderWindow = (children: React.ReactNode, title = "Overlay test") =>
  render(
    <FloatingWindowZIndexProvider>
      <FloatingWindow title={title} onClose={jest.fn()}>
        {children}
      </FloatingWindow>
    </FloatingWindowZIndexProvider>,
  );

describe("FloatingWindow overlay ownership", () => {
  it("portals a popover into its window host, closes on Escape, and restores focus", async () => {
    const user = userEvent.setup();
    renderWindow(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Open popover</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button">Popover action</button>
        </PopoverContent>
      </Popover>,
    );

    const trigger = screen.getByRole("button", { name: "Open popover" });
    await user.click(trigger);

    const host = screen.getByTestId("floating-window-overlay-host");
    expect(host).toHaveStyle({ "--scrollbar-width": "thin" });
    expect(within(host).getByRole("button", { name: "Popover action" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Popover action" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("carries the controller scrollbar preference into its body portal host", () => {
    render(
      <FloatingWindowZIndexProvider>
        <div style={{ "--scrollbar-width": "8px" } as React.CSSProperties}>
          <FloatingWindow title="Overlay test" onClose={jest.fn()}>
            Window content
          </FloatingWindow>
        </div>
      </FloatingWindowZIndexProvider>,
    );

    expect(screen.getByTestId("floating-window-overlay-host")).toHaveStyle({
      "--scrollbar-width": "8px",
    });
  });

  it("opens and selects a Select option without an inline portal override", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderWindow(
      <Select
        label="Color"
        options={[{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }]}
        value="red"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Color:" });
    await user.click(trigger);

    const host = screen.getByTestId("floating-window-overlay-host");
    const blue = within(host).getByRole("option", { name: "Blue" });
    expect(within(host).getByRole("listbox")).toHaveClass("scrollbar-portal");
    await user.click(blue);

    expect(onChange).toHaveBeenCalledWith("blue");
    expect(trigger).toHaveFocus();
  });

  it("applies the portal scrollbar scope to context menu content", () => {
    renderWindow(
      <ContextMenu>
        <ContextMenuTrigger>Right-click here</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Context action</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Right-click here"));
    const host = screen.getByTestId("floating-window-overlay-host");
    expect(within(host).getByRole("menu")).toHaveClass("scrollbar-portal");
    expect(within(host).getByRole("menuitem", { name: "Context action" })).toBeInTheDocument();
  });

  it("supports menu selection and a nested submenu in the window host", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    renderWindow(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Open menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Choose item</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More choices</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={onSelect}>Nested item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    const host = screen.getByTestId("floating-window-overlay-host");
    expect(within(host).getByRole("menu")).toHaveClass("scrollbar-portal");
    await user.click(within(host).getByRole("menuitem", { name: "Choose item" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.hover(within(host).getByRole("menuitem", { name: "More choices" }));
    const nestedItem = await within(host).findByRole("menuitem", { name: "Nested item" });
    expect(nestedItem).toBeInTheDocument();
    fireEvent.click(nestedItem);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("keeps two floating windows' overlays in separate hosts", () => {
    render(
      <FloatingWindowZIndexProvider>
        <FloatingWindow title="First" onClose={jest.fn()}>
          <Popover open>
            <PopoverTrigger asChild>
              <button type="button">First trigger</button>
            </PopoverTrigger>
            <PopoverContent>First overlay</PopoverContent>
          </Popover>
        </FloatingWindow>
        <FloatingWindow title="Second" onClose={jest.fn()}>
          <Popover open>
            <PopoverTrigger asChild>
              <button type="button">Second trigger</button>
            </PopoverTrigger>
            <PopoverContent>Second overlay</PopoverContent>
          </Popover>
        </FloatingWindow>
      </FloatingWindowZIndexProvider>,
    );

    const hosts = screen.getAllByTestId("floating-window-overlay-host");
    expect(hosts).toHaveLength(2);
    expect(within(hosts[0]).getByText("First overlay")).toBeInTheDocument();
    expect(within(hosts[1]).getByText("Second overlay")).toBeInTheDocument();
    expect(Number(hosts[1].style.zIndex)).toBeGreaterThan(Number(hosts[0].style.zIndex));
  });

  it("keeps an open overlay mounted while its window is moved and resized", async () => {
    const user = userEvent.setup();
    renderWindow(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Open movable popover</button>
        </PopoverTrigger>
        <PopoverContent>Movable overlay</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open movable popover" }));
    fireEvent.mouseDown(screen.getByText("Overlay test"), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    fireEvent.mouseUp(document);
    fireEvent.mouseDown(screen.getByTestId("resize-handle-se"), { clientX: 400, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 440, clientY: 340 });
    fireEvent.mouseUp(document);
    fireEvent(window, new Event("resize"));

    expect(screen.getByText("Movable overlay")).toBeInTheDocument();
  });

  it("hides an open overlay while minimized and restores it with the window", async () => {
    const user = userEvent.setup();
    renderWindow(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Open minimize-test popover</button>
        </PopoverTrigger>
        <PopoverContent>Minimize-test overlay</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open minimize-test popover" }));
    const host = screen.getByTestId("floating-window-overlay-host");
    await user.click(screen.getByRole("button", { name: "Minimize window" }));

    await waitFor(() => expect(host).toHaveStyle({ visibility: "hidden" }));
    await screen.findByRole("button", { name: "Restore window" });
    await user.click(screen.getByRole("button", { name: "Restore window" }));
    await waitFor(() => expect(host).toHaveStyle({ visibility: "visible" }));
    await user.click(screen.getByRole("button", { name: "Open minimize-test popover" }));
    expect(within(host).getByText("Minimize-test overlay")).toBeInTheDocument();
  });

  it("cleans the host and open overlay when the floating window unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWindow(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Open popover</button>
        </PopoverTrigger>
        <PopoverContent>Transient overlay</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open popover" }));
    expect(screen.getByText("Transient overlay")).toBeInTheDocument();
    unmount();

    expect(screen.queryByText("Transient overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("floating-window-overlay-host")).not.toBeInTheDocument();
  });

  it("preserves normal body portal behavior outside a floating window", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Open normal popover</button>
        </PopoverTrigger>
        <PopoverContent>Normal overlay</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open normal popover" }));

    expect(screen.getByText("Normal overlay")).toBeInTheDocument();
    expect(screen.queryByTestId("floating-window-overlay-host")).not.toBeInTheDocument();
  });

  it("closes a floating-window popover on outside interaction", async () => {
    const user = userEvent.setup();
    renderWindow(
      <>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button">Open outside-test popover</button>
          </PopoverTrigger>
          <PopoverContent>Outside-test overlay</PopoverContent>
        </Popover>
        <button type="button">Outside target</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Open outside-test popover" }));
    await user.click(screen.getByRole("button", { name: "Outside target" }));

    expect(screen.queryByText("Outside-test overlay")).not.toBeInTheDocument();
  });
});
