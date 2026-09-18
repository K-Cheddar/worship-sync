import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvitePeopleForm } from "./AccountFormSections";
import { ToastContext } from "../../context/toastContext";
import { AuthApiError } from "../../api/auth";
import * as authApi from "../../api/auth";
import { useAccountPage } from "../Account/AccountPageContext";

const mockShowApiError = jest.fn();

jest.mock("../../api/auth", () => ({
  ...jest.requireActual("../../api/auth"),
  createAdminInvite: jest.fn(),
  updateChurchInviteAccess: jest.fn(),
}));

jest.mock("../../hooks/useApiErrorToast", () => ({
  useApiErrorToast: () => ({ showApiError: mockShowApiError }),
}));

jest.mock("../Account/AccountPageContext", () => ({
  useAccountPage: jest.fn(),
}));

const invite = {
  inviteId: "invite-1",
  email: "person@example.com",
  role: "member",
  appAccess: "full",
  permissions: { teams: "none", services: "none", teamScopes: {} },
  status: "pending",
};

const inviteAccessDraft = {
  access: "full" as const,
  teamsAccess: "none" as const,
  servicesAccess: "none" as const,
  teamScopeIds: [],
};

const renderForm = ({ resendInvite = jest.fn() } = {}) => {
  const onInvited = jest.fn().mockResolvedValue(undefined);
  const showToast = jest.fn();
  (useAccountPage as jest.Mock).mockReturnValue({
    inviteAccessDraft,
    openInviteDraftAccessSheet: jest.fn(),
    resetInviteAccessDraft: jest.fn(),
    resendInvite,
  });

  render(
    <ToastContext.Provider
      value={{ showToast, updateToast: jest.fn(), removeToast: jest.fn() }}
    >
      <InvitePeopleForm churchId="church-1" onInvited={onInvited} />
    </ToastContext.Provider>,
  );

  return { onInvited };
};

const makeConflict = () =>
  new AuthApiError("An invitation already exists.", {
    status: 409,
    details: { existingInvite: invite },
  });

describe("InvitePeopleForm invite recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authApi.createAdminInvite as jest.Mock).mockRejectedValue(makeConflict());
  });

  it("refreshes after access update succeeds and resend succeeds", async () => {
    const resendInvite = jest.fn().mockResolvedValue({ ...invite });
    const { onInvited } = renderForm({ resendInvite });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: invite.email },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await screen.findByRole("button", { name: "Update access and resend" });

    (authApi.updateChurchInviteAccess as jest.Mock).mockResolvedValue({
      success: true,
      invite: { ...invite, appAccess: "music" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Update access and resend" }),
    );

    await waitFor(() => expect(resendInvite).toHaveBeenCalled());
    expect(onInvited).toHaveBeenCalledTimes(1);
  });

  it("keeps updated access visible and refreshes when resend fails", async () => {
    const resendInvite = jest.fn().mockImplementation(async () => {
      mockShowApiError(new Error("resend failed"), "Resend failed");
      return null;
    });
    const { onInvited } = renderForm({ resendInvite });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: invite.email },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await screen.findByRole("button", { name: "Update access and resend" });

    (authApi.updateChurchInviteAccess as jest.Mock).mockResolvedValue({
      success: true,
      invite: { ...invite, appAccess: "music" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Update access and resend" }),
    );

    await waitFor(() => expect(onInvited).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Music access/)).toBeInTheDocument();
    expect(mockShowApiError).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Update access and resend" })).toBeInTheDocument();
  });

  it("does not resend when access update fails", async () => {
    const resendInvite = jest.fn();
    renderForm({ resendInvite });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: invite.email },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await screen.findByRole("button", { name: "Update access and resend" });

    (authApi.updateChurchInviteAccess as jest.Mock).mockRejectedValue(
      new Error("access update failed"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Update access and resend" }),
    );

    await waitFor(() => expect(authApi.updateChurchInviteAccess).toHaveBeenCalled());
    expect(resendInvite).not.toHaveBeenCalled();
  });
});
