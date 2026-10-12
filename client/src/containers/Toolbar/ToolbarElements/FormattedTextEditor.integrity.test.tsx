import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { createMockGlobalContext } from "../../../test/mocks";
import { createNewSlide } from "../../../utils/slideCreation";
import type { DBItem } from "../../../types";
import {
  flushContentDatabaseBeforeTeardown,
  setActiveContentDatabase,
} from "../../../store/deferredItemMutations";

jest.mock("../../../components/PopOver/PopoverPanel", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../../../components/ColorField/ColorField", () => ({
  BrandAwareColorPicker: ({ onChange }: { onChange: (color: string) => void }) =>
    <>
      <button onClick={() => onChange("#123456")}>Choose color #123456</button>
      <button onClick={() => onChange("#654321")}>Choose color #654321</button>
    </>,
}));
jest.mock("../../../context/controllerInfo", () => ({
  ControllerInfoContext: jest.requireActual("react").createContext(null),
  get globalDb() { return mockCurrentDb; }, globalBroadcastRef: undefined,
}));
jest.mock("../../../context/globalInfo", () => ({
  GlobalInfoContext: jest.requireActual("react").createContext(null),
  globalFireDbInfo: { db: undefined, database: undefined }, globalHostId: "test-host",
}));
jest.mock("firebase/database", () => ({
  ref: jest.fn(), set: jest.fn(), get: jest.fn(),
}));
jest.mock("../../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true, default: () => null,
}));
jest.mock("../../../components/SectionTextEditor/SectionTextEditor", () => ({
  __esModule: true,
  default: ({ onChange }: { onChange: (text: string) => void }) =>
    <button onClick={() => onChange("A pending section text")}>Edit section</button>,
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const mockDocs = new Map<string, DBItem>();
const mockDb = {
  get: jest.fn(async (id: string) => clone(mockDocs.get(id))),
  put: jest.fn(async (doc: DBItem) => {
    if (doc._rev !== mockDocs.get(doc._id)?._rev) throw new Error("conflict");
    mockDocs.set(doc._id, clone({ ...doc, _rev: "2-written" }));
    return { ok: true, rev: "2-written" };
  }),
};
const mockDatabaseBDocs = new Map<string, DBItem>();
const mockDatabaseB = {
  get: jest.fn(async (id: string) => clone(mockDatabaseBDocs.get(id))),
  put: jest.fn(async (doc: DBItem) => {
    if (doc._rev !== mockDatabaseBDocs.get(doc._id)?._rev) throw new Error("conflict");
    mockDatabaseBDocs.set(doc._id, clone({ ...doc, _rev: "2-written" }));
    return { ok: true, rev: "2-written" };
  }),
};
const mockActiveOwner = {
  scopeId: "integrity-church/database-a",
  databaseKey: "database-a",
  churchId: "integrity-church",
};
let mockCurrentDb: typeof mockDb | typeof mockDatabaseB = mockDb;

// Load after the scoped DB mocks; exercise the actual Redux thunks/listeners.
const store = require("../../../store/store").default;
const {
  setActiveItem,
  setSelectedSlide,
  setSelectedBox,
  itemSlice,
} = require("../../../store/itemSlice");
const FormattedTextEditor = require("./FormattedTextEditor").default;
const SlideEditTools = require("./SlideEditTools").default;
const SlideEditor = require("../../ItemEditor/SlideEditor").default;

describe("delayed formatted text content integrity", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    store.dispatch({ type: "RESET" });
    mockDocs.clear();
    jest.clearAllMocks();
    mockCurrentDb = mockDb;
    mockDatabaseBDocs.clear();
    setActiveContentDatabase(mockActiveOwner, mockDb as never);
    for (const id of ["free-A", "free-B"]) {
      const slide = createNewSlide({ type: "Section", name: "Section 1", words: ["", id + " exclusive body"] });
      slide.id = id + "-slide";
      slide.formattedTextDisplayInfo = {
        text: id + " exclusive rich text", backgroundColor: "#ffffff",
        textColor: "#000000", fontSize: 1.5, paddingX: 1, paddingY: 1,
        align: "left", isBold: false, isItalic: false,
      };
      mockDocs.set(id, {
        _id: id, _rev: "1-original", name: id, type: "free", background: "",
        selectedArrangement: 0, arrangements: [], slides: [slide],
        formattedSections: [{ sectionNum: 1, words: id + " exclusive body", slideSpan: 1 }],
        shouldSendTo: { projector: true, monitor: true, stream: true },
      });
    }
    store.dispatch(setActiveItem(clone(mockDocs.get("free-A"))));
  });
  afterEach(() => jest.useRealTimers());

  it.each([false, true])("preserves a pending rich-text color change for A, unmounted=%s", async (unmountBeforeTimer) => {
    const beforeA = clone(mockDocs.get("free-A"));
    const beforeB = clone(mockDocs.get("free-B"));
    const { unmount } = render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <FormattedTextEditor />
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #123456" })[0]);
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    if (unmountBeforeTimer) unmount();
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });
    const savedB = mockDocs.get("free-B");
    const savedA = mockDocs.get("free-A");
    expect(savedA?.slides[0].id).toBe(beforeA?.slides[0].id);
    expect(savedA?.slides[0].boxes[1].words).toBe(beforeA?.slides[0].boxes[1].words);
    expect(savedA?.slides[0].formattedTextDisplayInfo?.text).toBe(beforeA?.slides[0].formattedTextDisplayInfo?.text);
    expect(savedA?.slides[0].formattedTextDisplayInfo?.textColor).toBe("#123456");
    expect(savedB).toEqual(beforeB);
    expect(mockDb.put).toHaveBeenCalledTimes(1);
  });

  it.each(["song", "free"])("preserves song slide formatting under A, destination=%s", async (destinationType) => {
    const asSong = (id: string) => {
      const base = mockDocs.get(id)!;
      return { ...base, type: "song" as const, formattedSections: undefined,
        arrangements: [{
          id: id + "-master", name: "Master", slides: base.slides,
          formattedLyrics: [{ id: id + "-verse", type: "Verse", name: "Verse",
            words: id + " song lyrics", slideSpan: 1 }],
          songOrder: [{ id: id + "-order", name: "Verse" }],
        }, {
          id: id + "-medley", name: "Medley", slides: base.slides,
          formattedLyrics: [], songOrder: [],
        }],
      };
    };
    mockDocs.set("free-A", asSong("free-A"));
    if (destinationType === "song") mockDocs.set("free-B", asSong("free-B"));
    store.dispatch(setActiveItem(clone(mockDocs.get("free-A"))));
    const beforeA = clone(mockDocs.get("free-A"));
    const beforeB = clone(mockDocs.get("free-B"));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter initialEntries={["/controller/item/a/list-a"]}>
            <SlideEditTools />
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #123456" })[0]);
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });
    const savedB = mockDocs.get("free-B");
    const savedA = mockDocs.get("free-A");
    expect(savedA?.name).toBe(beforeA?.name);
    expect(savedA?.type).toBe("song");
    expect(savedA?.arrangements.map(arr => arr.id)).toEqual(beforeA?.arrangements.map(arr => arr.id));
    expect(savedA?.arrangements[0].formattedLyrics[0].id).toBe("free-A-verse");
    expect(savedA?.arrangements[0].formattedLyrics[0].words).toBe("free-A song lyrics");
    expect(savedA?.arrangements[0].slides[0].boxes[1].fontColor).toBe("#123456");
    expect(savedB).toEqual(beforeB);
  });

  it.each(["song", "free"])("preserves delayed section edits under A, source=%s", async (sourceType) => {
    const a = mockDocs.get("free-A")!;
    if (sourceType === "song") {
      a.type = "song";
      a.formattedSections = undefined;
      a.slides[0].name = "Verse";
      a.slides = [createNewSlide({ type: "Title", words: ["", "A title"] }), ...a.slides];
      a.arrangements = [{
        id: "A-master", name: "Master", slides: a.slides,
        formattedLyrics: [{ id: "A-lyric", name: "Verse", type: "Verse",
          words: "A initial lyrics", slideSpan: 1 }],
        songOrder: [{ id: "A-order", name: "Verse" }],
      }];
      const b = mockDocs.get("free-B")!;
      b.type = "song"; b.slides[0].name = "Verse";
      b.slides = [createNewSlide({ type: "Title", words: ["", "B title"] }), ...b.slides];
      b.arrangements = [{
        id: "B-master", name: "Master", slides: b.slides,
        formattedLyrics: [{ id: "B-lyric", name: "Verse", type: "Verse",
          words: "B initial lyrics", slideSpan: 1 }],
        songOrder: [{ id: "B-order", name: "Verse" }],
      }];
    }
    const beforeA = clone(a);
    const beforeB = clone(mockDocs.get("free-B"));
    store.dispatch(setActiveItem({ ...clone(a), selectedSlide: sourceType === "song" ? 1 : 0 }));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter><SlideEditor access="full" /></MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit section" }));
    act(() => store.dispatch(setActiveItem({
      ...clone(mockDocs.get("free-B")), selectedSlide: sourceType === "song" ? 1 : 0,
    })));
    await act(async () => { await jest.advanceTimersByTimeAsync(1800); });
    const savedB = mockDocs.get("free-B");
    const savedA = mockDocs.get("free-A");
    expect(savedB).toEqual(beforeB);
    const isSong = sourceType === "song";
    expect(savedA?.type).toBe(sourceType);
    expect(savedA?.arrangements[0]?.id).toBe(isSong ? "A-master" : undefined);
    expect(savedA?.arrangements[0]?.formattedLyrics[0]?.id).toBe(
      isSong ? "A-lyric" : undefined,
    );
    expect(savedA?.arrangements[0]?.formattedLyrics[0]?.words).toBe(
      isSong ? "A pending section text" : undefined,
    );
    expect(savedA?.formattedSections?.[0]?.sectionNum).toBe(
      isSong ? undefined : beforeA?.formattedSections?.[0]?.sectionNum,
    );
    expect(savedA?.formattedSections?.[0]?.words).toBe(
      isSong ? undefined : "A pending section text",
    );
    expect(savedA?.slides.some((slide) =>
      slide.boxes.some((box) => (box.words ?? "").includes("A pending section text")),
    )).toBe(true);
    expect(mockDb.put).toHaveBeenCalledTimes(1);
  });

  it("flushes pending song section text before switching arrangements", async () => {
    const a = clone(mockDocs.get("free-A"))!;
    a.type = "song";
    a.formattedSections = undefined;
    const aSlides = [
      createNewSlide({ type: "Title", words: ["", "A title"] }),
      ...a.slides.map((slide) => ({ ...slide, name: "Verse" })),
    ];
    a.slides = aSlides;
    a.arrangements = [
      {
        id: "A-master",
        name: "Master",
        slides: aSlides,
        formattedLyrics: [{ id: "A-verse", name: "Verse", type: "Verse", words: "A lyrics", slideSpan: 1 }],
        songOrder: [{ id: "A-order", name: "Verse" }],
      },
      {
        id: "A-medley",
        name: "Medley",
        slides: aSlides.map((slide, index) => ({
          ...slide,
          id: index === 0 ? "A-medley-title" : "A-medley-slide",
        })),
        formattedLyrics: [{ id: "A-medley-verse", name: "Verse", type: "Verse", words: "A medley lyrics", slideSpan: 1 }],
        songOrder: [{ id: "A-medley-order", name: "Verse" }],
      },
    ];
    mockDocs.set("free-A", a);
    store.dispatch(setActiveItem({ ...clone(a), selectedArrangement: 0, selectedSlide: 1 }));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter><SlideEditor access="full" /></MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit section" }));
    act(() => store.dispatch(itemSlice.actions._setSelectedArrangement(1)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(store.getState().undoable.present.item.arrangements[0].formattedLyrics[0].words).toBe(
      "A pending section text",
    );
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.arrangements[0].formattedLyrics[0].words).toBe(
      "A pending section text",
    );
    expect(mockDocs.get("free-A")?.arrangements[1].formattedLyrics[0].words).toBe(
      "A medley lyrics",
    );
  });

  it("flushes pending custom section text before changing slides", async () => {
    const a = clone(mockDocs.get("free-A"))!;
    const secondSlide = {
      ...clone(a.slides[0]),
      id: "free-A-slide-2",
      name: "Section 1A",
    };
    a.slides = [...a.slides, secondSlide];
    mockDocs.set("free-A", a);
    store.dispatch(setActiveItem({ ...clone(a), selectedSlide: 0 }));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter><SlideEditor access="full" /></MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit section" }));
    act(() => store.dispatch(setSelectedSlide(1)));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.formattedSections?.[0].words).toBe(
      "A pending section text",
    );
    expect(mockDocs.get("free-B")?.slides[0].boxes[1].words).toBe(
      "free-B exclusive body",
    );
  });

  it("flushes an accepted section reformat when SlideEditor unmounts", async () => {
    const { unmount } = render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter><SlideEditor access="full" /></MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit section" }));
    unmount();
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.formattedSections?.[0].words).toBe(
      "A pending section text",
    );
  });

  it("keeps a rapid rich-text color change on A and preserves a later edit on B", async () => {
    const beforeB = clone(mockDocs.get("free-B"));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <FormattedTextEditor />
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #123456" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #654321" })[0]);
    await act(async () => { await jest.advanceTimersByTimeAsync(251); });
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    store.dispatch(itemSlice.actions._setName("B deliberate edit"));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.slides[0].formattedTextDisplayInfo?.textColor).toBe("#654321");
    expect(mockDocs.get("free-B")?.name).toBe("B deliberate edit");
    expect(mockDocs.get("free-B")?.slides).toEqual(beforeB?.slides);
    expect(mockDocs.get("free-B")?.formattedSections).toEqual(beforeB?.formattedSections);
  });

  it("applies delayed slide color to its original arrangement after selection changes", async () => {
    const a = clone(mockDocs.get("free-A"))!;
    a.type = "song";
    a.formattedSections = undefined;
    const masterSlides = [
      clone(a.slides[0]),
      { ...clone(a.slides[0]), id: "A-master-slide-2", name: "Verse 2" },
    ];
    const medleySlides = [
      { ...clone(a.slides[0]), id: "A-medley-slide", name: "Bridge" },
    ];
    a.slides = masterSlides;
    a.arrangements = [
      { id: "A-master", name: "Master", slides: masterSlides, formattedLyrics: [], songOrder: [] },
      { id: "A-medley", name: "Medley", slides: medleySlides, formattedLyrics: [], songOrder: [] },
    ];
    mockDocs.set("free-A", a);
    store.dispatch(setActiveItem({ ...clone(a), selectedSlide: 0, selectedArrangement: 0 }));
    const beforeB = clone(mockDocs.get("free-B"));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter initialEntries={["/controller/item/a/list-a"]}>
            <SlideEditTools />
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #123456" })[0]);
    act(() => {
      store.dispatch(itemSlice.actions._setSelectedArrangement(1));
      store.dispatch(setSelectedSlide(0));
      store.dispatch(setSelectedBox(1));
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    const savedA = mockDocs.get("free-A");
    expect(savedA?.arrangements[0].id).toBe("A-master");
    expect(savedA?.arrangements[0].slides.map((slide) => slide.id)).toEqual([
      "free-A-slide",
      "A-master-slide-2",
    ]);
    expect(savedA?.arrangements[0].slides.every((slide) =>
      slide.boxes[1].fontColor === "#123456",
    )).toBe(true);
    expect(savedA?.arrangements[1].slides[0].boxes[1].fontColor).toBe(
      beforeB?.slides[0].boxes[1].fontColor,
    );
    expect(mockDocs.get("free-B")).toEqual(beforeB);
  });

  it("flushes font-size input debounce to A before selecting B", async () => {
    const beforeB = clone(mockDocs.get("free-B"));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter initialEntries={["/controller/item/a/list-a"]}>
            <SlideEditTools />
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    const fontInput = screen.getAllByDisplayValue("108")[0];
    fireEvent.change(fontInput, { target: { value: "84" } });
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.slides[0].boxes[1].fontSize).toBe(84);
    expect(mockDocs.get("free-B")).toEqual(beforeB);
  });

  it("flushes deferred bold, italic, and alignment changes to A before navigation", async () => {
    const beforeB = clone(mockDocs.get("free-B"));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter initialEntries={["/controller/item/a/list-a"]}>
            <SlideEditTools />
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Bold" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Italic" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Align center" })[0]);
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    const formattedBox = mockDocs.get("free-A")?.slides[0].boxes[1];
    expect(formattedBox?.isBold).toBe(true);
    expect(formattedBox?.isItalic).toBe(true);
    expect(formattedBox?.align).toBe("center");
    expect(mockDocs.get("free-B")).toEqual(beforeB);
  });

  it("saves a pending edit to the original database when the active church changes", async () => {
    const beforeA = clone(mockDocs.get("free-A"));
    const beforeOtherChurch = {
      ...clone(mockDocs.get("free-A"))!,
      name: "Other church document with same ID",
    };
    mockDatabaseBDocs.set("free-A", clone(beforeOtherChurch));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <FormattedTextEditor />
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #123456" })[0]);
    const ownerB = {
      scopeId: "other-church/database-b",
      databaseKey: "database-b",
      churchId: "other-church",
    };
    await act(async () => {
      await flushContentDatabaseBeforeTeardown(mockActiveOwner.scopeId);
    });
    setActiveContentDatabase(ownerB, mockDatabaseB as never);
    mockCurrentDb = mockDatabaseB;
    act(() => store.dispatch(setActiveItem(clone(beforeOtherChurch))));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.slides[0].formattedTextDisplayInfo?.textColor).toBe("#123456");
    expect(mockDatabaseBDocs.get("free-A")).toEqual(beforeOtherChurch);
    expect(mockDb.get).toHaveBeenCalledWith("free-A");
    expect(mockDatabaseB.get).not.toHaveBeenCalled();
    expect(mockDatabaseB.put).not.toHaveBeenCalled();
    expect(beforeA?.name).toBe("free-A");
  });

  it("keeps a custom A section edit out of a song B", async () => {
    const a = clone(mockDocs.get("free-A"))!;
    const songB = clone(mockDocs.get("free-B"))!;
    songB.type = "song";
    songB.formattedSections = undefined;
    songB.slides = [
      createNewSlide({ type: "Title", words: ["", "Song B title"] }),
      { ...clone(songB.slides[0]), id: "song-B-verse-slide", name: "Verse" },
    ];
    songB.arrangements = [{
      id: "song-B-master",
      name: "Master",
      slides: songB.slides,
      formattedLyrics: [{
        id: "song-B-lyric",
        name: "Verse",
        type: "Verse",
        words: "B lyrics stay here",
        slideSpan: 1,
      }],
      songOrder: [{ id: "song-B-order", name: "Verse" }],
    }];
    mockDocs.set("free-A", a);
    mockDocs.set("free-B", songB);
    const beforeB = clone(songB);
    store.dispatch(setActiveItem({ ...clone(a), selectedSlide: 0 }));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter><SlideEditor access="full" /></MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit section" }));
    act(() => store.dispatch(setActiveItem({ ...clone(songB), selectedSlide: 1 })));
    await act(async () => { await jest.advanceTimersByTimeAsync(1800); });

    expect(mockDocs.get("free-A")?.formattedSections?.[0].words).toBe("A pending section text");
    expect(mockDocs.get("free-B")).toEqual(beforeB);
  });

  it("formats and autosaves normally while remaining on the same item", async () => {
    const beforeB = clone(mockDocs.get("free-B"));
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <FormattedTextEditor />
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color #123456" })[0]);
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });

    expect(mockDocs.get("free-A")?.slides[0].formattedTextDisplayInfo?.textColor).toBe("#123456");
    expect(mockDocs.get("free-B")).toEqual(beforeB);
    expect(mockDb.put).toHaveBeenCalledTimes(1);
  });
});
