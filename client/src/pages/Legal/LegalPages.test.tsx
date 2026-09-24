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
      screen.getByText("Effective date: September 20, 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Google and YouTube integration/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /SMS and mobile information/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/mobile phone numbers, SMS consent status/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Message frequency varies, and message and data rates may apply/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reply STOP to opt out or HELP for help/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/SMS consent is not required to use the Service/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/We do not sell or share your SMS opt-in data, consent information, mobile phone number, or other personal information with third parties or affiliates for their marketing or promotional purposes/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/messaging providers, only as necessary to provide the messaging service/i),
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
      screen.getByText("Effective date: September 20, 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Indemnification/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Feedback/i })).toBeInTheDocument();
    const smsSection = screen.getByRole("region", {
      name: /SMS Messaging/i,
    });
    expect(smsSection).toHaveTextContent(
      /transactional messages through WorshipSync related to church or team activity/i,
    );
    expect(smsSection).toHaveTextContent(
      /volunteer availability requests, scheduling updates, assignment notifications, and reminders/i,
    );
    expect(smsSection).toHaveTextContent(/message frequency varies/i);
    expect(smsSection).toHaveTextContent(/message and data rates may apply/i);
    expect(smsSection).toHaveTextContent(/reply STOP to opt out/i);
    expect(smsSection).toHaveTextContent(/HELP for assistance/i);
    expect(smsSection).toHaveTextContent(
      /Consent to SMS messages is optional and is not required to use WorshipSync/i,
    );
    expect(smsSection).toHaveTextContent(
      /Opting out of SMS does not prevent you from using other WorshipSync features or other available communication methods/i,
    );
    expect(smsSection).toHaveTextContent(
      /Carriers are not liable for delayed or undelivered messages/i,
    );
    expect(smsSection).toHaveTextContent(
      /Organizations are responsible for obtaining any consent required by law before initiating SMS communications to their volunteers or members/i,
    );
    expect(
      within(smsSection).getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      within(smsSection).getByRole("link", { name: "support@worshipsync.net" }),
    ).toHaveAttribute("href", "mailto:support@worshipsync.net");
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
  });
});
