import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Login from "../Login";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";

const createChurchAccountMock = jest.fn();

jest.mock("../../utils/devFeatures", () => ({
  isCreateChurchUiEnabled: () => true,
}));

jest.mock("../../utils/environment", () => ({
  ...jest.requireActual<typeof import("../../utils/environment")>(
    "../../utils/environment",
  ),
  isElectron: () => false,
}));

const renderLogin = (overrides: Record<string, unknown> = {}) => {
  const context = createMockGlobalContext({
    loginState: "idle",
    sessionKind: null,
    user: "",
    userId: "",
    createChurchAccount: createChurchAccountMock,
    ...overrides,
  });
  return {
    context,
    ...render(
      <MemoryRouter initialEntries={["/login"]}>
        <GlobalInfoContext.Provider value={context as never}>
          <Login />
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    ),
  };
};

const openCreateChurchForm = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  await user.click(screen.getByRole("button", { name: "Create church" }));
  expect(
    screen.getByRole("heading", { name: "Create a church" }),
  ).toBeInTheDocument();
};

describe("Login create church (dev)", () => {
  beforeEach(() => {
    createChurchAccountMock.mockReset();
    createChurchAccountMock.mockResolvedValue({
      requiresEmailCode: true,
      pendingAuthId: "pending-create-1",
      verificationEmail: "admin@example.com",
    });
  });

  it("opens the create-church form from the sign-in screen", async () => {
    const user = userEvent.setup();
    renderLogin();

    await openCreateChurchForm(user);

    expect(screen.getByLabelText(/church name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/admin name/i)).toBeInTheDocument();
  });

  it("creates a church with email and password, then asks for the email code", async () => {
    const user = userEvent.setup();
    renderLogin();

    await openCreateChurchForm(user);
    await user.type(screen.getByLabelText(/church name/i), "Northside");
    await user.type(screen.getByLabelText(/admin name/i), "Alex Admin");
    await user.type(screen.getByLabelText(/admin email/i), "admin@example.com");
    await user.type(
      screen.getByLabelText(/password/i, { selector: "input" }),
      "SecurePass1!",
    );
    await user.click(screen.getByRole("button", { name: "Create church" }));

    await waitFor(() => {
      expect(createChurchAccountMock).toHaveBeenCalledWith({
        method: "password",
        churchName: "Northside",
        adminName: "Alex Admin",
        adminEmail: "admin@example.com",
        password: "SecurePass1!",
      });
    });

    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
  });

  it("creates a church with Google after church and admin names are filled", async () => {
    const user = userEvent.setup();
    renderLogin();

    await openCreateChurchForm(user);
    await user.type(screen.getByLabelText(/church name/i), "Grace Chapel");
    await user.type(screen.getByLabelText(/admin name/i), "Jordan Leader");
    await user.click(
      screen.getByRole("button", { name: "Create with Google" }),
    );

    await waitFor(() => {
      expect(createChurchAccountMock).toHaveBeenCalledWith({
        method: "google",
        churchName: "Grace Chapel",
        adminName: "Jordan Leader",
      });
    });

    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
  });

  it("requires church and admin names before creating with a provider", async () => {
    const user = userEvent.setup();
    renderLogin();

    await openCreateChurchForm(user);
    await user.click(
      screen.getByRole("button", { name: "Create with Google" }),
    );

    expect(createChurchAccountMock).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the church name.")).toBeInTheDocument();
    expect(screen.getByText("Enter the admin name.")).toBeInTheDocument();
  });
});
