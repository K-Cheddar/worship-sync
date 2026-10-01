import { fireEvent, render, screen } from "@testing-library/react";
import ProfileImagePreview from "./ProfileImagePreview";

it("keeps the profile image button opening the existing preview modal", () => {
  render(
    <ProfileImagePreview
      imageUrl="https://example.com/rae.jpg"
      memberName="Rae Kim"
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "View profile image of Rae Kim" }));

  expect(screen.getByRole("dialog", { name: "Rae Kim profile image" })).toBeInTheDocument();
  expect(screen.getByAltText("Rae Kim profile")).toHaveAttribute(
    "src",
    "https://example.com/rae.jpg",
  );
});
