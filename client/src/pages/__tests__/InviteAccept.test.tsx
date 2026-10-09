import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InviteAccept from "../InviteAccept";
import {
  acceptInvite,
  cancelInviteSmsConsent,
  createHumanSession,
  fetchInviteSmsContext,
  fetchInvitePreview,
  getAuthBootstrap,
  logoutSession,
  submitInviteSmsConsent,
  verifyInviteSmsConsent,
} from "../../api/auth";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import * as firebaseApps from "../../firebase/apps";

const navigateMock = jest.fn();
const createUserWithEmailAndPasswordMock = jest.fn<any, any[]>();
const signOutMock = jest.fn<any, any[]>(() => Promise.resolve());
const updateProfileMock = jest.fn<any, any[]>(() => Promise.resolve());
const authenticateHumanWithFirebaseMock = jest.fn();

const acceptInviteMock = jest.mocked(acceptInvite);
const fetchInvitePreviewMock = jest.mocked(fetchInvitePreview);
const fetchInviteSmsContextMock = jest.mocked(fetchInviteSmsContext);
const cancelInviteSmsConsentMock = jest.mocked(cancelInviteSmsConsent);
const createHumanSessionMock = jest.mocked(createHumanSession);
const getAuthBootstrapMock = jest.mocked(getAuthBootstrap);
const logoutSessionMock = jest.mocked(logoutSession);
const submitInviteSmsConsentMock = jest.mocked(submitInviteSmsConsent);
const verifyInviteSmsConsentMock = jest.mocked(verifyInviteSmsConsent);

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
  acceptInvite: jest.fn(),
  createHumanSession: jest.fn(),
  getAuthBootstrap: jest.fn(),
  logoutSession: jest.fn(),
  fetchInvitePreview: jest.fn(),
  fetchInviteSmsContext: jest.fn(),
  cancelInviteSmsConsent: jest.fn(),
  submitInviteSmsConsent: jest.fn(),
  verifyInviteSmsConsent: jest.fn(),
}));

jest.mock("../../firebase/apps", () => ({
  getHumanAuth: jest.fn(() => mockAuth),
}));

jest.mock("../../utils/authStorage", () => ({
  ...jest.requireActual<typeof import("../../utils/authStorage")>(
    "../../utils/authStorage",
  ),
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
            authenticateHumanWithFirebase: authenticateHumanWithFirebaseMock,
          }) as any
        }
      >
        <InviteAccept />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

describe("InviteAccept", () => {
  jest.setTimeout(15_000);

  beforeEach(() => {
    navigateMock.mockReset();
    acceptInviteMock.mockReset();
    createHumanSessionMock.mockReset();
    getAuthBootstrapMock.mockReset();
    logoutSessionMock.mockReset();
    submitInviteSmsConsentMock.mockReset();
    fetchInviteSmsContextMock.mockReset();
    cancelInviteSmsConsentMock.mockReset();
    verifyInviteSmsConsentMock.mockReset();
    logoutSessionMock.mockResolvedValue({ success: true });
    createUserWithEmailAndPasswordMock.mockReset();
    signOutMock.mockClear();
    updateProfileMock.mockClear();
    authenticateHumanWithFirebaseMock.mockReset();
    window.sessionStorage.clear();
    authStateChangedCallback = null;
    setCurrentUser(null);
    (firebaseApps.getHumanAuth as jest.Mock).mockReturnValue(mockAuth);
    getAuthBootstrapMock.mockResolvedValue({
      authenticated: true,
      sessionKind: "human",
    });
    fetchInvitePreviewMock.mockReset();
    fetchInvitePreviewMock.mockImplementation(() =>
      Promise.resolve({
        success: true,
        churchName: "Test Church",
        smsInviteConsentEnabled: true,
      }),
    );
    fetchInviteSmsContextMock.mockResolvedValue({
      success: true,
      smsInviteConsentEnabled: true,
      rosterPhoneNumber: "+12125550123",
      smsConsentStatus: "none",
    });
    cancelInviteSmsConsentMock.mockResolvedValue({ success: true, cancelled: true });
  });

  it("keeps Home available in the shared menu while accepting an invite", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const homeItem = screen.getByRole("menuitem", { name: "Home" });
    expect(homeItem).toHaveAttribute(
      "href",
      "/",
    );
    await user.click(homeItem);
  });

  it("shows the invited church name in the heading", async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchInvitePreviewMock).toHaveBeenCalledWith("invite-token");
    });
    expect(
      await screen.findByRole(
        "heading",
        { name: /join test church/i },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  it("redirects provider collisions to login so the existing method can link", async () => {
    const user = userEvent.setup();
    authenticateHumanWithFirebaseMock.mockResolvedValue({
      status: "requires-existing-method",
    });

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() => {
      expect(authenticateHumanWithFirebaseMock).toHaveBeenCalledWith({
        method: "google",
      });
    });
    expect(navigateMock).toHaveBeenCalledWith("/login", {
      replace: true,
      state: { from: { pathname: "/invite" } },
    });
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });

  it("shows a safe message when Microsoft provider sign-in fails", async () => {
    const user = userEvent.setup();
    authenticateHumanWithFirebaseMock.mockRejectedValue(
      Object.assign(new Error("AADSTS7000215 invalid_client"), {
        code: "auth/invalid-credential",
      }),
    );

    renderPage();

    await user.click(
      await screen.findByRole("button", { name: /continue with microsoft/i }),
    );

    expect(
      await screen.findByText(
        /Could not sign in with Microsoft\. Please try again\./i,
      ),
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
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));

    await waitFor(() => {
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(
        mockAuth,
        "invited@example.com",
        "Secret-pass1!",
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
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(
      screen.getByRole("button", { name: /^accept invite$/i }),
    );

    await waitFor(() => {
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith(
        mockAuth,
        "invited@example.com",
        "Secret-pass1!",
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
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
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
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
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
      bootstrap: { authenticated: true, sessionKind: "human" },
    });
    getAuthBootstrapMock.mockResolvedValue({
      authenticated: false,
      sessionKind: null,
    });

    renderPage();

    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
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
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!{Enter}");

    await waitFor(() => {
      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalled();
    });
  });

  it("keeps roster phone details private until the invited identity is accepted", async () => {
    renderPage();
    await waitFor(() => expect(fetchInvitePreviewMock).toHaveBeenCalledWith("invite-token"));
    expect(screen.queryByText("+12125550123")).not.toBeInTheDocument();
    expect(fetchInviteSmsContextMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i })).not.toBeChecked();
    expect(screen.queryByLabelText(/mobile phone number/i)).not.toBeInTheDocument();
    expect(submitInviteSmsConsentMock).not.toHaveBeenCalled();
  });

  it("uses the same SMS choice for an existing account and accepts an already active number", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    setCurrentUser(signedInUser);
    acceptInviteMock.mockResolvedValue({ success: true });
    fetchInviteSmsContextMock.mockResolvedValue({
      success: true,
      smsInviteConsentEnabled: true,
      rosterPhoneNumber: "+12125550123",
      smsConsentStatus: "opted_in",
    });
    submitInviteSmsConsentMock.mockResolvedValue({
      success: true,
      outcome: "already_opted_in",
    });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "existing-user-pending",
    });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    await user.click(screen.getByRole("button", { name: /accept invite with this account/i }));

    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
    expect(submitInviteSmsConsentMock).not.toHaveBeenCalled();
    expect(verifyInviteSmsConsentMock).not.toHaveBeenCalled();
    expect(acceptInviteMock).toHaveBeenCalledTimes(1);
  });

  it("lets a new email account opt in and activates consent only after the OTP succeeds", async () => {
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
    acceptInviteMock.mockResolvedValue({ success: true, churchId: "church-1" });
    submitInviteSmsConsentMock.mockResolvedValue({
      success: true,
      outcome: "verification_required",
      challengeId: "a".repeat(32),
      cancellationToken: "b".repeat(43),
    });
    verifyInviteSmsConsentMock.mockResolvedValue({ success: true });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "sms-email-pending",
    });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));

    const phoneConfirmation = await screen.findByRole("checkbox", { name: /reviewed and confirm this exact mobile number/i });
    expect(submitInviteSmsConsentMock).not.toHaveBeenCalled();
    await user.click(phoneConfirmation);
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    const codeInput = await screen.findByLabelText(/verification code/i);
    expect(submitInviteSmsConsentMock).toHaveBeenCalledWith(expect.objectContaining({
      inviteToken: "invite-token",
      idToken: "firebase-id-token",
      phoneNumber: "+12125550123",
      expectedRosterPhoneNumber: "+12125550123",
      consent: true,
    }));
    expect(createHumanSessionMock).not.toHaveBeenCalled();

    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: /verify phone/i }));
    await waitFor(() => expect(verifyInviteSmsConsentMock).toHaveBeenCalledWith(expect.objectContaining({
      inviteToken: "invite-token",
      phoneNumber: "+12125550123",
      code: "123456",
      challengeId: "a".repeat(32),
    })));
    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
    expect(acceptInviteMock).toHaveBeenCalledTimes(1);
  });

  it.each(["123", ""])(
    "shows inline validation for invalid or missing fallback phone (%s) and lets signup continue without SMS",
    async (phoneDraft) => {
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
    fetchInviteSmsContextMock.mockResolvedValue({
      success: true,
      smsInviteConsentEnabled: true,
      smsConsentStatus: "none",
    });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "invalid-phone-pending",
    });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    if (phoneDraft) await user.type(screen.getByLabelText(/mobile phone number/i), phoneDraft);
    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));

    expect(await screen.findByLabelText(/mobile phone number/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByRole("alert").some((alert) => /enter a valid 10-digit u\.s\. mobile number/i.test(alert.textContent || ""))).toBe(true);
    expect(submitInviteSmsConsentMock).not.toHaveBeenCalled();
    expect(createHumanSessionMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /continue without sms/i }));
    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
    expect(acceptInviteMock).toHaveBeenCalledTimes(1);
    expect(signedInUser.delete).not.toHaveBeenCalled();
    },
  );

  it.each(["google", "microsoft"] as const)(
    "%s signup shares the invitation SMS flow and can skip after choosing to opt in",
    async (method) => {
      const user = userEvent.setup();
      const signedInUser: MockFirebaseUser = {
        email: "invited@example.com",
        getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
        delete: jest.fn(() => Promise.resolve()),
      };
      authenticateHumanWithFirebaseMock.mockImplementation(async () => {
        setCurrentUser(signedInUser);
        return { status: "signed-in" };
      });
      acceptInviteMock.mockResolvedValue({ success: true });
      submitInviteSmsConsentMock.mockResolvedValue({
        success: true,
        outcome: "verification_required",
        challengeId: "c".repeat(32),
        cancellationToken: "d".repeat(43),
      });
      createHumanSessionMock.mockResolvedValue({
        success: true,
        requiresEmailCode: true,
        pendingAuthId: `${method}-pending`,
      });

      renderPage();
      await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
      await user.click(screen.getByRole("button", { name: new RegExp(`continue with ${method}`, "i") }));
      await user.click(await screen.findByRole("checkbox", { name: /reviewed and confirm this exact mobile number/i }));
      await user.click(screen.getByRole("button", { name: /send verification code/i }));
      await screen.findByLabelText(/verification code/i);
      expect(submitInviteSmsConsentMock).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("button", { name: /continue without sms/i }));
      await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
      expect(cancelInviteSmsConsentMock).toHaveBeenCalledWith(expect.objectContaining({
        challengeId: "c".repeat(32),
        cancellationToken: "d".repeat(43),
      }));
      expect(verifyInviteSmsConsentMock).not.toHaveBeenCalled();
      expect(acceptInviteMock).toHaveBeenCalledTimes(1);
    },
  );

  it("recovers a pending SMS step after refresh without accepting the invite again", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    setCurrentUser(signedInUser);
    window.sessionStorage.setItem("worshipsync_invite_recovery", JSON.stringify({
      accepted: true,
      token: "invite-token",
      acceptedAt: Date.now(),
      smsConsentChecked: true,
      smsVerification: {
        phoneNumber: "+12125550123",
        expectedRosterPhoneNumber: "+12125550123",
        challengeId: "e".repeat(32),
        cancellationToken: "f".repeat(43),
      },
    }));
    verifyInviteSmsConsentMock.mockResolvedValue({ success: true });
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "recovered-sms-pending",
    });

    renderPage({ initialEntry: "/invite" });
    await user.type(await screen.findByLabelText(/verification code/i), "654321");
    await user.click(screen.getByRole("button", { name: /verify phone/i }));
    await waitFor(() => expect(acceptInviteMock).not.toHaveBeenCalled());
    await waitFor(() => expect(verifyInviteSmsConsentMock).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "e".repeat(32),
      code: "654321",
    })));
    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
  });

  it("keeps an accepted invite and new account when SMS delivery fails", async () => {
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
    submitInviteSmsConsentMock.mockRejectedValue(new Error("SMS verification is unavailable."));
    createHumanSessionMock.mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "delivery-failure-pending",
    });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));
    await user.click(await screen.findByRole("checkbox", { name: /reviewed and confirm this exact mobile number/i }));
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    expect(await screen.findByText(/sms delivery result is uncertain/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry sms verification/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue without sms/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue without sms/i }));
    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
    expect(acceptInviteMock).toHaveBeenCalledTimes(1);
    expect(signedInUser.delete).not.toHaveBeenCalled();
  });

  it("offers a fresh OTP retry only after a definitive provider rejection", async () => {
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
    submitInviteSmsConsentMock
      .mockRejectedValueOnce(Object.assign(new Error("Provider rejected the text."), {
        details: { outcome: "delivery_failed" },
      }))
      .mockResolvedValueOnce({
        success: true,
        outcome: "verification_required",
        deliveryStatus: "sent",
        challengeId: "k".repeat(32),
        cancellationToken: "l".repeat(43),
      });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));
    await user.click(await screen.findByRole("checkbox", { name: /reviewed and confirm this exact mobile number/i }));
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    expect(await screen.findByText(/provider rejected the text/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry sms verification/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry sms verification/i }));
    await screen.findByLabelText(/verification code/i);
    expect(submitInviteSmsConsentMock).toHaveBeenCalledTimes(2);
  });

  it("renews an expired SMS challenge with a new capability and verifies the replacement code", async () => {
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
    submitInviteSmsConsentMock
      .mockResolvedValueOnce({ success: true, outcome: "verification_required", deliveryStatus: "sent", challengeId: "m".repeat(32), cancellationToken: "n".repeat(43) })
      .mockResolvedValueOnce({ success: true, outcome: "verification_required", deliveryStatus: "sent", challengeId: "o".repeat(32), cancellationToken: "p".repeat(43) });
    verifyInviteSmsConsentMock
      .mockRejectedValueOnce(Object.assign(new Error("That verification code expired."), { details: { code: "sms_challenge_expired" } }))
      .mockResolvedValueOnce({ success: true });
    createHumanSessionMock.mockResolvedValue({ success: true, requiresEmailCode: true, pendingAuthId: "sms-renewed" });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));
    await user.click(await screen.findByRole("checkbox", { name: /reviewed and confirm this exact mobile number/i }));
    await user.click(screen.getByRole("button", { name: /send verification code/i }));
    await user.type(await screen.findByLabelText(/verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify phone/i }));

    expect(await screen.findByText(/this verification code expired or is no longer available/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /request a new code/i }));
    await waitFor(() => expect(submitInviteSmsConsentMock).toHaveBeenCalledTimes(2));
    expect(submitInviteSmsConsentMock.mock.calls[1][0].challengeId).not.toBe(submitInviteSmsConsentMock.mock.calls[0][0].challengeId);
    expect(submitInviteSmsConsentMock.mock.calls[1][0].cancellationToken).not.toBe(submitInviteSmsConsentMock.mock.calls[0][0].cancellationToken);
    expect(submitInviteSmsConsentMock.mock.calls[1][0].inviteToken).toBe("invite-token");
    await user.clear(screen.getByLabelText(/verification code/i));
    await user.type(screen.getByLabelText(/verification code/i), "654321");
    await user.click(screen.getByRole("button", { name: /verify phone/i }));
    await waitFor(() => expect(verifyInviteSmsConsentMock).toHaveBeenLastCalledWith(expect.objectContaining({
      challengeId: "o".repeat(32), code: "654321",
    })));
    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalled());
  });

  it("shows definitive pre-send rejections and allows a fresh request without calling it uncertain", async () => {
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
    submitInviteSmsConsentMock
      .mockRejectedValueOnce(Object.assign(new Error("Too many attempts. Wait a moment and try again."), { status: 429, details: { outcome: "rejected_before_send" } }))
      .mockResolvedValueOnce({ success: true, outcome: "verification_required", deliveryStatus: "sent", challengeId: "q".repeat(32), cancellationToken: "r".repeat(43) });

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: /i agree to receive sms messages/i }));
    await user.type(screen.getByLabelText(/email/i), "invited@example.com");
    await user.type(screen.getByLabelText(/^name/i), "Invited User");
    await user.type(screen.getByLabelText(/password/i, { selector: "input" }), "Secret-pass1!");
    await user.click(screen.getByRole("button", { name: /^accept invite$/i }));
    await user.click(await screen.findByRole("checkbox", { name: /reviewed and confirm this exact mobile number/i }));
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.queryByText(/sms delivery result is uncertain/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send verification code/i }));
    await screen.findByLabelText(/verification code/i);
    expect(submitInviteSmsConsentMock).toHaveBeenCalledTimes(2);
  });

  it("retries cancellation with the same capability after an uncertain response", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    setCurrentUser(signedInUser);
    window.sessionStorage.setItem("worshipsync_pending_invite_token", "invite-token");
    window.sessionStorage.setItem("worshipsync_invite_recovery", JSON.stringify({
      accepted: true,
      token: "invite-token",
      acceptedAt: Date.now(),
      smsConsentChecked: true,
      smsVerification: {
        phoneNumber: "+12125550123",
        expectedRosterPhoneNumber: "+12125550123",
        challengeId: "g".repeat(32),
        cancellationToken: "h".repeat(43),
      },
    }));
    cancelInviteSmsConsentMock
      .mockRejectedValueOnce(new Error("Network response was lost"))
      .mockResolvedValueOnce({ success: true, cancelled: true });
    createHumanSessionMock.mockRejectedValue(new Error("Session unavailable"));

    renderPage({ initialEntry: "/invite" });
    await user.click(await screen.findByRole("button", { name: /continue without sms/i }));
    expect(await screen.findByText(/could not confirm sms signup cancellation/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("worshipsync_invite_sms_cancel:invite-token")).toContain("gggg");
    await user.click(screen.getByRole("button", { name: /continue without sms/i }));
    await waitFor(() => expect(cancelInviteSmsConsentMock).toHaveBeenCalledTimes(2));
    expect(cancelInviteSmsConsentMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ challengeId: "g".repeat(32) }));
    expect(cancelInviteSmsConsentMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ challengeId: "g".repeat(32) }));
  });

  it("shows Continue without SMS as busy before cancellation settles and blocks duplicate actions", async () => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    setCurrentUser(signedInUser);
    window.sessionStorage.setItem("worshipsync_pending_invite_token", "invite-token");
    window.sessionStorage.setItem("worshipsync_invite_recovery", JSON.stringify({
      accepted: true, token: "invite-token", acceptedAt: Date.now(), smsConsentChecked: true,
      smsVerification: {
        phoneNumber: "+12125550123", expectedRosterPhoneNumber: "+12125550123",
        challengeId: "s".repeat(32), cancellationToken: "t".repeat(43),
      },
    }));
    let finishCancellation!: (result: { success: boolean; cancelled: boolean }) => void;
    cancelInviteSmsConsentMock.mockReturnValueOnce(new Promise((resolve) => { finishCancellation = resolve; }));
    createHumanSessionMock.mockResolvedValue({ success: true, requiresEmailCode: true, pendingAuthId: "sms-skip-pending" });

    renderPage({ initialEntry: "/invite" });
    const continueButton = await screen.findByRole("button", { name: /continue without sms/i });
    await user.click(continueButton);
    await waitFor(() => expect(cancelInviteSmsConsentMock).toHaveBeenCalledTimes(1));
    expect(continueButton).toBeDisabled();
    expect(continueButton).toHaveAttribute("aria-busy", "true");
    await user.click(continueButton);
    expect(cancelInviteSmsConsentMock).toHaveBeenCalledTimes(1);

    finishCancellation({ success: true, cancelled: true });
    await waitFor(() => expect(createHumanSessionMock).toHaveBeenCalledTimes(1));
  });

  it.each(["resolved", "rejected"] as const)(
    "does not treat cancelled false as confirmed or retry an outdated challenge (%s response)",
    async (responseKind) => {
    const user = userEvent.setup();
    const signedInUser: MockFirebaseUser = {
      email: "invited@example.com",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
      delete: jest.fn(() => Promise.resolve()),
    };
    setCurrentUser(signedInUser);
    window.sessionStorage.setItem("worshipsync_pending_invite_token", "invite-token");
    window.sessionStorage.setItem("worshipsync_invite_recovery", JSON.stringify({
      accepted: true,
      token: "invite-token",
      acceptedAt: Date.now(),
      smsConsentChecked: true,
      smsVerification: {
        phoneNumber: "+12125550123",
        expectedRosterPhoneNumber: "+12125550123",
        challengeId: "i".repeat(32),
        cancellationToken: "j".repeat(43),
      },
    }));
    if (responseKind === "resolved") {
      cancelInviteSmsConsentMock.mockResolvedValue({ success: true, cancelled: false });
    } else {
      cancelInviteSmsConsentMock.mockRejectedValue(Object.assign(new Error("Challenge is no longer active."), {
        details: { success: false, cancelled: false },
      }));
    }
    createHumanSessionMock.mockRejectedValue(new Error("Session unavailable"));

    renderPage({ initialEntry: "/invite" });
    await user.click(await screen.findByRole("button", { name: /continue without sms/i }));
    expect(await screen.findByText(/verification is no longer active, or sms signup was already completed/i)).toBeInTheDocument();
    expect(cancelInviteSmsConsentMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("worshipsync_invite_sms_cancel:invite-token")).toBeNull();
    expect(window.sessionStorage.getItem("worshipsync_invite_recovery")).not.toContain("iiii");
    },
  );
});
