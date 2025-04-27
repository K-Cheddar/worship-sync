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
  it("renders slides with correct content", () => {
    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();
    expect(screen.getByTestId("slide-container")).toBeInTheDocument();
  });

  it("handles slide selection and updates presentation state", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: {
        ...mockStore.getState(),
        presentation: {
          ...mockStore.getState().presentation,
          isProjectorTransmitting: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const slide = screen.getByText("Test words");
    fireEvent.click(slide);

    const state = store.getState();
    expect(state.presentation.projectorInfo.slide).toBeDefined();
    expect(state.presentation.projectorInfo.type).toBe("song");
    expect(state.presentation.projectorInfo.name).toBe("Test Item");
  });

  it("handles slide addition and updates state", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: mockStore.getState(),
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const addButton = screen.getByText("Add Slide");
    fireEvent.click(addButton);

    const state = store.getState();
    expect(state.item.slides.length).toBe(2);
    expect(state.item.slides[1].type).toBe("Section");
    expect(state.item.slides[1].boxes).toHaveLength(1);
  });

  it("handles slide deletion and updates state", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: mockStore.getState(),
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const deleteButton = screen.getByText("Delete Slide");
    fireEvent.click(deleteButton);

    const state = store.getState();
    expect(state.item.slides).toHaveLength(0);
  });

  it("handles slide zoom and updates preferences", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: mockStore.getState(),
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const zoomInButton = screen.getByText("Zoom In");
    const zoomOutButton = screen.getByText("Zoom Out");

    fireEvent.click(zoomInButton);
    expect(screen.getByTestId("slide-container")).toHaveStyle({
      transform: "scale(1.1)",
    });

    fireEvent.click(zoomOutButton);
    expect(screen.getByTestId("slide-container")).toHaveStyle({
      transform: "scale(1)",
    });
  });

  it("handles mobile view and updates layout", () => {
    global.innerWidth = 500;
    global.dispatchEvent(new Event("resize"));

    render(
      <Provider store={mockStore}>
        <ItemSlides />
      </Provider>
    );

    expect(screen.getByTestId("slides-grid")).toHaveStyle({
      gridTemplateColumns: "repeat(3, 1fr)",
    });
  });

  it("handles slide updates and syncs with transmitting displays", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: {
        ...mockStore.getState(),
        presentation: {
          ...mockStore.getState().presentation,
          isProjectorTransmitting: true,
          isMonitorTransmitting: true,
          isStreamTransmitting: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const slide = screen.getByText("Test words");
    fireEvent.click(slide);

    const state = store.getState();
    expect(state.presentation.projectorInfo.slide).toBeDefined();
    expect(state.presentation.monitorInfo.slide).toBeDefined();
    expect(state.presentation.streamInfo.slide).toBeDefined();
  });

  it("handles arrangement selection", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: {
        ...mockStore.getState(),
        item: {
          ...mockStore.getState().item,
          arrangements: [
            ...mockStore.getState().item.arrangements,
            {
              name: "Alternative",
              formattedLyrics: [],
              songOrder: [],
              slides: [
                {
                  type: "Section",
                  id: "slide-2",
                  boxes: [
                    {
                      id: "box-2",
                      words: "Alternative words",
                      width: 100,
                      height: 100,
                      x: 0,
                      y: 0,
                    },
                  ],
                },
              ],
              id: "arrangement-2",
            },
          ],
        },
      },
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const arrangementSelect = screen.getByLabelText("Arrangement");
    fireEvent.change(arrangementSelect, { target: { value: "Alternative" } });

    expect(screen.getByText("Alternative words")).toBeInTheDocument();
  });

  it("handles edit mode toggle", () => {
    const store = configureStore({
      reducer: {
        item: itemReducer,
        presentation: presentationReducer,
        preferences: preferencesReducer,
      },
      preloadedState: mockStore.getState(),
    });

    render(
      <Provider store={store}>
        <ItemSlides />
      </Provider>
    );

    const editButton = screen.getByText("Edit");
    fireEvent.click(editButton);

    const state = store.getState();
    expect(state.item.isEditMode).toBe(true);
    expect(screen.getByTestId("slide-container")).toHaveClass("edit-mode");
  });
});
