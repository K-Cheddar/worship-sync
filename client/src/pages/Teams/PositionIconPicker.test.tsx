import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PositionIconPicker, { RECOMMENDED_GROUPS } from "./PositionIconPicker";
import {
  loadTablerPositionIconCatalog,
  resolveWorshipSyncIcon,
} from "../../components/icons/iconRegistry";

const mockTablerImportState = { failuresRemaining: 0, requests: 0 };

jest.mock("@tabler/icons-react", () => {
  mockTablerImportState.requests += 1;
  if (mockTablerImportState.failuresRemaining > 0) {
    mockTablerImportState.failuresRemaining -= 1;
    throw new Error("Temporary Tabler import failure");
  }
  return {
    IconCamera: () => <svg />,
    IconVideo: () => <svg />,
    IconMicrophone: () => <svg />,
    IconHeadphones: () => <svg />,
    IconSpeakerphone: () => <svg />,
    IconWaveSine: () => <svg />,
    IconAdjustmentsHorizontal: () => <svg />,
    IconBroadcast: () => <svg />,
    IconDeviceTv: () => <svg />,
    IconPresentation: () => <svg />,
    IconBulb: () => <svg />,
    IconGuitarPick: () => <svg />,
    IconPiano: () => <svg />,
    IconMusic: () => <svg />,
    IconUsers: () => <svg />,
    IconBook2: () => <svg />,
    IconBuildingChurch: () => <svg />,
    IconHeart: () => <svg />,
  };
});

describe("PositionIconPicker", () => {
  beforeEach(() => {
    mockTablerImportState.failuresRemaining = 0;
    mockTablerImportState.requests = 0;
  });

  it("shows Tabler loading/error states and permits retry", async () => {
    const user = userEvent.setup();
    mockTablerImportState.failuresRemaining = 2;
    render(<PositionIconPicker value="" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("tab", { name: /^Tabler$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tabler icons are unavailable.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "tabler: camera" })).toBeInTheDocument();
  });

  it("curates valid mixed-source Recommended refs", async () => {
    const refs = RECOMMENDED_GROUPS.flatMap((group) => group.icons);
    const lucideRefs = refs.filter((ref) => ref.source === "lucide");
    const tablerRefs = refs.filter((ref) => ref.source === "tabler").map((ref) => ("name" in ref ? ref.name : ""));
    const tablerNames = new Set(
      (await loadTablerPositionIconCatalog())
        .filter((entry) => entry.ref.source === "tabler")
        .map((entry) => entry.ref)
        .map((ref) => ("name" in ref ? ref.name : "")),
    );

    expect(refs.some((ref) => ref.source === "tabler")).toBe(true);
    expect(lucideRefs.every((ref) => resolveWorshipSyncIcon(ref) !== null)).toBe(true);
    expect(tablerRefs.every((name) => tablerNames.has(name))).toBe(true);
  });

  it("browses Lucide immediately and scopes search to Lucide", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker value="" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.getByPlaceholderText("Search recommended icons…")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^lucide: /i }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: /^Lucide$/i }));
    expect(screen.getByPlaceholderText("Search Lucide icons…")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^lucide: /i }).length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText("Search Lucide icons…"), "camera");
    expect(screen.getByRole("button", { name: "lucide: Camera" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "tabler: camera" })).not.toBeInTheDocument();
  });

  it("loads a browseable Tabler grid and scopes search to Tabler", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker value="" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("tab", { name: /^Tabler$/i }));
    expect(screen.getByPlaceholderText("Search Tabler icons…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "tabler: camera" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^tabler: /i }).length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText("Search Tabler icons…"), "camera");
    expect(screen.getByRole("button", { name: "tabler: camera" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "lucide: Camera" })).not.toBeInTheDocument();
  });

  it("searches only the curated Recommended set", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker value="" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.type(screen.getByPlaceholderText("Search recommended icons…"), "audio");

    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.queryByText("Video")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lucide: MicVocal" })).toBeInTheDocument();
  });

  it("saves a structured Tabler ref and preserves an existing color", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<PositionIconPicker value={{ source: "lucide", name: "MicVocal", color: "#60a5fa" }} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("tab", { name: /^Tabler$/i }));
    await user.click(await screen.findByRole("button", { name: "tabler: camera" }));

    expect(onChange).toHaveBeenCalledWith({ source: "tabler", name: "camera", color: "#60a5fa" });
  });

  it("uses the shared compact color picker, resets color, and has no native color input", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<PositionIconPicker value={{ source: "lucide", name: "MicVocal" }} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.queryByLabelText("Custom icon color")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose custom icon color" }));
    const hexInput = screen.getByRole("textbox", { name: "Choose custom icon color hex" });
    fireEvent.change(hexInput, { target: { value: "#123456" } });
    expect(onChange).toHaveBeenCalledWith({ source: "lucide", name: "MicVocal", color: "#123456" });

    await user.click(screen.getByRole("button", { name: "Default" }));
    expect(onChange).toHaveBeenCalledWith({ source: "lucide", name: "MicVocal" });
  });

  it("keeps legacy Lucide values available in legacyOnly mode", async () => {
    const user = userEvent.setup();
    render(<PositionIconPicker legacyOnly value="MicVocal" onChange={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    expect(screen.getByRole("button", { name: "MicVocal" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search Lucide icons…")).toBeInTheDocument();
  });
});
