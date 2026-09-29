import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PositionIconPicker from "./PositionIconPicker";
import type { PositionIcon } from "../../components/icons/iconTypes";

const mockTablerImportState = { failuresRemaining: 0 };

jest.mock("@tabler/icons-react", () => {
  if (mockTablerImportState.failuresRemaining > 0) {
    mockTablerImportState.failuresRemaining -= 1;
    throw new Error("Temporary Tabler import failure");
  }
  return {
  IconCamera: () => <svg />,
  IconVideo: () => <svg />,
  IconMicrophone: () => <svg />,
  IconMic: () => <svg />,
  IconHeadphones: () => <svg />,
  IconSpeakerphone: () => <svg />,
  IconWaveSine: () => <svg />,
  IconAdjustmentsHorizontal: () => <svg />,
  IconRadio: () => <svg />,
  IconBroadcast: () => <svg />,
  IconDeviceTv: () => <svg />,
  IconPresentation: () => <svg />,
  IconBulb: () => <svg />,
  IconGuitarPick: () => <svg />,
  IconPiano: () => <svg />,
  IconMusic: () => <svg />,
  IconUser: () => <svg />,
  IconUsers: () => <svg />,
  IconBook2: () => <svg />,
  IconBuildingChurch: () => <svg />,
  IconHand: () => <svg />,
  IconHeart: () => <svg />,
  IconCross: () => <svg />,
  };
});

describe("PositionIconPicker", () => {
  it("stays open after selecting an icon so color can be chosen and clearing still works", async () => {
    const user = userEvent.setup();
    mockTablerImportState.failuresRemaining = 1;
    const PickerHarness = () => {
      const [value, setValue] = useState<PositionIcon | "">("");
      return <PositionIconPicker value={value} onChange={setValue} />;
    };
    render(<PickerHarness />);
    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.type(screen.getByPlaceholderText("Search all icons…"), "camera");
    expect(await screen.findByText("Icon catalog is unavailable.")).toBeInTheDocument();
    window.dispatchEvent(new Event("online"));
    await user.click(await screen.findByRole("button", { name: "tabler: camera" }));
    expect(screen.getByRole("tab", { name: "Recommended" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Icon color #60a5fa" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Icon color #60a5fa" }));
    expect(screen.getByRole("button", { name: "Clear icon" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear icon" }));
    expect(screen.getByRole("button", { name: "Icon picker" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search all icons…")).toBeInTheDocument();
  });
});
