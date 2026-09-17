import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantPositionControl } from "./StyleEditor";
import { OverlayFormatting } from "../../types";

describe("ParticipantPositionControl", () => {
  it("updates participant position and its related formatting", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const formatting: OverlayFormatting = {
      participantOverlayPosition: "left",
      borderLeftColor: "#15803d",
      children: [{ label: "Name", textAlign: "left" }],
    };

    render(
      <ParticipantPositionControl formatting={formatting} onChange={onChange} />,
    );

    await user.click(screen.getByRole("radio", { name: "Center" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        participantOverlayPosition: "center",
        left: undefined,
        right: undefined,
        textAlign: "center",
        borderBottomWidth: 5,
        children: [expect.objectContaining({ textAlign: "center", width: 100 })],
      }),
    );
  });
});
