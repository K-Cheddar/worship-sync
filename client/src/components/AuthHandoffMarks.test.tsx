import { render, screen } from "@testing-library/react";
import { AuthHandoffMarks } from "./AuthHandoffMarks";

describe("AuthHandoffMarks", () => {
  it("labels the Google to WorshipSync handoff", () => {
    render(<AuthHandoffMarks provider="google" />);
    expect(
      screen.getByRole("img", { name: /Google to WorshipSync/i }),
    ).toBeInTheDocument();
  });

  it("labels the YouTube to WorshipSync handoff", () => {
    render(<AuthHandoffMarks provider="youtube" />);
    expect(
      screen.getByRole("img", { name: /YouTube to WorshipSync/i }),
    ).toBeInTheDocument();
  });
});
