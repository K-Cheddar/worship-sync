import { renderHook, waitFor } from "@testing-library/react";
import { useResolvedBoardDisplayAlias } from "./useResolvedBoardDisplayAlias";
import { getBoardAliases } from "./api";

jest.mock("./api", () => ({
  getBoardAliases: jest.fn(),
}));

let storedAliasId = "";
jest.mock("./useStoredBoardDisplayAlias", () => ({
  useStoredBoardDisplayAlias: () => storedAliasId,
}));

const mockGetBoardAliases = getBoardAliases as jest.Mock;

beforeEach(() => {
  mockGetBoardAliases.mockReset();
  storedAliasId = "";
});

describe("useResolvedBoardDisplayAlias", () => {
  it("keeps the remembered board when it still exists", async () => {
    storedAliasId = "sunday";
    mockGetBoardAliases.mockResolvedValue({
      aliases: [{ aliasId: "friday" }, { aliasId: "sunday" }],
    });

    const { result } = renderHook(() => useResolvedBoardDisplayAlias());

    await waitFor(() => expect(result.current).toBe("sunday"));
  });

  it("falls back to the first board when the device has none stored", async () => {
    storedAliasId = "";
    mockGetBoardAliases.mockResolvedValue({
      aliases: [{ aliasId: "friday" }, { aliasId: "sunday" }],
    });

    const { result } = renderHook(() => useResolvedBoardDisplayAlias());

    await waitFor(() => expect(result.current).toBe("friday"));
  });

  it("falls back to the first board when the stored one no longer exists", async () => {
    storedAliasId = "deleted";
    mockGetBoardAliases.mockResolvedValue({
      aliases: [{ aliasId: "friday" }],
    });

    const { result } = renderHook(() => useResolvedBoardDisplayAlias());

    await waitFor(() => expect(result.current).toBe("friday"));
  });

  it("resolves to empty when the church has no boards", async () => {
    storedAliasId = "";
    mockGetBoardAliases.mockResolvedValue({ aliases: [] });

    const { result } = renderHook(() => useResolvedBoardDisplayAlias());

    // Give the resolved fetch a chance to settle, then confirm it stays empty.
    await waitFor(() => expect(mockGetBoardAliases).toHaveBeenCalled());
    expect(result.current).toBe("");
  });

  it("trusts the stored id and skips the fetch while disabled", () => {
    storedAliasId = "sunday";

    const { result } = renderHook(() =>
      useResolvedBoardDisplayAlias({ enabled: false }),
    );

    expect(result.current).toBe("sunday");
    expect(mockGetBoardAliases).not.toHaveBeenCalled();
  });
});
