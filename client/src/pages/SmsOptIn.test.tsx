import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { submitSmsConsent, verifySmsConsent } from "../api/auth";
import SmsOptIn, { SMS_CONSENT_TEXT } from "./SmsOptIn";

jest.mock("../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button" aria-label="Open menu">
    Menu
  </button>
));

jest.mock("../api/auth", () => ({
  ...jest.requireActual("../api/auth"),
  submitSmsConsent: jest.fn(),
  verifySmsConsent: jest.fn(),
}));

const mockedSubmitSmsConsent = submitSmsConsent as jest.MockedFunction<
  typeof submitSmsConsent
>;
const mockedVerifySmsConsent = verifySmsConsent as jest.MockedFunction<
  typeof verifySmsConsent
>;

const renderPage = (churchId = "church_1") =>
  render(
    <MemoryRouter initialEntries={[`/sms-opt-in/${churchId}`]}>
      <Routes>
        <Route path="/sms-opt-in/:churchId" element={<SmsOptIn />} />
      </Routes>
    </MemoryRouter>,
  );

describe("SmsOptIn", () => {
  beforeEach(() => {
    mockedSubmitSmsConsent.mockReset();
    mockedVerifySmsConsent.mockReset();
  });

  it("shows optional SMS updates, unchecked consent, disclosures, and legal links", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Optional SMS updates" })).toBeInTheDocument();
    expect(screen.getByText(/SMS is optional/i)).toBeInTheDocument();
    expect(screen.getByText(/without receiving text messages/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mobile phone number/i)).toBeInTheDocument();
    expect(screen.getByText(SMS_CONSENT_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Opt in to SMS" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No thanks — continue without SMS" })).toBeEnabled();
    expect(screen.getAllByRole("link", { name: "Privacy Policy" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Terms of Service" })).toHaveLength(1);
  });

  it("lets a visitor decline without a phone number or consent and continue", async () => {
    const user = userEvent.setup();
    renderPage("demo");

    await user.click(screen.getByRole("button", { name: "No thanks — continue without SMS" }));

    const confirmation = screen.getByRole("status");
    expect(within(confirmation).getByText("SMS signup skipped")).toBeInTheDocument();
    expect(within(confirmation).getByText(/No new SMS consent was recorded/i)).toBeInTheDocument();
    expect(within(confirmation).getByText(/If you previously subscribed and want to stop receiving messages, reply STOP/i)).toBeInTheDocument();
    expect(within(confirmation).getByRole("link", { name: "Continue to WorshipSync" })).toHaveAttribute("href", "/");
    expect(within(confirmation).getByRole("button", { name: "Return to SMS options" })).toBeEnabled();
    expect(screen.queryByLabelText(/Mobile phone number/i)).not.toBeInTheDocument();
    expect(mockedSubmitSmsConsent).not.toHaveBeenCalled();
    expect(mockedVerifySmsConsent).not.toHaveBeenCalled();
  });

  it("returns to opt-in options after skipping without carrying checkbox consent forward", async () => {
    const user = userEvent.setup();
    renderPage("tenant-with-arbitrary-id");

    await user.click(screen.getByRole("button", { name: "No thanks — continue without SMS" }));
    await user.click(screen.getByRole("button", { name: "Return to SMS options" }));

    expect(screen.getByRole("heading", { name: "Optional SMS updates" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Opt in to SMS" })).toBeDisabled();
    expect(mockedSubmitSmsConsent).not.toHaveBeenCalled();
    expect(mockedVerifySmsConsent).not.toHaveBeenCalled();
  });

  it("formats a U.S. phone number while it is entered", async () => {
    const user = userEvent.setup();
    renderPage();

    const phone = screen.getByLabelText(/Mobile phone number/i);
    await user.type(phone, "9545551234");

    expect(phone).toHaveValue("(954) 555-1234");
  });

  it("keeps submission disabled until affirmative consent is checked", async () => {
    const user = userEvent.setup();
    renderPage();

    const phone = screen.getByLabelText(/Mobile phone number/i);
    const submit = screen.getByRole("button", { name: "Opt in to SMS" });
    await user.type(phone, "(954) 555-1234");

    expect(submit).toBeDisabled();
    expect(mockedSubmitSmsConsent).not.toHaveBeenCalled();
  });

  it("keeps affirmative opt-in disabled for an invalid U.S. phone number", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Mobile phone number/i), "123");
    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("button", { name: "Opt in to SMS" })).toBeDisabled();
    expect(mockedSubmitSmsConsent).not.toHaveBeenCalled();
  });

  it("submits valid phone, asks for a code, then confirms opt-in after verification", async () => {
    mockedSubmitSmsConsent.mockResolvedValue({ success: true, verificationRequired: true });
    mockedVerifySmsConsent.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByLabelText(/Mobile phone number/i),
      "(954) 555-1234",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Opt in to SMS" }));

    expect(mockedSubmitSmsConsent).toHaveBeenCalledWith("church_1", {
      phoneNumber: "(954) 555-1234",
      consent: true,
    });
    expect(await screen.findByLabelText(/Verification code/)).toBeInTheDocument();
    expect(screen.getByText(/sent a 6-digit verification code/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Verification code/), "123456");
    await user.click(screen.getByRole("button", { name: /verify phone/i }));
    expect(mockedVerifySmsConsent).toHaveBeenCalledWith("church_1", {
      phoneNumber: "(954) 555-1234",
      code: "123456",
    });
    expect(await screen.findByText("You're opted in.")).toBeInTheDocument();
    expect(screen.getByText(/reply STOP/i)).toBeInTheDocument();
  });

  it("allows cancellation after a verification error without verifying or revoking consent", async () => {
    mockedSubmitSmsConsent.mockResolvedValue({ success: true, verificationRequired: true });
    mockedVerifySmsConsent.mockRejectedValue(new Error("Incorrect code"));
    const user = userEvent.setup();
    renderPage("demo");

    await user.type(screen.getByLabelText(/Mobile phone number/i), "9545551234");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Opt in to SMS" }));
    await screen.findByLabelText(/Verification code/i);
    await user.type(screen.getByLabelText(/Verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: "Verify phone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not verify your SMS consent. Please try again.",
    );

    await user.click(screen.getByRole("button", { name: "Cancel SMS signup — continue without SMS" }));

    const confirmation = screen.getByRole("status");
    expect(within(confirmation).getByText("SMS signup skipped")).toBeInTheDocument();
    expect(within(confirmation).getByText(/No new SMS consent was recorded/i)).toBeInTheDocument();
    expect(mockedSubmitSmsConsent).toHaveBeenCalledTimes(1);
    expect(mockedVerifySmsConsent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("You're opted in.")).not.toBeInTheDocument();
  });

  it("supports affirmative consent for any provided church tenant ID", async () => {
    mockedSubmitSmsConsent.mockResolvedValue({ success: true, verificationRequired: true });
    const user = userEvent.setup();
    renderPage("demo");

    await user.type(screen.getByLabelText(/Mobile phone number/i), "9545551234");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Opt in to SMS" }));

    expect(mockedSubmitSmsConsent).toHaveBeenCalledWith("demo", {
      phoneNumber: "(954) 555-1234",
      consent: true,
    });
  });
});
