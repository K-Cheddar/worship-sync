import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MemberAccessSheet from "./MemberAccessSheet";
import type { InviteAccessDraft } from "../accountTypes";
import { useAccountPage } from "../AccountPageContext";
import { updateChurchMemberAccess } from "../../../api/auth";

jest.mock("../AccountPageContext", () => ({
  useAccountPage: jest.fn(),
}));

jest.mock("../../../components/Drawer", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../../components/Select/Select", () => ({
  __esModule: true,
  default: ({
    id,
    label,
    value,
    options,
    selectedValueLabel,
    disabled,
    onChange,
  }: {
    id: string;
    label: string;
    value: string;
    options: { value: string; label: string }[];
    selectedValueLabel?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span data-testid={`${id}-selected-label`}>
        {selectedValueLabel || options.find((option) => option.value === value)?.label}
      </span>
    </label>
  ),
}));

jest.mock("../../../components/Checkbox/Checkbox", () => ({
  __esModule: true,
  default: ({
    label,
    checked,
    onCheckedChange,
  }: {
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {label}
    </label>
  ),
}));

jest.mock("../../Controller/AccountFormSections", () => ({
  ACCOUNT_CONTROL_SELECT_CLASSNAME: "",
}));

jest.mock("../../../api/auth", () => ({
  updateChurchMemberAccess: jest.fn(),
  updateChurchInviteAccess: jest.fn(),
}));

const member = {
  membershipId: "membership-1",
  userId: "user-1",
  role: "member",
  appAccess: "full",
  permissions: {
    teams: "view" as const,
    services: "edit" as const,
    teamScopes: { worship: "edit" as const },
  },
  user: { uid: "user-1", email: "person@example.com" },
};

const renderMemberSheet = () => {
  let access = "full";
  let teamsAccess = "view";
  let servicesAccess = "edit";
  let teamScopeIds = ["worship"];
  const setters = {
    setMemberAccessDrafts: jest.fn((update) => {
      access = update({})[member.membershipId];
    }),
    setMemberTeamsAccessDrafts: jest.fn((update) => {
      teamsAccess = update({})[member.membershipId];
    }),
    setMemberServicesAccessDrafts: jest.fn((update) => {
      servicesAccess = update({})[member.membershipId];
    }),
    setMemberTeamScopeDrafts: jest.fn((update) => {
      teamScopeIds = update({})[member.membershipId];
    }),
  };
  const context = {
    churchId: "church-1",
    teams: [{ teamId: "worship", name: "Worship" }],
    memberActionLoading: {},
    accessSheetTarget: { kind: "member" as const, member },
    inviteAccessDraft: {
      access: "full",
      teamsAccess: "none",
      servicesAccess: "none",
      teamScopeIds: [],
    },
    ...setters,
    setInviteAccessDraft: jest.fn(),
    setInvitePendingAccessDrafts: jest.fn(),
    runMemberAction: jest.fn((_key, action) => action()),
    showStatus: jest.fn(),
    refresh: jest.fn().mockResolvedValue(undefined),
    closeAccessSheet: jest.fn(),
    getMemberAccessValue: jest.fn(() => access),
    getMemberTeamsAccessValue: jest.fn(() => teamsAccess),
    getMemberServicesAccessValue: jest.fn(() => servicesAccess),
    getMemberTeamScopeValue: jest.fn(() => teamScopeIds),
    getInvitePendingAccessValue: jest.fn(),
    toTeamsAccessOption: jest.fn(() => "none"),
    buildTeamScopesPermissions: (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "edit"])),
    getEditableTeamScopeIds: jest.fn(() => ["worship"]),
  };
  (useAccountPage as jest.Mock).mockReturnValue(context);
  const view = render(<MemberAccessSheet />);
  return { ...view, context, setters, getDrafts: () => ({ access, teamsAccess, servicesAccess, teamScopeIds }) };
};

const renderInviteSheet = (kind: "invite-draft" | "invite") => {
  let draft: InviteAccessDraft = {
    access: "full",
    teamsAccess: "view",
    servicesAccess: "edit",
    teamScopeIds: ["worship"],
  };
  const invite = {
    inviteId: "invite-1",
    email: "person@example.com",
    role: "member",
    appAccess: "full",
    permissions: {
      teams: "view" as const,
      services: "edit" as const,
      teamScopes: { worship: "edit" as const },
    },
    status: "pending",
  };
  const context = {
    churchId: "church-1",
    teams: [{ teamId: "worship", name: "Worship" }],
    memberActionLoading: {},
    accessSheetTarget: kind === "invite-draft" ? { kind } : { kind, invite },
    inviteAccessDraft: draft,
    setMemberAccessDrafts: jest.fn(),
    setMemberTeamsAccessDrafts: jest.fn(),
    setMemberServicesAccessDrafts: jest.fn(),
    setMemberTeamScopeDrafts: jest.fn(),
    setInviteAccessDraft: jest.fn((update) => {
      draft = update(draft);
    }),
    setInvitePendingAccessDrafts: jest.fn((update) => {
      const pendingDrafts = update({});
      draft = pendingDrafts[invite.inviteId];
    }),
    runMemberAction: jest.fn((_key, action) => action()),
    showStatus: jest.fn(),
    refresh: jest.fn().mockResolvedValue(undefined),
    closeAccessSheet: jest.fn(),
    getMemberAccessValue: jest.fn(),
    getMemberTeamsAccessValue: jest.fn(),
    getMemberServicesAccessValue: jest.fn(),
    getMemberTeamScopeValue: jest.fn(),
    getInvitePendingAccessValue: jest.fn(() => draft),
    toTeamsAccessOption: jest.fn(() => "none"),
    buildTeamScopesPermissions: (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "edit"])),
    getEditableTeamScopeIds: jest.fn(() => ["worship"]),
  };
  (useAccountPage as jest.Mock).mockReturnValue(context);
  const view = render(<MemberAccessSheet />);
  return { ...view, context, getDraft: () => draft };
};

describe("MemberAccessSheet member tier", () => {
  it("shows global Teams and Services as disabled None while keeping team scopes usable", () => {
    const { rerender, setters } = renderMemberSheet();
    fireEvent.change(screen.getByRole("combobox", { name: "Access level" }), {
      target: { value: "member" },
    });
    rerender(<MemberAccessSheet />);

    expect(setters.setMemberTeamsAccessDrafts).toHaveBeenCalled();
    expect(setters.setMemberServicesAccessDrafts).toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Global Teams access" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Global Teams access" })).toHaveValue("none");
    expect(screen.getByTestId("member-teams-access-sheet-membership-1-selected-label")).toHaveTextContent("None");
    expect(screen.getByRole("combobox", { name: "Service editing" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Service editing" })).toHaveValue("none");
    expect(screen.getByTestId("member-services-access-sheet-membership-1-selected-label")).toHaveTextContent("None");
    expect(screen.getByRole("checkbox", { name: "Worship" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Worship" })).toBeChecked();
    expect(setters.setMemberTeamScopeDrafts).not.toHaveBeenCalled();
  });

  it("does not restore broad grants after switching from Full to Member and back", () => {
    const { rerender, getDrafts } = renderMemberSheet();
    const accessLevel = screen.getByRole("combobox", { name: "Access level" });
    fireEvent.change(accessLevel, { target: { value: "member" } });
    rerender(<MemberAccessSheet />);
    fireEvent.change(screen.getByRole("combobox", { name: "Access level" }), {
      target: { value: "full" },
    });
    rerender(<MemberAccessSheet />);

    expect(getDrafts()).toEqual({
      access: "full",
      teamsAccess: "none",
      servicesAccess: "none",
      teamScopeIds: ["worship"],
    });
  });

  it("saves Member access with None broad permissions and preserves the selected team scope", async () => {
    const { rerender } = renderMemberSheet();
    fireEvent.change(screen.getByRole("combobox", { name: "Access level" }), {
      target: { value: "member" },
    });
    rerender(<MemberAccessSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));

    await waitFor(() => expect(updateChurchMemberAccess).toHaveBeenCalled());
    expect(updateChurchMemberAccess).toHaveBeenCalledWith(
      "church-1",
      "user-1",
      "member",
      {
        teams: "none",
        services: "none",
        teamScopes: { worship: "edit" },
      },
    );
  });

  it.each(["invite-draft", "invite"] as const)(
    "normalizes %s broad permissions and preserves its team scope when switched to Member",
    (kind) => {
      const { rerender, getDraft } = renderInviteSheet(kind);
      fireEvent.change(screen.getByRole("combobox", { name: "Access level" }), {
        target: { value: "member" },
      });
      const accountContext = (useAccountPage as jest.Mock).mock.results.at(-1)
        ?.value;
      accountContext.inviteAccessDraft = getDraft();
      rerender(<MemberAccessSheet />);

      expect(getDraft()).toEqual({
        access: "member",
        teamsAccess: "none",
        servicesAccess: "none",
        teamScopeIds: ["worship"],
      });
      expect(screen.getByRole("combobox", { name: "Global Teams access" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "Service editing" })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: "Worship" })).toBeChecked();
    },
  );
});
