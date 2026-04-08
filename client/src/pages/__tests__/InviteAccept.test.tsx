import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InviteAccept from "../InviteAccept";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import * as firebaseApps from "../../firebase/apps";

const navigateMock = jest.fn();
const acceptInviteMock = jest.fn();
const fetchInvitePreviewMock = jest.fn();
const createHumanSessionMock = jest.fn();
const getAuthBootstrapMock = jest.fn();
const logoutSessionMock = jest.fn(() => Promise.resolve());
const createUserWithEmailAndPasswordMock = jest.fn();
const signOutMock = jest.fn(() => Promise.resolve());
const updateProfileMock = jest.fn(() => Promise.resolve());

type MockFirebaseUser = {
  email: string;
  getIdToken: jest.Mock<Promise<string>, [boolean?]>;
  delete: jest.Mock<Promise<void>, []>;
};

let authStateChangedCallback: ((user: MockFirebaseUser | null) => void) | null = null;

const mockAuth = {
  currentUser: null as MockFirebaseUser | null,
  onAuthStateChanged: jest.fn((callback: (user: MockFirebaseUser | null) => void) => {
    authStateChangedCallback = callback;
    callback(mockAuth.currentUser);
    return jest.fn();
  }),
};

const setCurrentUser = (user: MockFirebaseUser | null) => {
  mockAuth.currentUser = user;
  authStateChangedCallback?.(user);
};

jest.mock("../../api/auth", () => ({
  acceptInvite: (...args: unknown[]) => acceptInviteMock(...args),
  createHumanSession: (...args: unknown[]) => createHumanSessionMock(...args),
  getAuthBootstrap: (...args: unknown[]) => getAuthBootstrapMock(...args),
  logoutSession: (...args: unknown[]) => logoutSessionMock(...args),
  fetchInvitePreview: (...args: unknown[]) => fetchInvitePreviewMock(...args),
}));

jest.mock("../../firebase/apps", () => ({
  getHumanAuth: jest.fn(() => mockAuth),
}));

jest.mock("../../utils/authStorage", () => ({
  getOrCreateDeviceId: jest.fn(() => "device-1"),
}));

jest.mock("../../utils/deviceInfo", () => ({
  getTrustedDeviceLabel: jest.fn(() => "Chrome on Windows"),
}));

jest.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    createUserWithEmailAndPasswordMock(...args),
  signOut: (...args: unknown[]) => signOutMock(...args),
  updateProfile: (...args: unknown[]) => updateProfileMock(...args),
}));

jest.mock("react-router-dom", () => {
  const actual = jest.requireActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const renderPage = ({
  refreshAuthBootstrap = jest.fn(() => Promise.resolve()),
  initialEntry = "/invite?token=invite-token",
}: {
  refreshAuthBootstrap?: jest.Mock<Promise<void>, []>;
  initialEntry?: string;
} = {}) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            refreshAuthBootstrap,
          }) as any
        }
      >
        <InviteAccept />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

describe("InviteAccept", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    acceptInviteMock.mockReset();
    createHumanSessionMock.mockReset();
    getAuthBootstrapMock.mockReset();
    logoutSessionMock.mockClear();
    createUserWithEmailAndPasswordMock.mockReset();
    signOutMock.mockClear();
    updateProfileMock.mockClear();
    window.sessionStorage.clear();
    authStateChangedCallback = null;
    setCurrentUser(null);
    (firebaseApps.getHumanAuth as jest.Mock).mockReturnValue(mockAuth);
    getAuthBootstrapMock.mockResolvedValue({
      authenticated: true,
      sessionKind: "human",
    });
    fetchInvitePreviewMock.mockReset();
    fetchInvitePreviewMock.mockResolvedValue({
      success: true,
      churchName: "Test Church",
    });
  });

  it("shows the invited church name in the heading", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: /join test church/i }),
    ).toBeInTheDocument();
  });

  it("creates account with Firebase, accepts invite, then routes to code verification", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };

    createUserWithEmailAndPasswordMock.mockImplementation(async () => {
      setCurrentUser(signedInUser);
      return { user: signedInUser };
    });
    acceptInviteMock.mockResolvedValue({
      success: true,
      churchId: "church-1",
      email: "invited@example.com",
    });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-123",
    });

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "secret-pass");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));

    await waitFor(() => {
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(
        mockAuth,
        "invited@example.com",
        "secret-pass",
      );
    });
    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith({
        token: "invite-token",
        idToken: "firebase-id-token",
      });
    });
    await waitFor(() => {
      expect(createHumanSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idToken: "firebase-id-token",
          requestNewCode: true,
        }),
      );
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/login?pendingAuthId=pending-123", {
        replace: true,
        state: { from: { pathname: "/invite" } },
      });
    });
  });

  it("deletes a newly created Firebase account when invite acceptance fails", async () => {
    const user = userEvent.setup();
    const createdUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("bad-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };

    createUserWithEmailAndPasswordMock.mockImplementation(async () => {
      setCurrentUser(createdUser);
      return { user: createdUser };
    });
    acceptInviteMock.mockRejectedValue(new Error("Could not complete this invite."));

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Wrong User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "secret-pass");
    await user.click(
      screen.getByRole("button", { name: /^accept invite$/i }),
    );

    await waitFor(() => {
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(
        mockAuth,
        "invited@example.com",
        "secret-pass",
      );
    });
    await waitFor(() => {
      expect(createdUser.delete).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledWith(mockAuth);
    });
    expect(
      await screen.findByText(/Could not complete this invite\./i),
    ).toBeInTheDocument();
  });

  it("does not delete a newly created user when invite is accepted but session bootstrap fails", async () => {
    const user = userEvent.setup();
    const createdUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };

    createUserWithEmailAndPasswordMock.mockImplementation(async () => {
      setCurrentUser(createdUser);
      return { user: createdUser };
    });
    acceptInviteMock.mockResolvedValue({ success: true });
    createHumanSessionMock.mockRejectedValue(
      new Error("Could not reach the server. Check your connection and try again."),
    );

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "secret-pass");
    await user.click(
      screen.getByRole("button", { name: /^accept invite$/i }),
    );

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith({
        token: "invite-token",
        idToken: "firebase-id-token",
      });
    });
    await waitFor(() => {
      expect(createHumanSessionMock).toHaveBeenCalled();
    });
    expect(createdUser.delete).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("retries session creation without re-accepting invite after partial success", async () => {
    const user = userEvent.setup();
    const createdUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };

    createUserWithEmailAndPasswordMock.mockImplementation(async () => {
      setCurrentUser(createdUser);
      return { user: createdUser };
    });
    acceptInviteMock.mockResolvedValue({ success: true });
    createHumanSessionMock
      .mockRejectedValueOnce(
        new Error("Invite accepted, but we could not finish sign-in. Select Continue sign-in."),
      )
      .mockResolvedValueOnce({
        success: true,
        requiresEmailCode: true,
        pendingAuthId: "retry-pending-123",
      });

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "secret-pass");
    await user.click(
      screen.getByRole("button", { name: /^accept invite$/i }),
    );

    await screen.findByRole("button", { name: /continue sign-in/i });
    await user.click(screen.getByRole("button", { name: /continue sign-in/i }));

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(createHumanSessionMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/login?pendingAuthId=retry-pending-123", {
        replace: true,
        state: { from: { pathname: "/invite" } },
      });
    });
  });

  it("restores accepted-invite recovery after refresh and retries session without re-accept", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    setCurrentUser(signedInUser);
    window.sessionStorage.setItem(
      "worshipsync_invite_recovery",
      JSON.stringify({
        accepted: true,
        token: "invite-token",
        acceptedAt: Date.now(),
      }),
    );
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-recovered",
    });

    renderPage({ initialEntry: "/invite" });

    await user.click(await screen.findByRole("button", { name: /continue sign-in/i }));

    await waitFor(() => {
      expect(acceptInviteMock).not.toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(createHumanSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idToken: "firebase-id-token",
          requestNewCode: true,
        }),
      );
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/login?pendingAuthId=pending-recovered", {
        replace: true,
        state: { from: { pathname: "/invite" } },
      });
    });
  });

  it("does not navigate home when trusted bootstrap cannot be confirmed", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };

    createUserWithEmailAndPasswordMock.mockImplementation(async () => {
      setCurrentUser(signedInUser);
      return { user: signedInUser };
    });
    acceptInviteMock.mockResolvedValue({ success: true });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      bootstrap: { authenticated: true },
    });
    getAuthBootstrapMock.mockResolvedValue({
      authenticated: false,
      sessionKind: null,
    });

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "secret-pass");
    await user.click(
      screen.getByRole("button", { name: /^accept invite$/i }),
    );

    await waitFor(() => {
      expect(navigateMock).not.toHaveBeenCalledWith("/home", { replace: true });
    });
    expect(
      await screen.findByText(
        /Invite accepted, but we could not finish sign-in\. Select Continue sign-in\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue sign-in/i }),
    ).toBeInTheDocument();
  });

  it("submits create-account form on Enter key from password input", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    createUserWithEmailAndPasswordMock.mockImplementation(async () => {
      setCurrentUser(signedInUser);
      return { user: signedInUser };
    });
    acceptInviteMock.mockResolvedValue({ success: true });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-enter",
    });

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "secret-pass{Enter}");

    await waitFor(() => {
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalled();
    });
  });
});
