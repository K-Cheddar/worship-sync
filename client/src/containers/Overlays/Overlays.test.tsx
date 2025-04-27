import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Overlays from "./Overlays";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import overlaysReducer from "../../store/overlaysSlice";
import presentationReducer from "../../store/presentationSlice";

const mockStore = configureStore({
  reducer: {
    overlays: overlaysReducer,
    presentation: presentationReducer,
  },
  preloadedState: {
    overlays: {
      list: [
        {
          id: "test-id",
          type: "participant" as const,
          name: "Test Participant",
          title: "Test Title",
          event: "Test Event",
          heading: "Test Heading",
          subHeading: "Test Subheading",
          url: "https://example.com",
          description: "Test Description",
          color: "#16a34a",
          imageUrl: "https://example.com/image.jpg",
          duration: 7,
          time: Date.now(),
        },
      ],
      initialList: ["test-id"],
      isLoading: false,
      hasPendingUpdate: false,
      name: "",
      title: "",
      event: "",
      heading: "",
      subHeading: "",
      url: "",
      description: "",
      color: "#16a34a",
      id: "",
      duration: 7,
      type: "participant" as const,
      imageUrl: "",
    },
  },
});

describe("Overlays", () => {
  it("renders overlay list", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    expect(screen.getByText("Overlays")).toBeInTheDocument();
  });

  it("handles adding new overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const addButton = screen.getByText("Add Overlay");
    fireEvent.click(addButton);

    // Add assertions for overlay creation
  });

  it("handles editing overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const editButton = screen.getByText("Edit");
    fireEvent.click(editButton);

    // Add assertions for overlay editing
  });

  it("handles deleting overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const deleteButton = screen.getByText("Delete");
    fireEvent.click(deleteButton);

    // Add assertions for overlay deletion
  });

  it("handles participant overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const participantButton = screen.getByText("Participant");
    fireEvent.click(participantButton);

    // Add assertions for participant overlay
  });

  it("handles STB overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const stbButton = screen.getByText("Stick to Bottom");
    fireEvent.click(stbButton);

    // Add assertions for STB overlay
  });

  it("handles QR code overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const qrButton = screen.getByText("QR Code");
    fireEvent.click(qrButton);

    // Add assertions for QR code overlay
  });

  it("handles image overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const imageButton = screen.getByText("Image");
    fireEvent.click(imageButton);

    // Add assertions for image overlay
  });

  it("handles overlay positioning", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const positionButton = screen.getByText("Position");
    fireEvent.click(positionButton);

    // Add assertions for overlay positioning
  });

  it("handles overlay styling", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const styleButton = screen.getByText("Style");
    fireEvent.click(styleButton);

    // Add assertions for overlay styling
  });
});
