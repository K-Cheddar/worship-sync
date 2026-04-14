import {
  FLUSH_MEDIA_NO_DB_MESSAGE,
  flushMediaLibraryDocToPouch,
} from "./flushMediaLibraryDoc";

jest.mock("../context/controllerInfo", () => ({
  globalDb: undefined,
  globalBroadcastRef: null,
}));

jest.mock("../store/store", () => ({
  __esModule: true,
  default: { dispatch: jest.fn() },
}));

describe("flushMediaLibraryDocToPouch", () => {
  it("returns ok: false with a clear error when db is unavailable", async () => {
    const r = await flushMediaLibraryDocToPouch([], []);
    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: FLUSH_MEDIA_NO_DB_MESSAGE,
      }),
    });
  });
});
