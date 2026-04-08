import { isValidEmailFormat } from "./emailFormat";

describe("isValidEmailFormat", () => {
  it("accepts typical addresses", () => {
    expect(isValidEmailFormat("user@example.com")).toBe(true);
    expect(isValidEmailFormat("  a.b+c@sub.example.co.uk  ")).toBe(true);
  });

  it("rejects missing or malformed shapes", () => {
    expect(isValidEmailFormat("")).toBe(false);
    expect(isValidEmailFormat("not-an-email")).toBe(false);
    expect(isValidEmailFormat("@nodomain.com")).toBe(false);
    expect(isValidEmailFormat("onlylocal@")).toBe(false);
  });
});
