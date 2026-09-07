import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivacyPolicy from "./PrivacyPolicy";
import TermsOfService from "./TermsOfService";

describe("Legal pages", () => {
  it("renders the privacy policy with a link to terms", () => {
    render(
      <MemoryRouter>
        <PrivacyPolicy />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: /Privacy Policy/i }),
    ).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: /Terms of Service/i }),
    ).toHaveAttribute("href", "/terms");
  });

  it("renders the terms of service with a link to privacy", () => {
    render(
      <MemoryRouter>
        <TermsOfService />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: /Terms of Service/i }),
    ).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
  });
});
