import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AccountPeoplePage from "./AccountPeoplePage";
import { AccountPageProvider } from "../AccountPageContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastContext } from "../../../context/toastContext";
import { createMockGlobalContext } from "../../../test/mocks";
import * as api from "../../../api/auth";
import type { MemberPermissions } from "../../../api/authTypes";
import type { ChurchInviteRow } from "../../../api/authTypes";
import type { resolveInviteAccessPayload } from "../accountInviteAccess";

jest.mock("../../../api/auth", () => ({
  ...jest.requireActual("../../../api/auth"),
  listChurchMembers: jest.fn(), listChurchInvites: jest.fn(),
  listTrustedDevices: jest.fn(), listWorkstations: jest.fn(), listDisplayDevices: jest.fn(),
  getTeamsBootstrap: jest.fn(), updateChurchMemberAccess: jest.fn(),
  updateChurchInviteAccess: jest.fn(), createAdminInvite: jest.fn(),
}));

let permissions: MemberPermissions;
const member = () => ({ membershipId: "church-1_owner", churchId: "church-1", status: "active", userId: "owner", role: "admin",
  accessRevision: JSON.stringify(permissions),
  appAccess: "full", permissions,
  user: { uid: "owner", email: "owner@example.test", displayName: "Owner" } });

beforeEach(() => {
  jest.clearAllMocks();
  permissions = { teams: "edit", services: "edit", teamScopes: { media: "edit", praise: "view" } };
  jest.mocked(api.listChurchMembers).mockImplementation(async () => ({ success: true, members: [member()] }));
  jest.mocked(api.listChurchInvites).mockResolvedValue({ success: true, invites: [] });
  jest.mocked(api.listTrustedDevices).mockResolvedValue({ success: true, devices: [] });
  jest.mocked(api.listWorkstations).mockResolvedValue({ success: true, workstations: [] });
  jest.mocked(api.listDisplayDevices).mockResolvedValue({ success: true, displayDevices: [] });
  jest.mocked(api.getTeamsBootstrap).mockResolvedValue({ teams: [
    { teamId: "media", name: "Media" }, { teamId: "praise", name: "Praise Team" },
    { teamId: "archived", name: "Archived team", archivedAt: "2026-01-01" },
  ] } as Awaited<ReturnType<typeof api.getTeamsBootstrap>>);
});

const mount = (contextOverrides: Parameters<typeof createMockGlobalContext>[0] = {}, showToast = jest.fn()) => render(
  <MemoryRouter>
    <ToastContext.Provider value={{ showToast, updateToast: jest.fn(), removeToast: jest.fn() }}>
      <GlobalInfoContext.Provider value={createMockGlobalContext({ churchId: "church-1", role: "admin", userId: "owner", ...contextOverrides }) as React.ContextType<typeof GlobalInfoContext>}>
        <AccountPageProvider><AccountPeoplePage /></AccountPageProvider>
      </GlobalInfoContext.Provider>
    </ToastContext.Provider>
  </MemoryRouter>,
);

it("opens the real admin access drawer, preserves view scopes, and hydrates saved assignments after refresh", async () => {
  const user = userEvent.setup();
  let finishSave: () => void = () => {};
  jest.mocked(api.updateChurchMemberAccess).mockImplementation(async (_church, _user, _controller, saved) => {
    await new Promise<void>((resolve) => { finishSave = resolve; });
    permissions = saved;
    return { success: true };
  });
  mount();
  await user.click(await screen.findByRole("button", { name: "Actions for Owner" }));
  expect(screen.queryByRole("menuitem", { name: "Remove admin" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  const drawer = await screen.findByRole("dialog", { name: "Edit access" });
  expect(within(drawer).getByRole("combobox", { name: "Global Teams access:" })).toBeDisabled();
  expect(within(drawer).getByRole("checkbox", { name: "Media" })).toBeChecked();
  expect(within(drawer).getByRole("checkbox", { name: "Praise Team" })).not.toBeChecked();
  expect(within(drawer).queryByRole("checkbox", { name: "Archived team" })).not.toBeInTheDocument();
  await user.click(within(drawer).getByRole("checkbox", { name: "Media" }));
  await user.click(within(drawer).getByRole("button", { name: "Save access" }));
  expect(within(drawer).getByRole("checkbox", { name: "Media" })).toBeDisabled();
  expect(api.updateChurchMemberAccess).toHaveBeenCalledWith("church-1", "owner", "full", {
    teams: "edit", services: "edit", teamScopes: { praise: "view" },
  }, expect.any(String));
  finishSave();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit access" })).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  expect(await screen.findByRole("checkbox", { name: "Media" })).not.toBeChecked();
});

it("refreshes a conflicting access snapshot and requires reopening to review the current assignment", async () => {
  const user = userEvent.setup();
  const showToast = jest.fn();
  const loadedRevision = JSON.stringify(permissions);
  jest.mocked(api.updateChurchMemberAccess).mockImplementation(async () => {
    permissions = { ...permissions, teamScopes: { media: "edit", praise: "edit" } };
    throw new api.AuthApiError("Access changed. Close and reopen access settings to review the latest changes.", {
      status: 409, code: "MEMBER_ACCESS_CONFLICT",
    });
  });
  mount({}, showToast);
  await user.click(await screen.findByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  await user.click(await screen.findByRole("checkbox", { name: "Media" }));
  await user.click(screen.getByRole("button", { name: "Save access" }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Access changed"), "error"));
  expect(screen.getByRole("checkbox", { name: "Media" })).not.toBeChecked();
  expect(api.updateChurchMemberAccess).toHaveBeenCalledWith("church-1", "owner", "full", expect.any(Object), loadedRevision);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  expect(await screen.findByRole("checkbox", { name: "Media" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Praise Team" })).toBeChecked();
});

it("keeps the durable save complete when self-bootstrap refresh fails", async () => {
  const user = userEvent.setup();
  const showToast = jest.fn();
  const refreshAuthBootstrap = jest.fn().mockRejectedValue(new Error("offline"));
  jest.mocked(api.updateChurchMemberAccess).mockImplementation(async (_church, _user, _access, saved) => {
    permissions = saved;
    return { success: true };
  });
  mount({ refreshAuthBootstrap }, showToast);
  await user.click(await screen.findByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  await user.click(await screen.findByRole("checkbox", { name: "Media" }));
  await user.click(screen.getByRole("button", { name: "Save access" }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("Access was saved. Reload the app to refresh your notification settings.", "error"));
  expect(screen.queryByRole("dialog", { name: "Edit access" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  expect(await screen.findByRole("checkbox", { name: "Media" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Save access" })).toBeDisabled();
  expect(api.updateChurchMemberAccess).toHaveBeenCalledTimes(1);
});

it("does not refresh the current administrator's bootstrap when another account is edited", async () => {
  const user = userEvent.setup();
  const refreshAuthBootstrap = jest.fn();
  jest.mocked(api.updateChurchMemberAccess).mockResolvedValue({ success: true });
  mount({ userId: "another-admin", refreshAuthBootstrap });
  await user.click(await screen.findByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  await user.click(await screen.findByRole("checkbox", { name: "Media" }));
  await user.click(screen.getByRole("button", { name: "Save access" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit access" })).not.toBeInTheDocument());
  expect(refreshAuthBootstrap).not.toHaveBeenCalled();
});

it("finishes the original self-save and global refresh after leaving administration", async () => {
  const user = userEvent.setup();
  const refreshAuthBootstrap = jest.fn().mockResolvedValue(undefined);
  let releaseSave: () => void = () => {};
  jest.mocked(api.updateChurchMemberAccess).mockImplementation(async (_church, _user, _access, saved) => {
    await new Promise<void>((resolve) => { releaseSave = resolve; });
    permissions = saved;
    return { success: true };
  });
  const view = mount({ refreshAuthBootstrap });
  await user.click(await screen.findByRole("button", { name: "Actions for Owner" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  await user.click(await screen.findByRole("checkbox", { name: "Media" }));
  await user.click(screen.getByRole("button", { name: "Save access" }));
  view.unmount();
  await act(async () => { releaseSave(); });
  expect(permissions.teamScopes).toEqual({ praise: "view" });
  expect(refreshAuthBootstrap).toHaveBeenCalledWith({ requireFresh: true });
  expect(api.updateChurchMemberAccess).toHaveBeenCalledTimes(1);
});

it("retains selected leads through invitation role and global-access changes and serializes them when sending", async () => {
  const user = userEvent.setup();
  jest.mocked(api.createAdminInvite).mockResolvedValue({ success: true, invite: {
    inviteId: "created", email: "lead@example.test", role: "member", appAccess: "full", status: "pending",
    churchId: "church-1", expiresAt: "2026-12-01T00:00:00Z", createdAt: "2026-10-23T00:00:00Z",
  } });
  mount();
  await user.click(await screen.findByRole("button", { name: "Configure access" }));
  await user.click(screen.getByRole("checkbox", { name: "Media" }));
  await user.click(screen.getByRole("combobox", { name: "Role:" }));
  await user.click(screen.getByRole("option", { name: "Admin" }));
  expect(screen.getByRole("checkbox", { name: "Media" })).toBeChecked();
  await user.click(screen.getByRole("combobox", { name: "Role:" }));
  await user.click(screen.getByRole("option", { name: "Member" }));
  await user.click(screen.getByRole("combobox", { name: "Global Teams access:" }));
  await user.click(screen.getByRole("option", { name: "Edit all teams (includes services)" }));
  expect(screen.getByRole("checkbox", { name: "Media" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Apply access" }));
  await user.type(screen.getByRole("textbox", { name: /Email/ }), "lead@example.test");
  await user.click(screen.getByRole("button", { name: "Send invite" }));
  await waitFor(() => expect(api.createAdminInvite).toHaveBeenCalledWith("church-1", expect.objectContaining({
    email: "lead@example.test", permissions: { teams: "edit", services: "none", teamScopes: { media: "edit" } },
  })));
});

it("hydrates and saves pending admin invitations without losing leads or view-only scopes", async () => {
  const user = userEvent.setup();
  let invite: ChurchInviteRow = { inviteId: "pending", churchId: "church-1", email: "pending@example.test", role: "admin",
    appAccess: "full", controllerAccess: "full", status: "pending",
    expiresAt: "2026-12-01T00:00:00Z", createdAt: "2026-10-23T00:00:00Z", permissions };
  jest.mocked(api.listChurchInvites).mockImplementation(async () => ({ success: true, invites: [invite] }));
  jest.mocked(api.updateChurchInviteAccess).mockImplementation(async (_church, _id, payload) => {
    invite = { ...invite, ...payload as ReturnType<typeof resolveInviteAccessPayload> };
    return { success: true, invite };
  });
  mount();
  await user.click(await screen.findByRole("button", { name: "Actions for invite to pending@example.test" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  expect(await screen.findByRole("checkbox", { name: "Media" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Praise Team" })).not.toBeChecked();
  await user.click(screen.getByRole("combobox", { name: "Role:" }));
  await user.click(screen.getByRole("option", { name: "Member" }));
  expect(screen.getByRole("checkbox", { name: "Media" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save access" }));
  await waitFor(() => expect(api.updateChurchInviteAccess).toHaveBeenCalledWith("church-1", "pending", {
    role: "member", controllerAccess: "full", appAccess: "full",
    permissions: { teams: "none", services: "none", teamScopes: { media: "edit", praise: "view" } },
  }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit access" })).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Actions for invite to pending@example.test" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit access" }));
  expect(await screen.findByRole("checkbox", { name: "Media" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Praise Team" })).not.toBeChecked();
});
