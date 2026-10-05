import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TeamsAccessGuard from "./TeamsAccessGuard";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

describe("TeamsAccessGuard", () => {
  it.each(["member", "view", "music", "full"] as const)(
    "allows a human %s session to attempt the membership-authorized Teams workspace",
    (access) => {
      render(
        <MemoryRouter>
          <GlobalInfoContext.Provider
            value={
              createMockGlobalContext({
                access,
                permissions: {
                  teams: "none",
                  services: "none",
                  teamScopes: {},
                },
                canViewTeams: false,
              }) as never
            }
          >
            <TeamsAccessGuard allowMembershipDerivedAccess>
              <div>Teams loader</div>
            </TeamsAccessGuard>
          </GlobalInfoContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.getByText("Teams loader")).toBeInTheDocument();
    },
  );

  it.each(["member", "view", "music", "full"] as const)(
    "still requires normal Teams permission for human %s sessions without the override",
    (access) => {
      render(
        <MemoryRouter>
          <GlobalInfoContext.Provider
            value={
              createMockGlobalContext({
                access,
                permissions: {
                  teams: "none",
                  services: "none",
                  teamScopes: {},
                },
                canViewTeams: false,
              }) as never
            }
          >
            <TeamsAccessGuard>
              <div>Teams loader</div>
            </TeamsAccessGuard>
          </GlobalInfoContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.queryByText("Teams loader")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Teams access required" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["workstation", "display"] as const)(
    "does not grant membership-derived access to %s sessions",
    (sessionKind) => {
      render(
        <MemoryRouter>
          <GlobalInfoContext.Provider
            value={
              createMockGlobalContext({
                sessionKind,
                canViewTeams: false,
              }) as never
            }
          >
            <TeamsAccessGuard allowMembershipDerivedAccess>
              <div>Teams loader</div>
            </TeamsAccessGuard>
          </GlobalInfoContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.queryByText("Teams loader")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Teams access required" }),
      ).toBeInTheDocument();
    },
  );

  it("keeps Current Service blocked for the same member", () => {
    render(
      <MemoryRouter>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              access: "member",
              role: "member",
              canViewTeams: false,
            }) as never
          }
        >
          <TeamsAccessGuard>
            <div>Current Service workspace</div>
          </TeamsAccessGuard>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("Current Service workspace"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Teams access required" }),
    ).toBeInTheDocument();
  });
});
