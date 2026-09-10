import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthApiError, submitSupportContact } from "../api/auth";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import Support, { SUPPORT_EMAIL, SUPPORT_MAILTO } from "./Support";

jest.mock("../components/HomeToolbarMenu/HomeToolbarMenu", () => () => (
  <button type="button" aria-label="Open menu">
    Menu
  </button>
));

jest.mock("../api/auth", () => {
  const actual = jest.requireActual("../api/auth");
  return {
    ...actual,
    submitSupportContact: jest.fn(),
  };
});

const mockedSubmitSupportContact = submitSupportContact as jest.MockedFunction<
  typeof submitSupportContact
>;

const renderSupport = (
  contextOverrides: Record<string, unknown> = {},
) =>
  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "loggedOut",
            user: "",
            userEmail: "",
            churchName: "",
            ...contextOverrides,
          }) as never
        }
      >
        <Support />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

describe("Support", () => {
  beforeEach(() => {
    mockedSubmitSupportContact.mockReset();
  });

  it("renders the form, mailto fallback, and legal footer links", () => {
    renderSupport();

    expect(
      screen.getByRole("button", { name: "Open menu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^Support$/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/How can we help/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: SUPPORT_EMAIL }),
    ).toHaveAttribute("href", SUPPORT_MAILTO);

    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      within(footer).getByRole("link", { name: /Terms of Service/i }),
    ).toHaveAttribute("href", "/terms");
  });

  it("prefills name, email, and church when signed in", () => {
    renderSupport({
      loginState: "success",
      user: "Alex Operator",
      userEmail: "alex@example.com",
      churchName: "First Church",
    });

    expect(screen.getByLabelText(/^Name:/i)).toHaveValue("Alex Operator");
    expect(screen.getByLabelText(/^Email:/i)).toHaveValue("alex@example.com");
    expect(screen.getByLabelText(/Church name/i)).toHaveValue("First Church");
  });

  it("submits the support form and shows a confirmation", async () => {
    const user = userEvent.setup();
    mockedSubmitSupportContact.mockResolvedValue({ success: true });

    renderSupport();

    await user.type(screen.getByLabelText(/^Name:/i), "Alex Operator");
    await user.type(screen.getByLabelText(/^Email:/i), "alex@example.com");
    await user.type(
      screen.getByLabelText(/Church name/i),
      "First Church",
    );
    await user.type(
      screen.getByLabelText(/How can we help/i),
      "Projector window will not open on Sunday.",
    );
    await user.click(screen.getByRole("button", { name: /Send message/i }));

    expect(mockedSubmitSupportContact).toHaveBeenCalledWith({
      name: "Alex Operator",
      email: "alex@example.com",
      churchName: "First Church",
      message: "Projector window will not open on Sunday.",
      company: "",
    });
    expect(await screen.findByText(/Message sent/i)).toBeInTheDocument();
    expect(
      screen.getByText(/We'll reply to the email you provided/i),
    ).toBeInTheDocument();
  });

  it("shows a steady error when the request fails", async () => {
    const user = userEvent.setup();
    mockedSubmitSupportContact.mockRejectedValue(
      new AuthApiError("Too many attempts. Wait a moment and try again.", {
        status: 429,
      }),
    );

    renderSupport();

    await user.type(screen.getByLabelText(/^Name:/i), "Alex Operator");
    await user.type(screen.getByLabelText(/^Email:/i), "alex@example.com");
    await user.type(
      screen.getByLabelText(/How can we help/i),
      "Projector window will not open on Sunday.",
    );
    await user.click(screen.getByRole("button", { name: /Send message/i }));

    expect(
      await screen.findByText(/Too many attempts/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send message/i })).toBeEnabled();
  });
});
