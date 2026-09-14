import { fireEvent, render, screen } from "@testing-library/react";
import InstantImageSwap from "../InstantImageSwap";

describe("InstantImageSwap", () => {
  it("keeps the old editor image until the hidden incoming image is ready", () => {
    const { rerender } = render(
      <InstantImageSwap src="blob:old" alt="Background" />,
    );
    const oldImage = screen.getByTestId("instant-image-visible");

    rerender(<InstantImageSwap src="blob:new" alt="Background" />);

    expect(screen.getByTestId("instant-image-visible")).toBe(oldImage);
    expect(oldImage).toHaveAttribute("src", "blob:old");
    const pendingImage = screen.getByTestId("instant-image-pending");
    expect(pendingImage).toHaveAttribute("src", "blob:new");
    expect(pendingImage).toHaveStyle({ opacity: "0" });

    fireEvent.load(pendingImage);

    expect(screen.queryByTestId("instant-image-pending")).not.toBeInTheDocument();
    expect(screen.getByTestId("instant-image-visible")).toBe(pendingImage);
    expect(screen.getByTestId("instant-image-visible")).toHaveAttribute(
      "src",
      "blob:new",
    );
  });

  it("retains the visible image while a local URL is still resolving", () => {
    const { rerender } = render(
      <InstantImageSwap src="blob:old" alt="Background" />,
    );

    rerender(
      <InstantImageSwap
        src={undefined}
        alt="Background"
        holdWhileLoading
      />,
    );

    expect(screen.getByTestId("instant-image-visible")).toHaveAttribute(
      "src",
      "blob:old",
    );
  });
});
