import { fireEvent, render, screen } from "@testing-library/react";
import MemberAvatar from "./MemberAvatar";

describe("MemberAvatar", () => {
  it("shows a decorative photo when a profile image URL is available", () => {
    render(
      <MemberAvatar
        profileImageUrl="https://example.com/rae.jpg"
        memberName="Rae Kim"
      />,
    );

    const image = screen.getByAltText("");
    expect(image).toHaveAttribute("src", "https://example.com/rae.jpg");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("shows initials when there is no image or the image fails", () => {
    const { rerender } = render(<MemberAvatar memberName="Rae Kim" />);
    expect(screen.getByText("RK")).toBeInTheDocument();

    rerender(
      <MemberAvatar
        profileImageUrl="https://example.com/rae.jpg"
        memberName="Rae Kim"
      />,
    );
    fireEvent.error(screen.getByAltText(""));

    expect(screen.getByText("RK")).toBeInTheDocument();
    expect(screen.queryByAltText("")).not.toBeInTheDocument();
  });
});
