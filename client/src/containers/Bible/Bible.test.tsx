import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Bible from "./Bible";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import bibleReducer from "../../store/bibleSlice";
import presentationReducer from "../../store/presentationSlice";
import { verseType } from "../../types";

// Extend verseType to include notes
type VerseWithNotes = verseType & {
  notes?: string;
};

const mockStore = configureStore({
  reducer: {
    bible: bibleReducer,
    presentation: presentationReducer,
  },
  preloadedState: {
    bible: {
      version: "NIV",
      book: 0,
      chapter: 3,
      startVerse: 16,
      endVerse: 16,
      verses: [
        { name: "16", index: 16, text: "For God so loved the world..." },
      ],
      books: [
        {
          name: "John",
          chapters: [
            {
              name: "3",
              verses: [
                {
                  name: "16",
                  index: 16,
                  text: "For God so loved the world...",
                },
              ],
              index: 3,
            },
          ],
          index: 0,
        },
      ],
      chapters: [
        {
          name: "3",
          verses: [
            { name: "16", index: 16, text: "For God so loved the world..." },
          ],
          index: 3,
        },
      ],
      searchValue: "",
      retrievedVerses: [],
      searchValues: {
        book: "",
        chapter: "",
        startVerse: "",
        endVerse: "",
      },
    },
    presentation: {
      isProjectorTransmitting: false,
      isMonitorTransmitting: false,
      isStreamTransmitting: false,
      prevProjectorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      prevMonitorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      prevStreamInfo: {
        type: "",
        name: "",
        slide: null,
      },
      projectorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      monitorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      streamInfo: {
        type: "",
        name: "",
        slide: null,
      },
    },
  },
});

describe("Bible", () => {
  it("renders bible version selector", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Version")).toBeInTheDocument();
    expect(screen.getByDisplayValue("NIV")).toBeInTheDocument();
  });

  it("renders book selector", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Book")).toBeInTheDocument();
    expect(screen.getByDisplayValue("John")).toBeInTheDocument();
  });

  it("renders chapter selector", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Chapter")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
  });

  it("renders verse selectors", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Start Verse")).toBeInTheDocument();
    expect(screen.getByLabelText("End Verse")).toBeInTheDocument();
    expect(screen.getByDisplayValue("16")).toBeInTheDocument();
  });

  it("displays selected verses", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(
      screen.getByText("For God so loved the world...")
    ).toBeInTheDocument();
  });

  it("handles version change", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const versionSelect = screen.getByLabelText("Version");
    fireEvent.change(versionSelect, { target: { value: "KJV" } });

    expect(screen.getByDisplayValue("KJV")).toBeInTheDocument();
  });

  it("handles book change", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const bookSelect = screen.getByLabelText("Book");
    fireEvent.change(bookSelect, { target: { value: "Matthew" } });

    expect(screen.getByDisplayValue("Matthew")).toBeInTheDocument();
  });

  it("handles chapter change", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const chapterSelect = screen.getByLabelText("Chapter");
    fireEvent.change(chapterSelect, { target: { value: "4" } });

    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
  });

  it("handles verse range change", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const startVerseSelect = screen.getByLabelText("Start Verse");
    const endVerseSelect = screen.getByLabelText("End Verse");

    fireEvent.change(startVerseSelect, { target: { value: "1" } });
    fireEvent.change(endVerseSelect, { target: { value: "3" } });

    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
  });

  it("handles search functionality", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "love" } });

    expect(screen.getByDisplayValue("love")).toBeInTheDocument();
  });

  it("handles adding to presentation", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const addButton = screen.getByText("Add to Presentation");
    fireEvent.click(addButton);

    const state = mockStore.getState();
    expect(state.presentation.projectorInfo.bibleDisplayInfo).toBeDefined();
    expect(state.presentation.monitorInfo.bibleDisplayInfo).toBeDefined();
    expect(state.presentation.streamInfo.bibleDisplayInfo).toBeDefined();
  });

  it("handles saving as item", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const saveButton = screen.getByText("Save as Item");
    fireEvent.click(saveButton);

    const state = mockStore.getState();
    expect(state.bible.retrievedVerses).toHaveLength(1);
  });

  it("handles verse formatting", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const verse = screen.getByText("For God so loved the world...");
    expect(verse).toHaveStyle({
      fontSize: "24px",
      textAlign: "center",
    });
  });

  it("handles verse selection", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const verse = screen.getByText("For God so loved the world...");
    fireEvent.click(verse);

    expect(verse).toHaveStyle({
      backgroundColor: "#f0f0f0",
    });
  });

  it("handles verse copying", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const copyButton = screen.getByText("Copy");
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "For God so loved the world..."
    );
  });

  it("handles verse sharing", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const shareButton = screen.getByText("Share");
    fireEvent.click(shareButton);

    expect(navigator.share).toHaveBeenCalledWith({
      title: "John 3:16",
      text: "For God so loved the world...",
    });
  });

  it("handles verse bookmarking", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const bookmarkButton = screen.getByText("Bookmark");
    fireEvent.click(bookmarkButton);

    const state = mockStore.getState();
    expect(state.bible.retrievedVerses).toHaveLength(1);
  });

  it("handles verse notes", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const notesButton = screen.getByText("Notes");
    fireEvent.click(notesButton);

    const notesInput = screen.getByLabelText("Notes");
    fireEvent.change(notesInput, { target: { value: "Test note" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    const state = mockStore.getState();
    const verse = state.bible.verses[0] as VerseWithNotes;
    expect(verse.notes).toBe("Test note");
  });

  it("handles verse highlighting", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const highlightButton = screen.getByText("Highlight");
    fireEvent.click(highlightButton);

    const verse = screen.getByText("For God so loved the world...");
    expect(verse).toHaveStyle({
      backgroundColor: "#ffff00",
    });
  });

  it("handles verse printing", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const printButton = screen.getByText("Print");
    fireEvent.click(printButton);

    expect(window.print).toHaveBeenCalled();
  });

  it("handles verse emailing", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const emailButton = screen.getByText("Email");
    fireEvent.click(emailButton);

    expect(window.location.href).toBe(
      "mailto:?subject=John 3:16&body=For God so loved the world..."
    );
  });
});
