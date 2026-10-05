import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TeamsAccessGuard from "./TeamsAccessGuard";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

describe("TeamsAccessGuard", () => {
  it("allows a human member to attempt the membership-authorized Teams workspace", () => {
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
          <TeamsAccessGuard allowMembershipDerivedAccess>
            <div>Teams loader</div>
          </TeamsAccessGuard>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Teams loader")).toBeInTheDocument();
  });

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

    expect(screen.queryByText("Current Service workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Teams access required" })).toBeInTheDocument();
  });
});
