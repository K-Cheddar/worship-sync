import { fireEvent, render, screen, within } from "@testing-library/react";
import { keepElementInView } from "../../utils/generalUtils";
import type { verseType } from "../../types";
import BibleVersesList from "./BibleVersesList";

jest.mock("../../utils/generalUtils", () => ({
  keepElementInView: jest.fn(),
}));

const mockedKeepElementInView = keepElementInView as jest.MockedFunction<
  typeof keepElementInView
>;

const verses: verseType[] = [
  { index: 0, name: "1", text: "In the beginning" },
  { index: 1, name: "2", text: "The earth was formless" },
  { index: 2, name: "3", text: "And God said" },
];

const renderList = (
  options: {
    verses?: verseType[];
    startVerse?: number;
    endVerse?: number;
    canTransmit?: boolean;
  } = {}
) => {
  const sendVerse = jest.fn();
  const view = render(
    <>
      <input aria-label="Typing field" />
      <BibleVersesList
        isLoading={false}
        verses={options.verses ?? verses}
        startVerse={options.startVerse ?? 0}
        endVerse={options.endVerse ?? 2}
        canTransmit={options.canTransmit ?? true}
        sendVerse={sendVerse}
      />
    </>
  );
  return { ...view, sendVerse };
};

const sendButtonAt = (position: number) =>
  within(screen.getAllByRole("listitem")[position]).getByRole("button", {
    name: "Send",
  });

describe("BibleVersesList", () => {
  beforeEach(() => {
    mockedKeepElementInView.mockClear();
  });

  it("sends and selects an individual verse in a range starting at zero", () => {
    const { sendVerse } = renderList();
    fireEvent.click(sendButtonAt(1));

    expect(sendVerse).toHaveBeenCalledTimes(1);
    expect(sendVerse).toHaveBeenCalledWith(verses[1]);
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("border-cyan-400");
    expect(mockedKeepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "bible-verse-1" }),
      })
    );
  });

  it("targets the absolute verse DOM id when an individual verse is sent from a nonzero range", () => {
    const rangedVerses = [
      { index: 8, name: "9", text: "Outside the range" },
      { index: 9, name: "10", text: "Within the range" },
      { index: 14, name: "15", text: "Selected verse" },
    ];
    const { sendVerse } = renderList({
      verses: rangedVerses,
      startVerse: 9,
      endVerse: 14,
    });

    fireEvent.click(sendButtonAt(1));

    expect(sendVerse).toHaveBeenCalledTimes(1);
    expect(sendVerse).toHaveBeenCalledWith(rangedVerses[2]);
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("border-cyan-400");
    expect(mockedKeepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "bible-verse-14" }),
      })
    );
    expect(mockedKeepElementInView).not.toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "bible-verse-23" }),
      })
    );
  });

  it("advances to the next renderable verse with Space", () => {
    const rangedVerses = [
      { index: 9, name: "10", text: "First" },
      { index: 14, name: "15", text: "Second" },
      { index: 18, name: "19", text: "Third" },
    ];
    const { sendVerse } = renderList({
      verses: rangedVerses,
      startVerse: 9,
      endVerse: 18,
    });
    fireEvent.click(sendButtonAt(0));
    sendVerse.mockClear();

    fireEvent.keyDown(window, { key: " " });

    expect(sendVerse).toHaveBeenCalledTimes(1);
    expect(sendVerse).toHaveBeenCalledWith(rangedVerses[1]);
    expect(screen.getAllByRole("listitem")[1]).toHaveClass("border-cyan-400");
  });

  it("moves back exactly one renderable verse with Shift+Space", () => {
    const rangedVerses = [
      { index: 9, name: "10", text: "First" },
      { index: 14, name: "15", text: "Second" },
      { index: 18, name: "19", text: "Third" },
    ];
    const { sendVerse } = renderList({
      verses: rangedVerses,
      startVerse: 9,
      endVerse: 18,
    });
    fireEvent.click(sendButtonAt(1));
    sendVerse.mockClear();

    fireEvent.keyDown(window, { key: " ", shiftKey: true });

    expect(sendVerse).toHaveBeenCalledTimes(1);
    expect(sendVerse).toHaveBeenCalledWith(rangedVerses[0]);
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("border-cyan-400");
  });

  it("stops at both range boundaries", () => {
    const { sendVerse } = renderList();
    fireEvent.click(sendButtonAt(0));
    sendVerse.mockClear();

    fireEvent.keyDown(window, { key: " ", shiftKey: true });

    expect(sendVerse).not.toHaveBeenCalled();

    fireEvent.click(sendButtonAt(2));
    sendVerse.mockClear();
    fireEvent.keyDown(window, { key: " " });

    expect(sendVerse).not.toHaveBeenCalled();
  });

  it("skips blank verses and ignores shortcuts while typing or unable to transmit", () => {
    const rangedVerses = [
      { index: 4, name: "5", text: "First" },
      { index: 5, name: "6", text: "  " },
      { index: 8, name: "9", text: "Last" },
    ];
    const { sendVerse, rerender } = renderList({
      verses: rangedVerses,
      startVerse: 4,
      endVerse: 8,
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(sendButtonAt(0));
    sendVerse.mockClear();

    fireEvent.keyDown(window, { key: " " });

    expect(sendVerse).toHaveBeenCalledWith(rangedVerses[2]);
    expect(sendVerse).toHaveBeenCalledTimes(1);

    sendVerse.mockClear();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Typing field" }), {
      key: " ",
    });
    expect(sendVerse).not.toHaveBeenCalled();

    rerender(
      <>
        <input aria-label="Typing field" />
        <BibleVersesList
          isLoading={false}
          verses={rangedVerses}
          startVerse={4}
          endVerse={8}
          canTransmit={false}
          sendVerse={sendVerse}
        />
      </>
    );
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    expect(sendVerse).not.toHaveBeenCalled();
  });
});
