import { formatMemberServicesAccessSummary } from "./accountServicesAccess";

describe("formatMemberServicesAccessSummary", () => {
  it("shows the effective service access, including inherited Teams edit", () => {
    expect(
      formatMemberServicesAccessSummary({ teams: "edit", services: "none" }),
    ).toBe("Edit services and plans");
    expect(
      formatMemberServicesAccessSummary({ teams: "none", services: "edit" }),
    ).toBe("Edit services and plans");
  });

  it("shows no service editing when it was not granted", () => {
    expect(
      formatMemberServicesAccessSummary({ teams: "view", services: "none" }),
    ).toBe("No service editing");
  });
});
