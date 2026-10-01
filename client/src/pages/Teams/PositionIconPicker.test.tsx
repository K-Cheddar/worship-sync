import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import PositionIconPicker, { RECOMMENDED_GROUPS } from "./PositionIconPicker";
import {
  formatPositionIconLabel,
  loadTablerPositionIconCatalog,
  resolveWorshipSyncIcon,
} from "../../components/icons/iconRegistry";
import type { PositionIcon } from "../../components/icons/iconTypes";

const mockTablerImportState = { failuresRemaining: 0 };

jest.mock("@tabler/icons-react", () => {
  if (mockTablerImportState.failuresRemaining > 0) {
    mockTablerImportState.failuresRemaining -= 1;
    throw new Error("Temporary Tabler import failure");
  }
  return {
    IconAdjustmentsHorizontal: () => <svg />,
    IconBible: () => <svg />,
    IconBroadcast: () => <svg />,
    IconBuildingChurch: () => <svg />,
    IconCamera: () => <svg />,
    IconDeviceTv: () => <svg />,
    IconHeart: () => <svg />,
    IconLiveView: () => <svg />,
    IconMicrophone: () => <svg />,
    IconPiano: () => <svg />,
    IconPlugConnected: () => <svg />,
    IconPray: () => <svg />,
    IconSpeakerphone: () => <svg />,
    IconUsers: () => <svg />,
    IconWaveSine: () => <svg />,
    IconMusic: () => <svg />,
  };
});

describe("PositionIconPicker", () => {
  beforeEach(() => {
    mockTablerImportState.failuresRemaining = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows only unified Recommended and All icons views", async () => {
    const user = userEvent.setup();
    render(
      <PositionIconPicker
        value={{ source: "lucide", name: "MicVocal", color: "#123456" }}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Icon picker" }));

    expect(screen.getByRole("tab", { name: "Recommended" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All icons" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Lucide|Tabler/i })).not.toBeInTheDocument();
  });

  it("curates valid mixed-source Recommended refs without exact duplicates", async () => {
    const refs = RECOMMENDED_GROUPS.flatMap((group) => group.icons);
    const names = refs.map((ref) => ("name" in ref ? ref.name.toLowerCase() : ref.id.toLowerCase()));
    const tablerNames = new Set(
      (await loadTablerPositionIconCatalog())
        .filter((entry) => entry.ref.source === "tabler")
        .map((entry) => ("name" in entry.ref ? entry.ref.name : "")),
    );

    expect(refs.some((ref) => ref.source === "tabler")).toBe(true);
    expect(refs.some((ref) => ref.source === "lucide")).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(refs).toEqual(expect.arrayContaining([
      { source: "lucide", name: "MonitorSpeaker" },
      { source: "lucide", name: "Cable" },
      { source: "tabler", name: "live-view" },
      { source: "tabler", name: "bible" },
      { source: "lucide", name: "Toolbox" },
    ]));
    expect(refs.filter((ref) => ref.source === "lucide").every((ref) => resolveWorshipSyncIcon(ref) !== null)).toBe(true);
    expect(refs.filter((ref) => ref.source === "tabler").every((ref) => "name" in ref && tablerNames.has(ref.name))).toBe(true);
  });

  it("browses Recommended immediately and keeps its search scoped to the curated set", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker value="" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.getByPlaceholderText("Search recommended icons…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Microphone" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search recommended icons…"), "audio");
    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.queryByText("Video & Broadcast")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Microphone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lucide:|tabler:/i })).not.toBeInTheDocument();
  });

  it("loads the combined catalog, searches both sources, and uses friendly labels", async () => {
    const user = userEvent.setup();
    render(
      <PositionIconPicker
        value={{ source: "lucide", name: "MicVocal", color: "#123456" }}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("tab", { name: "All icons" }));

    const allResults = await screen.findByLabelText("All icon results");
    const allButtons = within(allResults).getAllByRole("button");
    expect(allButtons.length).toBeGreaterThan(0);
    expect(within(allResults).getAllByTestId("position-icon-tile").every(
      (tile) => tile.style.backgroundColor === "var(--position-icon-preview-fill)",
    )).toBe(true);
    expect(screen.getByTestId("position-icon-preview-root").style.getPropertyValue("--position-icon-preview-fill")).toBe("#123456");
    expect(screen.getByPlaceholderText("Search icons…")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search icons…"), "camera");
    expect(screen.getAllByRole("button", { name: "Camera" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: /lucide:|tabler:/i })).not.toBeInTheDocument();
  });

  it("loads another bounded batch when the All icons list reaches the bottom", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker value="" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("tab", { name: "All icons" }));
    const allResults = await screen.findByLabelText("All icon results");

    let scrollHeightReads = 0;
    Object.defineProperties(allResults, {
      clientHeight: { configurable: true, value: 224 },
      scrollHeight: {
        configurable: true,
        get: () => (scrollHeightReads++ === 0 ? 500 : 1000),
      },
      scrollTop: { configurable: true, value: 300 },
    });
    const initialCount = within(allResults).getAllByRole("button").length;
    fireEvent.scroll(allResults);

    expect(within(allResults).getAllByRole("button").length).toBe(initialCount + 60);
  });

  it("saves a structured Tabler ref and preserves an existing color", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<PositionIconPicker value={{ source: "lucide", name: "MicVocal", color: "#60a5fa" }} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("tab", { name: "All icons" }));
    await user.type(screen.getByPlaceholderText("Search icons…"), "camera");
    const cameraButtons = await screen.findAllByRole("button", { name: "Camera" });
    await user.click(cameraButtons[cameraButtons.length - 1]);

    expect(onChange).toHaveBeenCalledWith({ source: "tabler", name: "camera", color: "#60a5fa" });
  });

  it("keeps color unset when changing icons from the default", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<PositionIconPicker value="" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("button", { name: "Microphone" }));

    expect(onChange).toHaveBeenCalledWith({ source: "tabler", name: "microphone" });
  });

  it("uses the shared compact color picker, resets color, and has no native color input", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<PositionIconPicker value={{ source: "lucide", name: "MicVocal" }} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.queryByLabelText("Custom icon color")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
    const defaultColorTrigger = screen.getByRole("button", { name: "Choose custom icon color" });
    expect(defaultColorTrigger).toHaveStyle({
      backgroundColor: "#475569",
      borderColor: "#ffffff",
    });
    expect(defaultColorTrigger).not.toHaveAttribute("style", expect.stringContaining("conic-gradient"));

    await user.click(defaultColorTrigger);
    const hexInput = screen.getByRole("textbox", { name: "Choose custom icon color hex" });
    fireEvent.change(hexInput, { target: { value: "#123456" } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ source: "lucide", name: "MicVocal", color: "#123456" });
    });

    await user.click(screen.getByRole("button", { name: "Default" }));
    expect(onChange).toHaveBeenCalledWith({ source: "lucide", name: "MicVocal" });
  });

  it("shows explicit white and black colors with contrast-safe swatch borders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PositionIconPicker
        value={{ source: "lucide", name: "MicVocal", color: "#ffffff" }}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.getByRole("button", { name: "Choose custom icon color" })).toHaveStyle({
      backgroundColor: "#ffffff",
      borderColor: "#000000",
    });

    rerender(
      <PositionIconPicker
        value={{ source: "lucide", name: "MicVocal", color: "#000000" }}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Choose custom icon color" })).toHaveStyle({
      backgroundColor: "#000000",
      borderColor: "#ffffff",
    });
  });

  it("removes the color override and updates the Default swatch immediately", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const StatefulPicker = () => {
      const [value, setValue] = useState<PositionIcon>({
        source: "lucide",
        name: "MicVocal",
        color: "#ef4444",
      });
      return (
        <PositionIconPicker
          value={value}
          onChange={(next) => {
            onChange(next);
            if (next) setValue(next);
          }}
        />
      );
    };

    render(<StatefulPicker />);
    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.getByRole("button", { name: "Choose custom icon color" })).toHaveStyle({
      backgroundColor: "#ef4444",
    });

    await user.click(screen.getByRole("button", { name: "Default" }));
    expect(onChange).toHaveBeenLastCalledWith({ source: "lucide", name: "MicVocal" });
    expect(screen.getByRole("button", { name: "Choose custom icon color" })).toHaveStyle({
      backgroundColor: "#475569",
    });
  });

  it("keeps the selected icon accent ring separate from its neutral badge surface", async () => {
    const user = userEvent.setup();
    render(
      <PositionIconPicker
        value={{ source: "lucide", name: "MicVocal", color: "#22c55e" }}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    const selectedButton = screen.getByRole("button", { name: "Mic Vocal" });
    expect(selectedButton).toHaveClass("border-cyan-400");
    expect(selectedButton).toHaveClass("ring-1");
    expect(selectedButton).not.toHaveClass("bg-cyan-400/15");
    expect(selectedButton).toHaveAttribute("aria-pressed", "true");
    expect(within(selectedButton).getByTestId("position-icon-tile")).toHaveStyle({
      backgroundColor: "var(--position-icon-preview-fill)",
      color: "var(--position-icon-preview-ink)",
    });
    const previewRoot = screen.getByTestId("position-icon-preview-root");
    expect(previewRoot.style.getPropertyValue("--position-icon-preview-fill")).toBe("#22c55e");
    expect(previewRoot.style.getPropertyValue("--position-icon-preview-ink")).toBe("#ffffff");
  });

  it("previews the chosen fill across catalog tiles before committing the parent value", async () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<PositionIconPicker value={{ source: "lucide", name: "MicVocal" }} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("button", { name: "Choose custom icon color" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Choose custom icon color hex" }), {
      target: { value: "#ffff00" },
    });

    const root = screen.getByTestId("position-icon-preview-root");
    expect(root.style.getPropertyValue("--position-icon-preview-fill")).toBe("#ffff00");
    expect(root.style.getPropertyValue("--position-icon-preview-ink")).toBe("#000000");
    const tiles = screen.getAllByTestId("position-icon-tile");
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.every((tile) => tile.style.backgroundColor === "var(--position-icon-preview-fill)")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(179));
    expect(onChange).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledWith({ source: "lucide", name: "MicVocal", color: "#ffff00" });
  });

  it("keeps legacy Lucide values available in legacyOnly mode", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker legacyOnly value="MicVocal" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.getByRole("button", { name: "Mic Vocal" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search icons…")).toBeInTheDocument();
  });

  it("formats internal icon names for user-facing labels", () => {
    expect(formatPositionIconLabel("adjustments-horizontal")).toBe("Adjustments horizontal");
    expect(formatPositionIconLabel("MicVocal")).toBe("Mic Vocal");
  });
});
