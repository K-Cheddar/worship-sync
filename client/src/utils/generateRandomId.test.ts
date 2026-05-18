import generateRandomId from "./generateRandomId";

describe("generateRandomId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateRandomId()).toBe("string");
    expect(generateRandomId().length).toBeGreaterThan(0);
  });

  it("returns only base-32 characters", () => {
    const id = generateRandomId();
    expect(id).toMatch(/^[0-9a-v]+$/);
  });

  it("returns unique ids across multiple calls", () => {
    const ids = Array.from({ length: 50 }, () => generateRandomId());
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
