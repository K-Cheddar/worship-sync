import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Bible from "./Bible";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import bibleReducer from "../../store/bibleSlice";
import presentationReducer from "../../store/presentationSlice";

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
  });

  it("renders book selector", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Book")).toBeInTheDocument();
  });

  it("renders chapter selector", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Chapter")).toBeInTheDocument();
  });

  it("renders verse selectors", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    expect(screen.getByLabelText("Start Verse")).toBeInTheDocument();
    expect(screen.getByLabelText("End Verse")).toBeInTheDocument();
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

    // Add assertions for version change
  });

  it("handles book change", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const bookSelect = screen.getByLabelText("Book");
    fireEvent.change(bookSelect, { target: { value: "Matthew" } });

    // Add assertions for book change
  });

  it("handles chapter change", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const chapterSelect = screen.getByLabelText("Chapter");
    fireEvent.change(chapterSelect, { target: { value: "4" } });

    // Add assertions for chapter change
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

    // Add assertions for verse range change
  });

  it("handles search functionality", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "love" } });

    // Add assertions for search results
  });

  it("handles adding to presentation", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const addButton = screen.getByText("Add to Presentation");
    fireEvent.click(addButton);

    // Add assertions for presentation update
  });

  it("handles saving as item", () => {
    render(
      <Provider store={mockStore}>
        <Bible />
      </Provider>
    );

    const saveButton = screen.getByText("Save as Item");
    fireEvent.click(saveButton);

    // Add assertions for item creation
  });
});
