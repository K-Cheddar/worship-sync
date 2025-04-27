import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import TransmitHandler from "./TransmitHandler";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import presentationReducer from "../../store/presentationSlice";

const mockStore = configureStore({
  reducer: {
    presentation: presentationReducer,
  },
  preloadedState: {
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

describe("TransmitHandler", () => {
  it("renders transmit buttons", () => {
    render(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    expect(screen.getByText("Projector")).toBeInTheDocument();
    expect(screen.getByText("Monitor")).toBeInTheDocument();
    expect(screen.getByText("Stream")).toBeInTheDocument();
  });

  it("handles projector transmission toggle", () => {
    render(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    const projectorButton = screen.getByText("Projector");
    fireEvent.click(projectorButton);

    // Add assertions for projector transmission
  });

  it("handles monitor transmission toggle", () => {
    render(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    const monitorButton = screen.getByText("Monitor");
    fireEvent.click(monitorButton);

    // Add assertions for monitor transmission
  });

  it("handles stream transmission toggle", () => {
    render(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    const streamButton = screen.getByText("Stream");
    fireEvent.click(streamButton);

    // Add assertions for stream transmission
  });

  it("handles multiple transmission toggles", () => {
    render(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    const projectorButton = screen.getByText("Projector");
    const monitorButton = screen.getByText("Monitor");
    const streamButton = screen.getByText("Stream");

    fireEvent.click(projectorButton);
    fireEvent.click(monitorButton);
    fireEvent.click(streamButton);

    // Add assertions for multiple transmissions
  });

  it("handles transmission state persistence", () => {
    const { rerender } = render(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    const projectorButton = screen.getByText("Projector");
    fireEvent.click(projectorButton);

    rerender(
      <Provider store={mockStore}>
        <TransmitHandler />
      </Provider>
    );

    // Add assertions for state persistence
  });
});
