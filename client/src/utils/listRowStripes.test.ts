import { alternatingAdminListRowBg } from "./listRowStripes";

describe("alternatingAdminListRowBg", () => {
  it("returns bg-admin-row-a for index 0", () => {
    expect(alternatingAdminListRowBg(0)).toBe("bg-admin-row-a");
  });

  it("returns bg-admin-row-b for index 1", () => {
    expect(alternatingAdminListRowBg(1)).toBe("bg-admin-row-b");
  });

  it("returns bg-admin-row-a for even indices", () => {
    [2, 4, 10, 100].forEach((i) => {
      expect(alternatingAdminListRowBg(i)).toBe("bg-admin-row-a");
    });
  });

  it("returns bg-admin-row-b for odd indices", () => {
    [3, 5, 11, 99].forEach((i) => {
      expect(alternatingAdminListRowBg(i)).toBe("bg-admin-row-b");
    });
  });
});
