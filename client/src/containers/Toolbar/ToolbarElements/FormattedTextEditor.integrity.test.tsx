import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { createMockGlobalContext } from "../../../test/mocks";
import { createNewSlide } from "../../../utils/slideCreation";
import type { DBItem } from "../../../types";

jest.mock("../../../components/PopOver/PopoverPanel", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../../../components/ColorField/ColorField", () => ({
  BrandAwareColorPicker: ({ onChange }: { onChange: (color: string) => void }) =>
    <button onClick={() => onChange("#123456")}>Choose color</button>,
}));
jest.mock("../../../context/controllerInfo", () => ({
  ControllerInfoContext: jest.requireActual("react").createContext(null),
  get globalDb() { return mockDb; }, globalBroadcastRef: undefined,
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

// Load after the scoped DB mocks; exercise the actual Redux thunks/listeners.
const store = require("../../../store/store").default;
const { setActiveItem } = require("../../../store/itemSlice");
const FormattedTextEditor = require("./FormattedTextEditor").default;
const SlideEditTools = require("./SlideEditTools").default;
const SlideEditor = require("../../ItemEditor/SlideEditor").default;

describe("delayed formatted text content integrity", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    store.dispatch({ type: "RESET" });
    mockDocs.clear();
    jest.clearAllMocks();
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

  it.each([false, true])("writes A slides into B after a color change, unmounted=%s", async (unmountBeforeTimer) => {
    const beforeA = clone(mockDocs.get("free-A"));
    const { unmount } = render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <FormattedTextEditor />
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color" })[0]);
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    if (unmountBeforeTimer) unmount();
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });
    const savedB = mockDocs.get("free-B");
    expect(mockDocs.get("free-A")).toEqual(beforeA);
    expect(savedB?.name).toBe("free-B");
    expect(savedB?.slides[0].id).toBe("free-A-slide");
    expect(savedB?.slides[0].boxes[1].words).toBe("free-A exclusive body");
    expect(savedB?.slides[0].formattedTextDisplayInfo?.text).toBe("free-A exclusive rich text");
    expect(mockDb.put).toHaveBeenCalledTimes(1);
  });

  it.each(["song", "free"])("writes all A arrangements under B's title after delayed slide color, destination=%s", async (destinationType) => {
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
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext()}>
          <MemoryRouter initialEntries={["/controller/item/a/list-a"]}>
            <SlideEditTools />
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Choose color" })[0]);
    act(() => store.dispatch(setActiveItem(clone(mockDocs.get("free-B")))));
    await act(async () => { await jest.advanceTimersByTimeAsync(1750); });
    const savedB = mockDocs.get("free-B");
    expect(mockDocs.get("free-A")).toEqual(beforeA);
    expect(savedB?.name).toBe("free-B");
    expect(savedB?.type).toBe(destinationType);
    expect(savedB?.arrangements.map(arr => arr.id)).toEqual(["free-A-master", "free-A-medley"]);
    expect(savedB?.arrangements[0].formattedLyrics[0].id).toBe("free-A-verse");
    expect(savedB?.arrangements[0].formattedLyrics[0].words).toBe("free-A song lyrics");
    expect(savedB?.slides[0].id).toBe("free-A-slide");
  });

  it.each(["song", "free"])("section reformat work crosses item selection, source=%s", async (sourceType) => {
    const a = mockDocs.get("free-A")!;
    if (sourceType === "song") {
      a.type = "song";
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
    expect(savedB?.name).toBe("free-B");
    const transplantedText = sourceType === "song"
      ? savedB?.arrangements[0].formattedLyrics[0].words : savedB?.formattedSections?.[0].words;
    const arrangementIds = savedB?.arrangements.map(arr => arr.id);
    const expectedIds = sourceType === "song" ? ["A-master"] : [];
    expect(transplantedText).toBe("A pending section text");
    expect(arrangementIds).toEqual(expectedIds);
    expect(mockDocs.get("free-A")).toEqual(beforeA);
    expect(mockDb.put).toHaveBeenCalledTimes(1);
  });
});
