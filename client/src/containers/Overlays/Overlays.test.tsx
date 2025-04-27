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
        {
          id: "stb-id",
          type: "stick-to-bottom" as const,
          heading: "Test STB",
          subHeading: "Test STB Subheading",
          color: "#2563eb",
          duration: 7,
          time: Date.now(),
        },
        {
          id: "qr-id",
          type: "qr-code" as const,
          url: "https://example.com",
          description: "Test QR Code",
          color: "#9333ea",
          duration: 7,
          time: Date.now(),
        },
        {
          id: "image-id",
          type: "image" as const,
          name: "Test Image",
          imageUrl: "https://example.com/image.jpg",
          color: "#eab308",
          duration: 7,
          time: Date.now(),
        },
      ],
      initialList: ["test-id", "stb-id", "qr-id", "image-id"],
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

describe("Overlays", () => {
  it("renders overlay list", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    expect(screen.getByText("Overlays")).toBeInTheDocument();
    expect(screen.getByText("Test Participant")).toBeInTheDocument();
    expect(screen.getByText("Test STB")).toBeInTheDocument();
    expect(screen.getByText("Test QR Code")).toBeInTheDocument();
    expect(screen.getByText("Test Image")).toBeInTheDocument();
  });

  it("handles adding new overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const addButton = screen.getByText("Add Overlay");
    fireEvent.click(addButton);

    const nameInput = screen.getByLabelText("Name");
    const titleInput = screen.getByLabelText("Title");
    const eventInput = screen.getByLabelText("Event");
    const headingInput = screen.getByLabelText("Heading");
    const subHeadingInput = screen.getByLabelText("Subheading");
    const descriptionInput = screen.getByLabelText("Description");
    const durationInput = screen.getByLabelText("Duration");

    fireEvent.change(nameInput, { target: { value: "New Participant" } });
    fireEvent.change(titleInput, { target: { value: "New Title" } });
    fireEvent.change(eventInput, { target: { value: "New Event" } });
    fireEvent.change(headingInput, { target: { value: "New Heading" } });
    fireEvent.change(subHeadingInput, { target: { value: "New Subheading" } });
    fireEvent.change(descriptionInput, {
      target: { value: "New Description" },
    });
    fireEvent.change(durationInput, { target: { value: "10" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    expect(screen.getByText("New Participant")).toBeInTheDocument();
  });

  it("handles editing overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const editButton = screen.getByTestId("edit-test-id");
    fireEvent.click(editButton);

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Updated Participant" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    expect(screen.getByText("Updated Participant")).toBeInTheDocument();
  });

  it("handles deleting overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const deleteButton = screen.getByTestId("delete-test-id");
    fireEvent.click(deleteButton);

    expect(screen.queryByText("Test Participant")).not.toBeInTheDocument();
  });

  it("handles participant overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const participantButton = screen.getByText("Participant");
    fireEvent.click(participantButton);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Event")).toBeInTheDocument();
    expect(screen.getByLabelText("Heading")).toBeInTheDocument();
    expect(screen.getByLabelText("Subheading")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("handles STB overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const stbButton = screen.getByText("Stick to Bottom");
    fireEvent.click(stbButton);

    expect(screen.getByLabelText("Heading")).toBeInTheDocument();
    expect(screen.getByLabelText("Subheading")).toBeInTheDocument();
  });

  it("handles QR code overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const qrButton = screen.getByText("QR Code");
    fireEvent.click(qrButton);

    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("handles image overlay", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const imageButton = screen.getByText("Image");
    fireEvent.click(imageButton);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Image URL")).toBeInTheDocument();
  });

  it("handles overlay positioning", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const positionButton = screen.getByText("Position");
    fireEvent.click(positionButton);

    const xInput = screen.getByLabelText("X");
    const yInput = screen.getByLabelText("Y");
    const widthInput = screen.getByLabelText("Width");
    const heightInput = screen.getByLabelText("Height");

    fireEvent.change(xInput, { target: { value: "100" } });
    fireEvent.change(yInput, { target: { value: "100" } });
    fireEvent.change(widthInput, { target: { value: "200" } });
    fireEvent.change(heightInput, { target: { value: "200" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    const overlay = screen.getByTestId("overlay-test-id");
    expect(overlay).toHaveStyle({
      left: "100px",
      top: "100px",
      width: "200px",
      height: "200px",
    });
  });

  it("handles overlay styling", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const styleButton = screen.getByText("Style");
    fireEvent.click(styleButton);

    const fontSizeInput = screen.getByLabelText("Font Size");
    const fontColorInput = screen.getByLabelText("Font Color");
    const backgroundColorInput = screen.getByLabelText("Background Color");
    const opacityInput = screen.getByLabelText("Opacity");

    fireEvent.change(fontSizeInput, { target: { value: "24" } });
    fireEvent.change(fontColorInput, { target: { value: "#ff0000" } });
    fireEvent.change(backgroundColorInput, { target: { value: "#000000" } });
    fireEvent.change(opacityInput, { target: { value: "0.8" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    const overlay = screen.getByTestId("overlay-test-id");
    expect(overlay).toHaveStyle({
      fontSize: "24px",
      color: "#ff0000",
      backgroundColor: "#000000",
      opacity: "0.8",
    });
  });

  it("handles overlay duration", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const durationButton = screen.getByText("Duration");
    fireEvent.click(durationButton);

    const durationInput = screen.getByLabelText("Duration");
    fireEvent.change(durationInput, { target: { value: "10" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    const overlay = screen.getByTestId("overlay-test-id");
    expect(overlay).toHaveAttribute("data-duration", "10");
  });

  it("handles overlay color selection", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const colorButton = screen.getByText("Color");
    fireEvent.click(colorButton);

    const colorInput = screen.getByLabelText("Color");
    fireEvent.change(colorInput, { target: { value: "#ff0000" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    const overlay = screen.getByTestId("overlay-test-id");
    expect(overlay).toHaveStyle({
      backgroundColor: "#ff0000",
    });
  });

  it("handles overlay visibility toggle", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const visibilityButton = screen.getByText("Visibility");
    fireEvent.click(visibilityButton);

    const overlay = screen.getByTestId("overlay-test-id");
    expect(overlay).toHaveStyle({
      visibility: "hidden",
    });

    fireEvent.click(visibilityButton);
    expect(overlay).toHaveStyle({
      visibility: "visible",
    });
  });

  it("handles overlay z-index", () => {
    render(
      <Provider store={mockStore}>
        <Overlays />
      </Provider>
    );

    const zIndexButton = screen.getByText("Z-Index");
    fireEvent.click(zIndexButton);

    const zIndexInput = screen.getByLabelText("Z-Index");
    fireEvent.change(zIndexInput, { target: { value: "10" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    const overlay = screen.getByTestId("overlay-test-id");
    expect(overlay).toHaveStyle({
      zIndex: "10",
    });
  });
});
