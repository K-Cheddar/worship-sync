import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ItemSlides from "./ItemSlides";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import itemReducer from "../../store/itemSlice";
import presentationReducer from "../../store/presentationSlice";
import preferencesReducer from "../../store/preferencesSlice";

const mockStore = configureStore({
  reducer: {
    item: itemReducer,
    presentation: presentationReducer,
    preferences: preferencesReducer,
  },
  preloadedState: {
    item: {
      name: "Test Item",
      type: "song",
      _id: "test-id",
      selectedArrangement: 0,
      arrangements: [
        {
          name: "Default",
          formattedLyrics: [],
          songOrder: [],
          slides: [
            {
              type: "Section",
              id: "slide-1",
              boxes: [
                {
                  id: "box-1",
                  words: "Test words",
                  width: 100,
                  height: 100,
                  x: 0,
                  y: 0,
                },
              ],
            },
          ],
          id: "arrangement-1",
        },
      ],
      selectedSlide: 0,
      selectedBox: 0,
      slides: [
        {
          type: "Section",
          id: "slide-1",
          boxes: [
            {
              id: "box-1",
              words: "Test words",
              width: 100,
              height: 100,
              x: 0,
              y: 0,
            },
          ],
        },
      ],
      isEditMode: false,
      background: "",
      bibleInfo: {
        book: "",
        chapter: "",
        version: "",
        verses: [],
      },
      isLoading: false,
      hasPendingUpdate: false,
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
    preferences: {
      slidesPerRow: 4,
      slidesPerRowMobile: 3,
      formattedLyricsPerRow: 4,
      shouldShowItemEditor: true,
      isMediaExpanded: false,
      mediaItemsPerRow: 4,
    },
  },
});

describe("ItemSlides", () => {
  it("renders slides", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();
  });

  it("handles slide selection", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    const slide = screen.getByText("Test words");
    fireEvent.click(slide);

    // Add assertions for slide selection
  });

  it("handles slide addition", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    const addButton = screen.getByText("Add Slide");
    fireEvent.click(addButton);

    // Add assertions for slide addition
  });

  it("handles slide deletion", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    const deleteButton = screen.getByText("Delete Slide");
    fireEvent.click(deleteButton);

    // Add assertions for slide deletion
  });

  it("handles slide reordering", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    // Add drag and drop test
    // Note: This is a placeholder as we need to add drag and drop test cases
  });

  it("handles slide zoom", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    const zoomInButton = screen.getByText("Zoom In");
    const zoomOutButton = screen.getByText("Zoom Out");

    fireEvent.click(zoomInButton);
    fireEvent.click(zoomOutButton);

    // Add assertions for slide zoom
  });

  it("handles mobile view", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    // Add mobile view test
    // Note: This is a placeholder as we need to add mobile view test cases
  });

  it("handles slide updates", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    // Add slide update test
    // Note: This is a placeholder as we need to add slide update test cases
  });
});
