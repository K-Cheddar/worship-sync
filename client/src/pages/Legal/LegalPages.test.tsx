import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivacyPolicy from "./PrivacyPolicy";
import TermsOfService from "./TermsOfService";

jest.mock("../../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button" aria-label="Open menu">
    Menu
  </button>
));

describe("Legal pages", () => {
  it("renders the privacy policy with a link to terms", () => {
    render(
      <MemoryRouter>
        <PrivacyPolicy />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Open menu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Privacy Policy/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Google and YouTube integration/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "support@worshipsync.net" }),
    ).toHaveAttribute("href", "mailto:support@worshipsync.net");
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
      screen.getByRole("button", { name: "Open menu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Terms of Service/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Indemnification/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Feedback/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "support@worshipsync.net" }),
    ).toHaveAttribute("href", "mailto:support@worshipsync.net");
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
  });
});
