import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import Overlays from "./Overlays";
import { createMockStore, renderWithStore } from "../../utils/testUtils";
import { OverlayInfo } from "../../types";

// Define a helper function to create a valid overlay
const createOverlay = (id: string, name: string): OverlayInfo => ({
  id,
  name,
  title: "",
  event: "",
  heading: "",
  subHeading: "",
  url: "",
  description: "",
  color: "#16a34a",
  duration: 7,
  type: "participant",
  imageUrl: "",
});

describe("Overlays Component", () => {
  it("renders empty state when no overlays exist", () => {
    const store = createMockStore({
      undoable: {
        present: {
          overlays: {
            list: [],
            hasPendingUpdate: false,
            initialList: [],
            id: "test-id",
          },
          itemList: {
            list: [],
            isLoading: false,
            selectedItemListId: "",
            hasPendingUpdate: false,
            initialItems: [],
          },
        },
      },
    });

    renderWithStore(<Overlays />, store);
    expect(
      screen.getByText(
        "This outline doesn't have any overlays yet. Click the button below to add some."
      )
    ).toBeInTheDocument();
  });

  it("renders loading state when isLoading is true", () => {
    const store = createMockStore({
      undoable: {
        present: {
          overlays: {
            list: [],
            hasPendingUpdate: false,
            initialList: [],
            id: "test-id",
          },
          itemList: {
            list: [],
            isLoading: true,
            selectedItemListId: "",
            hasPendingUpdate: false,
            initialItems: [],
          },
        },
      },
    });

    renderWithStore(<Overlays />, store);
    expect(screen.getByText("Loading overlays...")).toBeInTheDocument();
  });

  it("allows adding a new overlay", async () => {
    const store = createMockStore({
      undoable: {
        present: {
          overlays: {
            list: [],
            hasPendingUpdate: false,
            initialList: [],
            id: "test-id",
          },
          itemList: {
            list: [],
            isLoading: false,
            selectedItemListId: "",
            hasPendingUpdate: false,
            initialItems: [],
          },
        },
      },
    });

    renderWithStore(<Overlays />, store);

    const addButton = screen.getByText("Add Overlay");
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText("Added!")).toBeInTheDocument();
    });
  });

  it("renders overlay form when an overlay is selected", async () => {
    const store = createMockStore({
      undoable: {
        present: {
          overlays: {
            list: [createOverlay("1", "Test Name")],
            hasPendingUpdate: false,
            initialList: [],
            id: "test-id",
          },
          itemList: {
            list: [],
            isLoading: false,
            selectedItemListId: "",
            hasPendingUpdate: false,
            initialItems: [],
          },
        },
      },
    });

    renderWithStore(<Overlays />, store);

    // First select the overlay
    const overlayButton = screen.getByText("Test Name");
    fireEvent.click(overlayButton);

    // Wait for the form to be rendered
    await waitFor(() => {
      expect(screen.getByLabelText("Name:")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Title:")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Event:")).toBeInTheDocument();
    });
  });

  it("updates overlay when form is submitted", async () => {
    const store = createMockStore({
      undoable: {
        present: {
          overlays: {
            list: [createOverlay("1", "Test Name")],
            hasPendingUpdate: false,
            initialList: [],
            id: "test-id",
          },
          itemList: {
            list: [],
            isLoading: false,
            selectedItemListId: "",
            hasPendingUpdate: false,
            initialItems: [],
          },
        },
      },
    });

    renderWithStore(<Overlays />, store);

    // First select the overlay
    const overlayButton = screen.getByText("Test Name");
    fireEvent.click(overlayButton);

    // Wait for the form to be rendered
    await waitFor(() => {
      expect(screen.getByLabelText("Name:")).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText("Name:");
    fireEvent.change(nameInput, { target: { value: "Updated Name" } });

    const updateButton = screen.getByText("Update Overlay");
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(screen.getByText("Updated!")).toBeInTheDocument();
    });
  });

  it("switches between different overlay types", async () => {
    const store = createMockStore({
      undoable: {
        present: {
          overlays: {
            list: [createOverlay("1", "Test Name")],
            hasPendingUpdate: false,
            initialList: [],
            id: "test-id",
          },
          itemList: {
            list: [],
            isLoading: false,
            selectedItemListId: "",
            hasPendingUpdate: false,
            initialItems: [],
          },
        },
      },
    });

    renderWithStore(<Overlays />, store);

    // First select the overlay
    const overlayButton = screen.getByText("Test Name");
    fireEvent.click(overlayButton);

    // Wait for the form to be rendered
    await waitFor(() => {
      expect(screen.getByLabelText("Name:")).toBeInTheDocument();
    });

    // Switch to QR Code type
    const qrCodeRadio = screen.getByLabelText("QR Code:");
    fireEvent.click(qrCodeRadio);

    // Wait for the QR Code form fields to be rendered
    await waitFor(() => {
      expect(screen.getByLabelText("URL:")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Info:")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Color:")).toBeInTheDocument();
    });
  });
});
