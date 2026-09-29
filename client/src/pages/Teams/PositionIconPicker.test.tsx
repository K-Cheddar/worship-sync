import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PositionIconPicker from "./PositionIconPicker";

jest.mock("@tabler/icons-react", () => ({
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
}));

describe("PositionIconPicker", () => {
  it("selects an icon, applies a color immediately, and can clear it", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const { rerender } = render(<PositionIconPicker value="" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.type(screen.getByPlaceholderText("Search all icons…"), "camera");
    await user.click(await screen.findByRole("button", { name: "tabler: camera" }));
    expect(onChange).toHaveBeenCalledWith({ source: "tabler", name: "camera" });

    rerender(<PositionIconPicker value={{ source: "tabler", name: "camera" }} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Icon picker" }));
    await user.click(screen.getByRole("button", { name: "Icon color #60a5fa" }));
    expect(onChange).toHaveBeenLastCalledWith({ source: "tabler", name: "camera", color: "#60a5fa" });

    rerender(<PositionIconPicker value={{ source: "tabler", name: "camera", color: "#60a5fa" }} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Clear icon" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
