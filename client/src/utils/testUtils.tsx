import React, { ReactNode } from "react";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore, UnknownAction } from "@reduxjs/toolkit";
import { presentationSlice } from "../store/presentationSlice";
import { itemListSlice } from "../store/itemListSlice";
import { overlaysSlice } from "../store/overlaysSlice";
import { preferencesSlice } from "../store/preferencesSlice";
import { DndContext } from "@dnd-kit/core";
import { ControllerInfoContext } from "../context/controllerInfo";
import { DisplayType, Presentation } from "../types";
import { Cloudinary } from "@cloudinary/url-gen";

// Mock the DisplayWindow component
jest.mock("../components/DisplayWindow/DisplayWindow", () => {
  return function MockDisplayWindow() {
    return <div data-testid="display-window">Display Window</div>;
  };
});

// Mock the ControllerInfoContext
jest.mock("../context/controllerInfo", () => ({
  ControllerInfoContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
  },
}));

// Mock the useSensors hook
jest.mock("../utils/dndUtils", () => ({
  useSensors: () => [],
}));

// Mock ResizeObserver
class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  callback: ResizeObserverCallback;
  observe(target: Element, options?: ResizeObserverOptions): void {
    // Mock implementation
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            top: 0,
            right: 100,
            bottom: 100,
            left: 0,
            toJSON: () => ({
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              top: 0,
              right: 100,
              bottom: 100,
              left: 0,
            }),
          },
          borderBoxSize: [{ blockSize: 100, inlineSize: 100 }],
          contentBoxSize: [{ blockSize: 100, inlineSize: 100 }],
          devicePixelContentBoxSize: [{ blockSize: 100, inlineSize: 100 }],
        },
      ],
      this
    );
  }
  unobserve(target: Element): void {
    // Mock implementation
  }
  disconnect(): void {
    // Mock implementation
  }
}

// Ensure ResizeObserver is available globally
if (typeof window !== "undefined") {
  window.ResizeObserver = MockResizeObserver;
}

const emptyPresentation: Presentation = {
  type: "",
  name: "",
  slide: null,
  displayType: "projector" as DisplayType,
};

export interface RootState {
  undoable: {
    present: {
      overlays: ReturnType<typeof overlaysSlice.reducer>;
      itemList: ReturnType<typeof itemListSlice.reducer>;
    };
  };
  presentation: ReturnType<typeof presentationSlice.reducer>;
  preferences: {
    isMediaExpanded: boolean;
    slidesPerRow: number;
    slidesPerRowMobile: number;
    formattedLyricsPerRow: number;
    shouldShowItemEditor: boolean;
    mediaItemsPerRow: number;
  };
}

// Create a mock store that uses the real reducers
export const createMockStore = (initialState: Partial<RootState> = {}) => {
  const store = configureStore({
    reducer: {
      undoable: (state: any = {}, action: UnknownAction) => ({
        present: {
          overlays: overlaysSlice.reducer(state?.present?.overlays, action),
          itemList: itemListSlice.reducer(state?.present?.itemList, action),
        },
      }),
      presentation: presentationSlice.reducer,
      preferences: preferencesSlice.reducer,
    },
    preloadedState: {
      ...initialState,
      presentation: {
        isProjectorTransmitting: false,
        isMonitorTransmitting: false,
        isStreamTransmitting: false,
        prevProjectorInfo: {
          ...emptyPresentation,
          displayType: "projector" as DisplayType,
        },
        prevMonitorInfo: {
          ...emptyPresentation,
          displayType: "monitor" as DisplayType,
        },
        prevStreamInfo: {
          ...emptyPresentation,
          displayType: "stream" as DisplayType,
        },
        projectorInfo: {
          ...emptyPresentation,
          displayType: "projector" as DisplayType,
        },
        monitorInfo: {
          ...emptyPresentation,
          displayType: "monitor" as DisplayType,
        },
        streamInfo: {
          ...emptyPresentation,
          displayType: "stream" as DisplayType,
          participantOverlayInfo: {
            name: "",
            time: Date.now(),
            id: "test-id",
          },
          stbOverlayInfo: {
            heading: "",
            time: Date.now(),
            id: "test-id",
          },
          qrCodeOverlayInfo: {
            time: Date.now(),
            id: "test-id",
          },
          imageOverlayInfo: {
            time: Date.now(),
            id: "test-id",
          },
        },
        ...initialState?.presentation,
      },
      preferences: {
        isMediaExpanded: false,
        slidesPerRow: 3,
        slidesPerRowMobile: 1,
        formattedLyricsPerRow: 1,
        shouldShowItemEditor: false,
        mediaItemsPerRow: 3,
        ...initialState?.preferences,
      },
    },
  });
  return store;
};

// Create a wrapper component for tests that need Redux and DnD
export const createWrapper = (store: ReturnType<typeof createMockStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <DndContext>
        <ControllerInfoContext.Provider
          value={{
            isMobile: false,
            dbProgress: 0,
            setIsMobile: () => {},
            db: undefined,
            bibleDb: undefined,
            cloud: new Cloudinary({
              cloud: {
                cloudName: "test",
              },
            }),
            updater: new EventTarget(),
            logout: async () => {},
            login: async () => {},
          }}
        >
          {children}
        </ControllerInfoContext.Provider>
      </DndContext>
    </Provider>
  );
};

// Custom render function that includes the store wrapper
export const renderWithStore = (
  ui: React.ReactElement,
  store: ReturnType<typeof createMockStore>
) => {
  return render(ui, { wrapper: createWrapper(store) });
};
