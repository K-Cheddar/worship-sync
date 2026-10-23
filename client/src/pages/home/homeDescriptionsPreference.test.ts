import {
  readHomeDescriptionsPreference,
  writeHomeDescriptionsPreference,
} from "./homeDescriptionsPreference";

describe("home descriptions preference", () => {
  it("defaults to enabled and persists the selected value", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: jest.fn((key: string) => values.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => values.set(key, value)),
    };

    expect(readHomeDescriptionsPreference(storage)).toBe(true);
    expect(writeHomeDescriptionsPreference(false, storage)).toBe(true);
    expect(readHomeDescriptionsPreference(storage)).toBe(false);
    expect(writeHomeDescriptionsPreference(true, storage)).toBe(true);
    expect(readHomeDescriptionsPreference(storage)).toBe(true);
  });

  it("uses the enabled default for invalid values and unavailable storage without throwing", () => {
    const corruptStorage = {
      getItem: jest.fn(() => "sometimes"),
      setItem: jest.fn(),
    };
    const unavailableStorage = {
      getItem: jest.fn(() => { throw new Error("Storage unavailable"); }),
      setItem: jest.fn(() => { throw new Error("Storage unavailable"); }),
    };

    expect(readHomeDescriptionsPreference(corruptStorage)).toBe(true);
    expect(readHomeDescriptionsPreference(unavailableStorage)).toBe(true);
    expect(writeHomeDescriptionsPreference(true, unavailableStorage)).toBe(false);
  });
});
