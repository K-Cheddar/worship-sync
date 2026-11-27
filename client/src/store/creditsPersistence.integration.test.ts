const makeDb = (name: string) => ({
  name, get: jest.fn(), put: jest.fn().mockResolvedValue({ rev: "2-saved" }),
});
let mockDb = makeDb("church-A");
const mockPost = jest.fn();
const mockSet = jest.fn();
const mockFirebase: { db?: object; churchId: string } = { churchId: "A" };
jest.mock("../context/controllerInfo", () => ({
  get globalDb() { return mockDb; },
  get globalBroadcastRef() { return { postMessage: mockPost }; },
}));
jest.mock("../context/globalInfo", () => ({ get globalFireDbInfo() { return mockFirebase; }, globalHostId: "host" }));
jest.mock("firebase/database", () => ({
  ref: (_: unknown, path: string) => path,
  set: (...args: unknown[]) => mockSet(...args),
}));

const store = jest.requireActual<typeof import("./store")>("./store").default;
const { addCredit, initiateCreditsList, updateCredit, updateList } =
  jest.requireActual<typeof import("./creditsSlice")>("./creditsSlice");
const { initiateItemLists, selectItemList } = jest.requireActual<typeof import("./itemListsSlice")>("./itemListsSlice");
const { preferencesSlice } = jest.requireActual<typeof import("./preferencesSlice")>("./preferencesSlice");
const { getCreditsDocId } = jest.requireActual<typeof import("../types")>("../types");

const row = (id: string) => ({ id, heading: id, text: "" });
function openOutline(id: string) {
  store.dispatch(selectItemList(id));
  store.dispatch(initiateCreditsList([row("one"), row("two")], { database: mockDb.name, outlineId: id }));
}
beforeEach(() => {
  jest.useFakeTimers();
  mockDb = makeDb("church-A");
  mockFirebase.db = undefined;
  mockFirebase.churchId = "A";
  store.dispatch({ type: "RESET" });
  store.dispatch(initiateItemLists([{ _id: "a", name: "A" }, { _id: "b", name: "B" }]));
  openOutline("a");
  mockPost.mockClear();
  mockSet.mockClear();
});
afterEach(() => jest.useRealTimers());

it("publishes changed live row text without revising or broadcasting the index", async () => {
  mockFirebase.db = {};
  store.dispatch(updateCredit({ id: "one", text: "updated" }));
  await jest.advanceTimersByTimeAsync(1500);
  expect(mockSet).toHaveBeenCalledWith("churches/A/data/credits/publishedList", [
    { ...row("one"), text: "updated" }, row("two"),
  ]);
  expect(mockDb.put).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

it("does not broadcast an order already committed by another controller", async () => {
  mockDb.get.mockResolvedValue({ _id: getCreditsDocId("a"), _rev: "2-peer", creditIds: ["two", "one"] });
  store.dispatch(updateList([row("two"), row("one")]));
  await jest.advanceTimersByTimeAsync(1500);
  expect(mockDb.put).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

it("completes pending membership and ordering edits on their originating outlines", async () => {
  mockDb.get.mockImplementation(async (id: string) => ({ _id: id, _rev: "1-old", creditIds: ["one", "two"] }));
  store.dispatch(updateList([row("two"), row("one")]));
  openOutline("b");
  store.dispatch(addCredit(row("three")));
  await jest.advanceTimersByTimeAsync(1500);
  expect(mockDb.put.mock.calls.map(([doc]) => [doc._id, doc.creditIds])).toEqual([
    [getCreditsDocId("a"), ["two", "one"]], [getCreditsDocId("b"), ["one", "two", "three"]],
  ]);
  expect(mockPost).toHaveBeenCalledTimes(2);
});

it("finishes an accepted write on church A without publishing into church B", async () => {
  let resume!: (value: unknown) => void;
  const original = mockDb;
  original.get.mockImplementation(() => new Promise(resolve => { resume = resolve; }));
  store.dispatch(addCredit(row("three")));
  await jest.advanceTimersByTimeAsync(1);
  mockDb = makeDb("church-B");
  mockFirebase.churchId = "B";
  openOutline("a");
  resume({ _id: getCreditsDocId("a"), _rev: "1-a", creditIds: ["one", "two"] });
  await jest.advanceTimersByTimeAsync(1500);
  expect(original.put).toHaveBeenCalledTimes(1);
  expect(mockDb.get).not.toHaveBeenCalled();
  expect(mockDb.put).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

it("writes and broadcasts only the modified split preference document", async () => {
  const { preferences, quickLinks, monitorSettings } = store.getState().undoable.present.preferences;
  const fields: Record<string, unknown> = { preferences, quickLinks, monitorSettings };
  mockDb.get.mockImplementation(async (id: string) => ({
    _id: id, _rev: "1-stored", docType: id, [id]: fields[id], updatedAt: "original",
  }));
  store.dispatch(preferencesSlice.actions.setIsInitialized(true));
  store.dispatch(preferencesSlice.actions.setMonitorShowClock(!monitorSettings.showClock));
  await jest.advanceTimersByTimeAsync(1500);
  expect(mockDb.put.mock.calls.map(([doc]) => doc._id)).toEqual(["monitorSettings"]);
  expect(mockPost.mock.calls.map(([event]) => event.data.docs.map((doc: { _id: string }) => doc._id)))
    .toEqual([["monitorSettings"]]);
});
